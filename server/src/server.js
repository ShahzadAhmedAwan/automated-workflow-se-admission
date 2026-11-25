import cron from 'node-cron';
import { createApp } from './app.js';
import { config } from './core/config/env.js';
import { closePool } from './core/db/pool.js';
import { ensureDatabaseMigrations } from './core/db/migrate-schema.js';
import { startOutboxWorker, registerJobHandler } from './core/queue/outboxBus.js';
import { EVENT_TYPES } from './contracts/event-types.js';
import { sendUserWelcomeEmail } from './core/mail/mailer.js';
import { AdmissionIntakeService, ExpirationReminderService } from './modules/verification/index.js';
import { WhatsAppManager } from './core/baileys/whatsapp-manager.service.js';

// Register background handlers for the Outbox worker
registerJobHandler(EVENT_TYPES.USER_WELCOME_EMAIL, async (payload) => {
  await sendUserWelcomeEmail(payload);
  console.info(`[Email Worker] Delivered welcome email to ${payload.email}`);
});

// Module 3 OCR Processing Worker
registerJobHandler(EVENT_TYPES.PROCESS_OCR_DOCUMENT, async (payload, metadata) => {
  try {
    await AdmissionIntakeService.processOcrDocumentJob(payload);
    console.info(`[OCR Worker] Processed document #${payload.documentId} for student #${payload.studentId}`);
  } catch (error) {
    console.error(`[OCR Worker] Failed processing document #${payload.documentId} (attempt ${metadata.attempts}):`, error.message);
    if (metadata.attempts >= 2) {
      await AdmissionIntakeService.markOcrJobFailed({ ...payload, reason: error.message });
      console.warn(`[OCR Worker] Escalated document #${payload.documentId} to manual review after ${metadata.attempts} attempts.`);
      return;
    }
    throw error;
  }
});

// Module 3 Google Drive Archive Worker
registerJobHandler(EVENT_TYPES.MIGRATE_GDRIVE, async (payload) => {
  const result = await AdmissionIntakeService.migrateGDriveJob(payload);
  if (result?.skipped) {
    console.info(`[Storage Worker] Preserved document #${payload.documentId} in active storage (Google Drive unconfigured).`);
  } else {
    console.info(`[Storage Worker] Archived document #${payload.documentId} to Google Drive`);
  }
});

// Module 2 -> Module 3 Lead Handoff
registerJobHandler(EVENT_TYPES.LEAD_QUALIFIED, async (payload) => {
  await AdmissionIntakeService.createCandidateFromLead(payload);
  console.info(`[Admissions Worker] Created candidate from qualified lead #${payload.leadId}`);
});

// Module 3 -> Module 4 Merit Handoff
registerJobHandler(EVENT_TYPES.CANDIDATE_VERIFIED, async (payload) => {
  const { MeritSnapshotService } = await import('./modules/merit/index.js');
  await MeritSnapshotService.processCandidateVerified(payload);
  console.info(`[Merit Worker] Recalibrated merit lists for verified student #${payload.studentId}`);
});

// Module 3 Intake Token Expiration Reminder Worker (Runs every 15 minutes)
const reminderCron = cron.schedule('*/15 * * * *', async () => {
  try {
    const result = await ExpirationReminderService.processExpiringTokens({ windowHours: 12 });
    if (result.reminded > 0) {
      console.info(`[Intake Reminder Cron] Dispatched ${result.reminded} WhatsApp expiration reminder(s) for impending deadlines.`);
    }
  } catch (error) {
    console.error('[Intake Reminder Cron] Scheduled check failed:', error);
  }
});

const app = createApp();
const stopOutboxWorker = startOutboxWorker();

// Ensure database schema has all latest columns on boot
ensureDatabaseMigrations().catch((err) => {
  console.warn('[Startup Migration] Schema migration deferred:', err.message);
});

const server = app.listen(config.PORT, () => {
  console.info(`SE Admissions API listening on port ${config.PORT}`);
  // Start WhatsApp Manager background service
  WhatsAppManager.startSocket().catch((err) => {
    console.warn('[WhatsApp Service] Background start deferred:', err.message);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; shutting down gracefully.`);
  if (reminderCron) reminderCron.stop();
  server.close(async (error) => {
    await stopOutboxWorker();
    try { await closePool(); } catch (closeError) { console.error('Database pool shutdown failed:', closeError); }
    if (error) { console.error('HTTP server shutdown failed:', error); process.exitCode = 1; }
  });
  setTimeout(() => { console.error('Graceful shutdown timed out.'); process.exit(1); }, 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

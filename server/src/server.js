import cron from 'node-cron';
import { createApp } from './app.js';
import { config } from './core/config/env.js';
import { closePool } from './core/db/pool.js';
import { startOutboxWorker, registerJobHandler } from './core/queue/outboxBus.js';
import { EVENT_TYPES } from './contracts/event-types.js';
import { sendUserWelcomeEmail } from './core/mail/mailer.js';
import { AdmissionIntakeService, ExpirationReminderService } from './modules/verification/index.js';

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
    if (metadata.attempts >= 4) await AdmissionIntakeService.markOcrJobFailed({ ...payload, reason: error.message });
    throw error;
  }
});

// Module 3 Google Drive Archive Worker
registerJobHandler(EVENT_TYPES.MIGRATE_GDRIVE, async (payload) => {
  await AdmissionIntakeService.migrateGDriveJob(payload);
  console.info(`[Storage Worker] Archived document #${payload.documentId} to Google Drive`);
});

// Module 2 -> Module 3 Lead Handoff
registerJobHandler(EVENT_TYPES.LEAD_QUALIFIED, async (payload) => {
  await AdmissionIntakeService.createCandidateFromLead(payload);
  console.info(`[Admissions Worker] Created candidate from qualified lead #${payload.leadId}`);
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
const server = app.listen(config.PORT, () => {
  console.info(`SE Admissions API listening on port ${config.PORT}`);
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

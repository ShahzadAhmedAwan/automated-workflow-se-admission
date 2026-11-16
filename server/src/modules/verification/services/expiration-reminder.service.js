import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import { MANDATORY_ADMISSION_DOCUMENTS } from '../verification.constants.js';
import { config } from '../../../core/config/env.js';

export class ExpirationReminderService {
  /**
   * Scans active tokens that are within the expiration warning window (default 12 hours)
   * where mandatory documents are still pending, and queues WhatsApp reminders.
   *
   * @param {Object} [options]
   * @param {number} [options.windowHours=12] Lookahead window in hours (default: 12)
   * @param {any} [options.db=pool]
   * @returns {Promise<{ scanned: number, reminded: number, skipped: number, reminders: Array }>}
   */
  static async processExpiringTokens({ windowHours = 12, db = pool } = {}) {
    // Find unrevoked, unused tokens expiring between NOW() and NOW() + windowHours
    // where no reminder has been sent yet
    const [tokens] = await db.query(
      `SELECT t.id AS token_id, t.student_id, t.raw_token, t.allowed_doc_types, t.expires_at,
              s.full_name, s.phone_normalized, s.overall_status
         FROM adm_intake_tokens t
         JOIN adm_students s ON s.id = t.student_id
        WHERE t.is_revoked = FALSE
          AND t.used_at IS NULL
          AND t.reminder_sent_at IS NULL
          AND t.expires_at > CURRENT_TIMESTAMP(3)
          AND t.expires_at <= DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)
          AND s.overall_status != 'VERIFIED'`,
      [windowHours]
    );

    if (!tokens.length) {
      return { scanned: 0, reminded: 0, skipped: 0, reminders: [] };
    }

    // Fetch verified documents for these students
    const studentIds = tokens.map((t) => t.student_id);
    const [docs] = await db.query(
      `SELECT student_id, doc_type, verification_status
         FROM adm_student_documents
        WHERE student_id IN (${studentIds.map(() => '?').join(',')})`,
      studentIds
    );

    const verifiedDocsByStudent = {};
    for (const d of docs) {
      if (d.verification_status === 'MATCHED' || d.verification_status === 'PORTAL_VERIFIED') {
        if (!verifiedDocsByStudent[d.student_id]) verifiedDocsByStudent[d.student_id] = new Set();
        verifiedDocsByStudent[d.student_id].add(d.doc_type);
      }
    }

    const reminders = [];
    let reminded = 0;
    let skipped = 0;

    for (const t of tokens) {
      const studentVerified = verifiedDocsByStudent[t.student_id] || new Set();
      const allowedDocs = typeof t.allowed_doc_types === 'string'
        ? JSON.parse(t.allowed_doc_types)
        : (t.allowed_doc_types || MANDATORY_ADMISSION_DOCUMENTS);

      // Filter to documents that are still pending
      const pendingDocs = allowedDocs.filter((d) => !studentVerified.has(d));

      if (pendingDocs.length === 0) {
        // Candidate already has these documents verified
        await db.execute(
          `UPDATE adm_intake_tokens SET reminder_sent_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
          [t.token_id]
        );
        skipped++;
        continue;
      }

      if (!t.phone_normalized) {
        skipped++;
        continue;
      }

      const pendingDocsFormatted = pendingDocs.map((d) => d.replace(/_/g, ' ')).join(', ');
      const uploadUrl = t.raw_token
        ? `${config.APP_ORIGIN}/upload/${t.raw_token}`
        : `${config.APP_ORIGIN}/upload`;

      const hoursLeft = Math.max(1, Math.round((new Date(t.expires_at).getTime() - Date.now()) / (1000 * 60 * 60)));

      const messageText = `*Admissions Reminder: Document Submission Deadline*

Dear ${t.full_name},

This is a reminder that your document submission link for Software Engineering admissions expires in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.

Pending required documents:
- ${pendingDocsFormatted}

Upload portal:
${uploadUrl}

Please submit your documents before the window closes so your application can be verified.`;

      // 1. Dispatch WhatsApp reminder via Outbox queue
      await dispatchJob({
        queueName: 'whatsapp_outreach',
        jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
        payload: {
          recipientPhone: t.phone_normalized,
          messageType: 'TRANSACTIONAL',
          messageText,
          metadata: {
            module: 'MODULE_3_VERIFICATION',
            studentId: t.student_id,
            tokenId: t.token_id,
            reminderType: 'EXPIRATION_WARNING_12H',
          },
        },
        connection: db,
      });

      // 2. Mark reminder_sent_at on token record
      await db.execute(
        `UPDATE adm_intake_tokens SET reminder_sent_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
        [t.token_id]
      );

      reminded++;
      reminders.push({
        tokenId: t.token_id,
        studentId: t.student_id,
        studentName: t.full_name,
        phone: t.phone_normalized,
        hoursLeft,
        pendingDocs,
      });
    }

    return {
      scanned: tokens.length,
      reminded,
      skipped,
      reminders,
    };
  }
}

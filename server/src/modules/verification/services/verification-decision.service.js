import { pool } from '../../../core/db/pool.js';
import { IntakeTokenService } from './intake-token.service.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  DOCUMENT_VERIFICATION_STATUS,
  STUDENT_OVERALL_STATUS,
  TOKEN_CONFIG,
} from '../verification.constants.js';
import { config } from '../../../core/config/env.js';

export class VerificationDecisionService {
  /**
   * Evaluate verification outcome for a document against student declared records
   *
   * @param {Object} params
   * @param {number} params.documentId
   * @param {number} params.studentId
   * @param {string} params.docType
   * @param {Object} params.extractedOcr
   * @param {Object} [params.portalVerification]
   * @param {any} [params.connection=pool]
   */
  static async evaluateDocumentVerification({
    documentId,
    studentId,
    docType,
    extractedOcr,
    portalVerification,
    connection = pool,
  }) {
    // 1. Fetch student data and token attempt count
    const [students] = await connection.execute(
      `SELECT s.id, s.cnic, s.full_name, s.phone_normalized, s.fsc_obtained_marks, s.matric_obtained_marks,
              s.overall_status, s.discrepancy_notes,
              d.token_id, t.attempt_count
         FROM adm_students s
         JOIN adm_student_documents d ON d.id = ?
    LEFT JOIN adm_intake_tokens t ON t.id = d.token_id
        WHERE s.id = ?`,
      [documentId, studentId]
    );

    if (!students.length) {
      throw new Error(`Student ${studentId} or document ${documentId} not found.`);
    }

    const student = students[0];
    const attemptCount = student.attempt_count || 1;
    const ocrMarks = extractedOcr.obtainedMarks || 0;
    const isPass = extractedOcr.isPass ?? true;

    let targetClaimedMarks = 0;
    if (docType === 'FSC_MARKSHEET') {
      targetClaimedMarks = student.fsc_obtained_marks || 0;
    } else if (docType === 'MATRIC_MARKSHEET') {
      targetClaimedMarks = student.matric_obtained_marks || 0;
    }

    // Determine if OCR matches applicant-stated marks
    // (If student didn't claim marks initially, we accept the OCR marks as truth)
    const marksMatch = !targetClaimedMarks || targetClaimedMarks === ocrMarks;
    const portalMatched = portalVerification?.isVerified ?? true; // if portal unsupported/unavailable, defaults true

    // Check Condition A: Verified Match
    if (marksMatch && portalMatched && isPass) {
      return await this._handleVerifiedMatch({
        documentId,
        student,
        docType,
        extractedOcr,
        connection,
      });
    }

    // Check Condition B or C: Discrepancy
    const discrepancyReason = !isPass
      ? 'Candidate marked FAIL on marksheet.'
      : `Marksheet shows ${ocrMarks} marks, but applicant declared ${targetClaimedMarks} marks.`;

    if (attemptCount < TOKEN_CONFIG.MAX_ATTEMPTS) {
      // Condition B: Attempt 1 or 2 -> issue new token and send automated alert
      return await this._handleAttemptDiscrepancy({
        documentId,
        student,
        docType,
        attemptCount,
        discrepancyReason,
        connection,
      });
    }

    // Condition C: Attempt 3+ -> escalate to manual review
    return await this._handleManualReviewEscalation({
      documentId,
      student,
      discrepancyReason,
      connection,
    });
  }

  /**
   * Condition A: Verified Match
   */
  static async _handleVerifiedMatch({ documentId, student, docType, extractedOcr, connection }) {
    // Update document record
    await connection.execute(
      `UPDATE adm_student_documents
          SET verification_status = ?,
              verified_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
      [DOCUMENT_VERIFICATION_STATUS.MATCHED, documentId]
    );

    // If marksheet, backfill verified marks into adm_students
    if (docType === 'FSC_MARKSHEET' && extractedOcr.obtainedMarks) {
      await connection.execute(
        `UPDATE adm_students
            SET fsc_obtained_marks = ?, fsc_total_marks = ?, fsc_roll_no = COALESCE(?, fsc_roll_no)
          WHERE id = ?`,
        [extractedOcr.obtainedMarks, extractedOcr.totalMarks || 1100, extractedOcr.rollNumber || null, student.id]
      );
    } else if (docType === 'MATRIC_MARKSHEET' && extractedOcr.obtainedMarks) {
      await connection.execute(
        `UPDATE adm_students
            SET matric_obtained_marks = ?, matric_total_marks = ?
          WHERE id = ?`,
        [extractedOcr.obtainedMarks, extractedOcr.totalMarks || 1100, student.id]
      );
    }

    // Check if ALL pending documents for this student are now MATCHED
    const [unmatched] = await connection.execute(
      `SELECT id FROM adm_student_documents
        WHERE student_id = ?
          AND verification_status NOT IN (?, ?)`,
      [student.id, DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED]
    );

    let finalStatus = student.overall_status;
    if (unmatched.length === 0) {
      finalStatus = STUDENT_OVERALL_STATUS.VERIFIED;
      await connection.execute(
        `UPDATE adm_students SET overall_status = ? WHERE id = ?`,
        [STUDENT_OVERALL_STATUS.VERIFIED, student.id]
      );
    }

    // Enqueue MIGRATE_GDRIVE outbox job to archive file and keep Cloudflare R2 / Inodes clean
    const [docRow] = await connection.execute(
      `SELECT storage_key, original_filename, file_mime FROM adm_student_documents WHERE id = ?`,
      [documentId]
    );

    if (docRow.length) {
      await dispatchJob({
        queueName: 'storage_migration',
        jobType: EVENT_TYPES.MIGRATE_GDRIVE,
        payload: {
          documentId,
          studentId: student.id,
          studentCnic: student.cnic || '0000000000000',
          filename: docRow[0].original_filename,
          r2Key: docRow[0].storage_key,
          fileMime: docRow[0].file_mime,
        },
        connection,
      });
    }

    return {
      status: 'MATCHED',
      overallStatus: finalStatus,
    };
  }

  /**
   * Condition B: Discrepancy on Attempt 1-2
   */
  static async _handleAttemptDiscrepancy({ documentId, student, docType, attemptCount, discrepancyReason, connection }) {
    await connection.execute(
      `UPDATE adm_student_documents
          SET verification_status = ?
        WHERE id = ?`,
      [DOCUMENT_VERIFICATION_STATUS.DISCREPANCY, documentId]
    );

    // Invalidate existing token
    await connection.execute(
      `UPDATE adm_intake_tokens SET is_revoked = TRUE WHERE student_id = ? AND used_at IS NOT NULL`,
      [student.id]
    );

    // Mint next attempt token
    const nextAttempt = attemptCount + 1;
    const newToken = await IntakeTokenService.generateToken({
      studentId: student.id,
      allowedDocTypes: [docType],
      attemptCount: nextAttempt,
      expiresInHours: 48,
      connection,
    });

    await connection.execute(
      `UPDATE adm_students
          SET overall_status = ?,
              discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[Attempt ', ?, ' Discrepancy]: ', ?)
        WHERE id = ?`,
      [STUDENT_OVERALL_STATUS.DOCS_REQUESTED, attemptCount, discrepancyReason, student.id]
    );

    // Dispatch WhatsApp alert to student
    const uploadUrl = `${config.APP_ORIGIN}/upload/${newToken.rawToken}`;
    const alertMessage = `⚠️ *Admissions Verification Notice*:
${discrepancyReason}

👉 *Click the link below to upload the correct document:*
${uploadUrl}

*(Link valid for 48 hours)*`;

    await dispatchJob({
      queueName: 'whatsapp_outreach',
      jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
      payload: {
        recipientPhone: student.phone_normalized,
        messageType: 'TRANSACTIONAL',
        messageText: alertMessage,
        metadata: {
          module: 'MODULE_3_VERIFICATION',
          studentId: student.id,
          attempt: nextAttempt,
        },
      },
      connection,
    });

    return {
      status: 'DISCREPANCY_REISSUED',
      nextAttempt,
      overallStatus: STUDENT_OVERALL_STATUS.DOCS_REQUESTED,
    };
  }

  /**
   * Condition C: Escalation to Manual Review
   */
  static async _handleManualReviewEscalation({ documentId, student, discrepancyReason, connection }) {
    await connection.execute(
      `UPDATE adm_student_documents
          SET verification_status = ?
        WHERE id = ?`,
      [DOCUMENT_VERIFICATION_STATUS.MANUAL_REVIEW, documentId]
    );

    await connection.execute(
      `UPDATE adm_students
          SET overall_status = ?,
              discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[Escalated to Manual Review]: ', ?)
        WHERE id = ?`,
      [STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW, discrepancyReason, student.id]
    );

    return {
      status: 'ESCALATED_MANUAL_REVIEW',
      overallStatus: STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW,
    };
  }
}

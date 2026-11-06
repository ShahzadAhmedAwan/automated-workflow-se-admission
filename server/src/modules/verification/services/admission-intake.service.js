import { pool } from '../../../core/db/pool.js';
import { IntakeTokenService } from './intake-token.service.js';
import { StorageService } from './storage/storage.service.js';
import { GeminiOcrService } from './ocr/gemini-ocr.service.js';
import { BoardRegistryService } from './scrapers/board-registry.service.js';
import { VerificationDecisionService } from './verification-decision.service.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_VERIFICATION_STATUS,
  STUDENT_OVERALL_STATUS,
  STORAGE_STATE,
} from '../verification.constants.js';
import { AppError } from '../../../core/errors/app-error.js';
import { logAudit } from '../../../core/audit/audit-logger.js';
import { config } from '../../../core/config/env.js';
import { normalizePhoneNumber } from '../../marketing/services/csv-parser.service.js';

export class AdmissionIntakeService {
  /**
   * Consumes LEAD_QUALIFIED event emitted by Module 2
   */
  static async createCandidateFromLead(lead, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let studentId = null;
      const [existing] = await connection.execute(
        `SELECT id, overall_status FROM adm_students WHERE phone_normalized = ? OR lead_id = ? LIMIT 1 FOR UPDATE`,
        [lead.phoneNormalized, lead.leadId]
      );

      if (existing.length) {
        studentId = existing[0].id;
        await connection.execute(
          `UPDATE adm_students
              SET lead_id = COALESCE(lead_id, ?),
                  full_name = COALESCE(?, full_name),
                  fsc_obtained_marks = COALESCE(?, fsc_obtained_marks)
            WHERE id = ?`,
          [lead.leadId, lead.fullName, lead.fscMarks, studentId]
        );
      } else {
        const [insert] = await connection.execute(
          `INSERT INTO adm_students (lead_id, full_name, phone_normalized, city, prior_degree,
                                     fsc_obtained_marks, overall_status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            lead.leadId,
            lead.fullName,
            lead.phoneNormalized,
            lead.city || null,
            lead.priorDegree || null,
            lead.fscMarks || 0,
            STUDENT_OVERALL_STATUS.DOCS_REQUESTED,
          ]
        );
        studentId = insert.insertId;
      }

      // Mint initial token for marksheet verification
      const token = await IntakeTokenService.generateToken({
        studentId,
        allowedDocTypes: [DOCUMENT_TYPES.FSC_MARKSHEET, DOCUMENT_TYPES.MATRIC_MARKSHEET],
        expiresInHours: 48,
        connection,
      });

      // Dispatch WhatsApp message with upload link
      const uploadUrl = `${config.APP_ORIGIN}/upload/${token.rawToken}`;
      const messageText = `🎉 *Congratulations ${lead.fullName}!* You are qualified for Admissions at Department of Software Engineering.

👉 *Click the link below to upload your documents:*
${uploadUrl}

*(Valid for 48 hours. Please upload your FSc and Matric marksheets)*`;

      await dispatchJob({
        queueName: 'whatsapp_outreach',
        jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
        payload: {
          recipientPhone: lead.phoneNormalized,
          messageType: 'TRANSACTIONAL',
          messageText,
          metadata: {
            module: 'MODULE_3_VERIFICATION',
            studentId,
            tokenId: token.tokenId,
          },
        },
        connection,
      });

      await connection.commit();
      return { studentId, tokenId: token.tokenId };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Handle public submission of documents using single-use capability token
   */
  static async submitDocuments({ rawToken, files = [], remarks = '' }, db = pool) {
    if (!files || files.length === 0) {
      throw new AppError(400, 'NO_FILES_PROVIDED', 'At least one document file must be uploaded.');
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Atomically lock and validate token
      const tokenInfo = await IntakeTokenService.validateToken(rawToken, connection);
      const studentId = tokenInfo.studentId;
      const tokenId = tokenInfo.tokenId;
      const allowedDocTypes = new Set(tokenInfo.allowedDocTypes);

      const savedDocuments = [];

      // 2. Upload each file and record in adm_student_documents
      for (const file of files) {
        // Doc type passed via fieldname or custom metadata
        const docType = (file.fieldname || '').toUpperCase();
        if (!allowedDocTypes.has(docType) && allowedDocTypes.size > 0 && !allowedDocTypes.has(DOCUMENT_TYPES.OTHER)) {
          // If fieldname isn't an allowed doc, fallback to first unfulfilled allowed doc
          continue;
        }

        const uploadResult = await StorageService.uploadFile({
          buffer: file.buffer,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          studentId,
          docType: docType || DOCUMENT_TYPES.OTHER,
        });

        const [docInsert] = await connection.execute(
          `INSERT INTO adm_student_documents (
             student_id, token_id, doc_type, original_filename, file_mime, file_size,
             storage_provider, storage_key, storage_state, verification_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            tokenId,
            docType || DOCUMENT_TYPES.OTHER,
            file.originalname,
            file.mimetype,
            file.size,
            uploadResult.storageProvider,
            uploadResult.storageKey,
            STORAGE_STATE.ACTIVE_R2,
            DOCUMENT_VERIFICATION_STATUS.PENDING,
          ]
        );

        const documentId = docInsert.insertId;
        savedDocuments.push({
          documentId,
          docType: docType || DOCUMENT_TYPES.OTHER,
          storageKey: uploadResult.storageKey,
          fileMime: file.mimetype,
        });

        // 3. Enqueue OCR processing job
        await dispatchJob({
          queueName: 'ocr_intake',
          jobType: EVENT_TYPES.PROCESS_OCR_DOCUMENT,
          payload: {
            documentId,
            studentId,
            docType: docType || DOCUMENT_TYPES.OTHER,
            r2Key: uploadResult.storageKey,
            fileMime: file.mimetype,
          },
          connection,
        });
      }

      if (savedDocuments.length === 0) {
        throw new AppError(400, 'INVALID_DOCUMENT_TYPES', 'Uploaded files did not match the required document types.');
      }

      // 4. Mark token as consumed and update student status to UNDER_REVIEW
      await IntakeTokenService.markTokenUsed(tokenId, connection);
      await connection.execute(
        `UPDATE adm_students SET overall_status = ? WHERE id = ?`,
        [STUDENT_OVERALL_STATUS.UNDER_REVIEW, studentId]
      );

      await connection.commit();

      return {
        message: 'Documents successfully submitted for verification.',
        documentsCount: savedDocuments.length,
        studentId,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Outbox worker job handler for PROCESS_OCR_DOCUMENT
   */
  static async processOcrDocumentJob({ documentId, studentId, docType, r2Key, fileMime }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Check document still exists
      const [docRows] = await connection.execute(
        `SELECT d.id, d.storage_provider, d.storage_key, s.full_name, s.fsc_obtained_marks
           FROM adm_student_documents d
           JOIN adm_students s ON s.id = d.student_id
          WHERE d.id = ? FOR UPDATE`,
        [documentId]
      );

      if (!docRows.length) {
        await connection.commit();
        return;
      }

      const docRow = docRows[0];

      // Mark document as OCR_PROCESSING
      await connection.execute(
        `UPDATE adm_student_documents SET verification_status = ? WHERE id = ?`,
        [DOCUMENT_VERIFICATION_STATUS.OCR_PROCESSING, documentId]
      );

      // Read buffer from storage
      const buffer = await StorageService.getFileBuffer(r2Key, docRow.storage_provider);

      // Execute throttled Gemini Flash OCR
      const ocrResult = await GeminiOcrService.extractDocumentData({
        fileBuffer: buffer,
        mimeType: fileMime,
        docType,
        studentContext: {
          fullName: docRow.full_name,
          fscMarks: docRow.fsc_obtained_marks,
        },
      });

      // Query board portal if marksheet and roll number extracted
      let portalResult = null;
      if (ocrResult.extracted?.rollNumber && (docType === DOCUMENT_TYPES.FSC_MARKSHEET || docType === DOCUMENT_TYPES.MATRIC_MARKSHEET)) {
        portalResult = await BoardRegistryService.verifyCandidate({
          boardName: ocrResult.extracted.boardName,
          rollNumber: ocrResult.extracted.rollNumber,
          candidateName: ocrResult.extracted.candidateName,
        });
      }

      // Save raw OCR and portal responses
      await connection.execute(
        `UPDATE adm_student_documents
            SET ocr_raw_response = ?,
                extracted_data = ?,
                portal_verification_data = ?
          WHERE id = ?`,
        [
          JSON.stringify(ocrResult.raw),
          JSON.stringify(ocrResult.extracted),
          portalResult ? JSON.stringify(portalResult) : null,
          documentId,
        ]
      );

      // Run Verification Decision Workflow (Condition A, B, C)
      const decision = await VerificationDecisionService.evaluateDocumentVerification({
        documentId,
        studentId,
        docType,
        extractedOcr: ocrResult.extracted,
        portalVerification: portalResult,
        connection,
      });

      await connection.commit();
      return decision;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Outbox worker job handler for MIGRATE_GDRIVE
   */
  static async migrateGDriveJob({ documentId, studentId, studentCnic, filename, r2Key, fileMime }, db = pool) {
    const migration = await StorageService.migrateToGoogleDrive({
      storageKey: r2Key,
      filename,
      mimeType: fileMime,
      studentCnic,
    });

    await db.execute(
      `UPDATE adm_student_documents
          SET gdrive_file_id = ?,
              storage_state = ?
        WHERE id = ?`,
      [migration.gdriveFileId, migration.storageState, documentId]
    );

    await db.execute(
      `UPDATE adm_students
          SET gdrive_folder_id = COALESCE(gdrive_folder_id, ?)
        WHERE id = ?`,
      [migration.gdriveFolderId, studentId]
    );

    return migration;
  }

  /**
   * Staff query: List candidates needing review or with discrepancies
   */
  static async listManualReviewQueue({ limit = 50, offset = 0, status }, db = pool) {
    const whereClauses = [];
    const params = [];

    if (status) {
      whereClauses.push('s.overall_status = ?');
      params.push(status);
    } else {
      whereClauses.push(`s.overall_status IN (?, ?, ?)`);
      params.push(
        STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW,
        STUDENT_OVERALL_STATUS.UNDER_REVIEW,
        STUDENT_OVERALL_STATUS.DOCS_REQUESTED
      );
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const safeOffset = Math.max(0, Number(offset) || 0);

    let rows = [];
    try {
      const [queried] = await db.query(
        `SELECT s.id AS student_id, s.application_no, s.cnic, s.full_name, s.father_name,
                s.phone_normalized, s.fsc_obtained_marks, s.fsc_total_marks,
                s.matric_obtained_marks, s.matric_total_marks,
                s.overall_status, s.discrepancy_notes, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM adm_student_documents d WHERE d.student_id = s.id) AS document_count,
                (SELECT t.raw_token FROM adm_intake_tokens t WHERE t.student_id = s.id AND t.used_at IS NULL AND t.is_revoked = FALSE AND t.expires_at > CURRENT_TIMESTAMP(3) ORDER BY t.id DESC LIMIT 1) AS active_token
           FROM adm_students s
          ${whereSql}
          ORDER BY s.updated_at DESC
          LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
      );
      rows = queried;
    } catch {
      const [queried] = await db.query(
        `SELECT s.id AS student_id, s.application_no, s.cnic, s.full_name, s.father_name,
                s.phone_normalized, s.fsc_obtained_marks, s.fsc_total_marks,
                s.matric_obtained_marks, s.matric_total_marks,
                s.overall_status, s.discrepancy_notes, s.created_at, s.updated_at,
                (SELECT COUNT(*) FROM adm_student_documents d WHERE d.student_id = s.id) AS document_count
           FROM adm_students s
          ${whereSql}
          ORDER BY s.updated_at DESC
          LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        params
      );
      rows = queried;
    }

    return rows.map((r) => ({
      studentId: r.student_id,
      applicationNo: r.application_no,
      cnic: r.cnic,
      fullName: r.full_name,
      fatherName: r.father_name,
      phoneNormalized: r.phone_normalized,
      fscObtainedMarks: r.fsc_obtained_marks,
      fscTotalMarks: r.fsc_total_marks,
      matricObtainedMarks: r.matric_obtained_marks,
      matricTotalMarks: r.matric_total_marks,
      overallStatus: r.overall_status,
      discrepancyNotes: r.discrepancy_notes,
      documentCount: Number(r.document_count),
      activeToken: r.active_token || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Update student phone number and sync with mkt_leads
   */
  static async updateStudentPhone(studentId, newPhone, db = pool) {
    const cleanPhone = normalizePhoneNumber(newPhone);
    if (!cleanPhone) {
      throw new AppError(400, 'INVALID_PHONE', 'A valid mobile phone number is required (e.g. 03xx-xxxxxxx).');
    }

    await db.execute(
      `UPDATE adm_students SET phone_normalized = ? WHERE id = ?`,
      [cleanPhone, studentId]
    );

    // Also update mkt_leads if linked
    await db.execute(
      `UPDATE mkt_leads l JOIN adm_students s ON s.lead_id = l.id SET l.phone_normalized = ? WHERE s.id = ?`,
      [cleanPhone, studentId]
    );

    return { success: true, studentId, phoneNormalized: cleanPhone };
  }

  /**
   * Get single student review dossier with all uploaded documents, OCR, and portal responses
   */
  static async getStudentReviewDossier(studentId, db = pool) {
    const [students] = await db.execute(
      `SELECT id, application_no, cnic, full_name, father_name, phone_normalized, email,
              fsc_roll_no, fsc_obtained_marks, fsc_total_marks,
              matric_obtained_marks, matric_total_marks,
              overall_status, discrepancy_notes, gdrive_folder_id, created_at, updated_at
         FROM adm_students
        WHERE id = ?`,
      [studentId]
    );

    if (!students.length) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Candidate not found');
    }

    const [documents] = await db.execute(
      `SELECT id AS document_id, doc_type, original_filename, file_mime, file_size,
              storage_provider, storage_key, gdrive_file_id, storage_state,
              ocr_raw_response, extracted_data, portal_verification_data,
              verification_status, verified_at, created_at
         FROM adm_student_documents
        WHERE student_id = ?
        ORDER BY id ASC`,
      [studentId]
    );

    const [tokens] = await db.execute(
      `SELECT id AS token_id, allowed_doc_types, attempt_count, is_revoked, used_at, expires_at, created_at
         FROM adm_intake_tokens
        WHERE student_id = ?
        ORDER BY id DESC`,
      [studentId]
    );

    return {
      student: students[0],
      documents: documents.map((d) => ({
        ...d,
        extractedData: typeof d.extracted_data === 'string' ? JSON.parse(d.extracted_data) : d.extracted_data,
        portalVerificationData: typeof d.portal_verification_data === 'string' ? JSON.parse(d.portal_verification_data) : d.portal_verification_data,
      })),
      tokens: tokens.map((t) => ({
        ...t,
        allowedDocTypes: typeof t.allowed_doc_types === 'string' ? JSON.parse(t.allowed_doc_types) : t.allowed_doc_types,
      })),
    };
  }

  /**
   * Staff manual decision: approve, override marks, or reject and reissue token
   */
  static async executeManualReviewAction({
    studentId,
    documentId,
    action,
    fscObtainedMarks,
    fscTotalMarks,
    matricObtainedMarks,
    matricTotalMarks,
    discrepancyReason,
    notes,
    actorId,
    actorType = 'STAFF_USER',
  }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.execute(
        `SELECT id, overall_status, fsc_obtained_marks, matric_obtained_marks FROM adm_students WHERE id = ? FOR UPDATE`,
        [studentId]
      );
      if (!studentRows.length) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found.');
      const studentBefore = studentRows[0];

      if (action === 'APPROVE') {
        if (documentId) {
          await connection.execute(
            `UPDATE adm_student_documents SET verification_status = ?, verified_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
            [DOCUMENT_VERIFICATION_STATUS.MATCHED, documentId]
          );
        }
        await connection.execute(
          `UPDATE adm_students SET overall_status = ? WHERE id = ?`,
          [STUDENT_OVERALL_STATUS.VERIFIED, studentId]
        );
      } else if (action === 'OVERRIDE_MARKS') {
        await connection.execute(
          `UPDATE adm_students
              SET fsc_obtained_marks = COALESCE(?, fsc_obtained_marks),
                  fsc_total_marks = COALESCE(?, fsc_total_marks),
                  matric_obtained_marks = COALESCE(?, matric_obtained_marks),
                  matric_total_marks = COALESCE(?, matric_total_marks),
                  overall_status = ?
            WHERE id = ?`,
          [
            fscObtainedMarks ?? null,
            fscTotalMarks ?? 1100,
            matricObtainedMarks ?? null,
            matricTotalMarks ?? 1100,
            STUDENT_OVERALL_STATUS.VERIFIED,
            studentId,
          ]
        );
        if (documentId) {
          await connection.execute(
            `UPDATE adm_student_documents SET verification_status = ?, verified_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
            [DOCUMENT_VERIFICATION_STATUS.MATCHED, documentId]
          );
        }
      } else if (action === 'REJECT_AND_REISSUE') {
        if (documentId) {
          await connection.execute(
            `UPDATE adm_student_documents SET verification_status = ? WHERE id = ?`,
            [DOCUMENT_VERIFICATION_STATUS.REJECTED, documentId]
          );
        }
        await connection.execute(
          `UPDATE adm_students SET overall_status = ?, discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[Manual Reissue]: ', ?) WHERE id = ?`,
          [STUDENT_OVERALL_STATUS.DOCS_REQUESTED, notes || 'Staff requested re-upload', studentId]
        );
        // Mint fresh token
        await IntakeTokenService.generateToken({
          studentId,
          allowedDocTypes: [DOCUMENT_TYPES.FSC_MARKSHEET],
          expiresInHours: 48,
          connection,
        });
      }

      await logAudit({
        actorType,
        actorId,
        eventCategory: 'VERIFICATION',
        action: `MANUAL_REVIEW_${action}`,
        entityTable: 'adm_students',
        entityId: String(studentId),
        payloadBefore: studentBefore,
        payloadAfter: { action, fscObtainedMarks, matricObtainedMarks, notes },
        connection,
      });

      await connection.commit();
      return { success: true, action, studentId };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

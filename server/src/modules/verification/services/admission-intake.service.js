import { pool } from '../../../core/db/pool.js';
import { IntakeTokenService } from './intake-token.service.js';
import { StorageService } from './storage/storage.service.js';
import { GeminiOcrService } from './ocr/gemini-ocr.service.js';
import { BoardRegistryService } from './scrapers/board-registry.service.js';
import { BoardSourceService } from './board-source.service.js';
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
    const uploadedObjects = [];
    let committed = false;
    let commitAttempted = false;
    try {
      await connection.beginTransaction();

      // 1. Atomically lock and validate token
      const tokenInfo = await IntakeTokenService.validateToken(rawToken, connection, { lock: true });
      const studentId = tokenInfo.studentId;
      const tokenId = tokenInfo.tokenId;
      const allowedDocTypes = new Set(tokenInfo.allowedDocTypes);

      const savedDocuments = [];

      // 2. Upload each file and record in adm_student_documents
      for (const file of files) {
        // Doc type passed via fieldname or custom metadata
        const docType = file.fieldname;
        if (!Object.values(DOCUMENT_TYPES).includes(docType) || (!allowedDocTypes.has(docType) && !allowedDocTypes.has(DOCUMENT_TYPES.OTHER))) {
          throw new AppError(400, 'INVALID_DOCUMENT_TYPES', `The upload link does not allow ${docType || 'this document type'}.`);
        }
        const signatures = {
          'image/jpeg': file.buffer?.[0] === 0xff && file.buffer?.[1] === 0xd8 && file.buffer?.[2] === 0xff,
          'image/png': file.buffer?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          'application/pdf': file.buffer?.subarray(0, 5).toString('ascii') === '%PDF-',
        };
        if (!signatures[file.mimetype]) throw new AppError(400, 'INVALID_FILE_CONTENT', `${docType} is not a valid ${file.mimetype} file.`);

        const uploadResult = await StorageService.uploadFile({
          buffer: file.buffer,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          studentId,
          docType: docType || DOCUMENT_TYPES.OTHER,
        });
        uploadedObjects.push(uploadResult);

        const [docInsert] = await connection.execute(
          `INSERT INTO adm_student_documents (
             student_id, token_id, doc_type, original_filename, file_mime, file_size,
             storage_provider, storage_key, storage_state, verification_status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            studentId,
            tokenId,
            docType || DOCUMENT_TYPES.OTHER,
            String(file.originalname || 'document').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 240),
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

      commitAttempted = true;
      await connection.commit();
      committed = true;

      return {
        message: 'Documents successfully submitted for verification.',
        documentsCount: savedDocuments.length,
        studentId,
      };
    } catch (err) {
      if (!committed) await connection.rollback();
      if (!commitAttempted) {
        await Promise.allSettled(uploadedObjects.map((file) => StorageService.deleteFile(file.storageKey, file.storageProvider)))
          .then((results) => results.filter((result) => result.status === 'rejected').forEach((result) => console.error('Upload cleanup failed:', result.reason?.message)));
      }
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Outbox worker job handler for PROCESS_OCR_DOCUMENT
   */
  static async processOcrDocumentJob({ documentId, studentId }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Check document still exists
      const [docRows] = await connection.execute(
        `SELECT d.id, d.doc_type, d.file_mime, d.storage_provider, d.storage_key, d.verification_status, s.full_name, s.fsc_obtained_marks
           FROM adm_student_documents d
           JOIN adm_students s ON s.id = d.student_id
          WHERE d.id = ? AND d.student_id = ?
            AND d.verification_status = ?
          FOR UPDATE`,
        [documentId, studentId, DOCUMENT_VERIFICATION_STATUS.PENDING]
      );

      if (!docRows.length) {
        await connection.commit();
        return { status: 'SKIPPED', reason: 'DOCUMENT_ALREADY_REVIEWED_OR_NOT_FOUND' };
      }

      const docRow = docRows[0];

      // Mark document as OCR_PROCESSING
      await connection.execute(
        `UPDATE adm_student_documents SET verification_status = ? WHERE id = ?`,
        [DOCUMENT_VERIFICATION_STATUS.OCR_PROCESSING, documentId]
      );

      // Read buffer from storage
      const buffer = await StorageService.getFileBuffer(docRow.storage_key, docRow.storage_provider);

      // Execute throttled Gemini Flash OCR
      const ocrResult = await GeminiOcrService.extractDocumentData({
        fileBuffer: buffer,
        mimeType: docRow.file_mime,
        docType: docRow.doc_type,
        studentContext: {
          fullName: docRow.full_name,
          fscMarks: docRow.fsc_obtained_marks,
        },
      });

      // Query board portal if marksheet and roll number extracted
      let portalResult = null;
      if (ocrResult.extracted?.rollNumber && (docRow.doc_type === DOCUMENT_TYPES.FSC_MARKSHEET || docRow.doc_type === DOCUMENT_TYPES.MATRIC_MARKSHEET)) {
        const configuredSource = await BoardSourceService.findForBoard(ocrResult.extracted.boardName, ocrResult.extracted.examYear);
        portalResult = configuredSource
          ? {
              isVerified: false,
              status: 'MANUAL_SOURCE_AVAILABLE',
              sourceType: configuredSource.source_type,
              boardSourceId: configuredSource.id,
              sourceUrl: configuredSource.result_url || null,
              gazetteFilename: configuredSource.gazette_filename || null,
            }
          : await BoardRegistryService.verifyCandidate({
              boardName: ocrResult.extracted.boardName,
              rollNumber: ocrResult.extracted.rollNumber,
              examYear: ocrResult.extracted.examYear,
              candidateName: ocrResult.extracted.candidateName,
            });
      }

      // Save raw OCR and portal responses
      await connection.execute(
        `UPDATE adm_student_documents
            SET ocr_raw_response = ?,
                extracted_data = ?,
                portal_verification_data = ?
          WHERE id = ? AND student_id = ? AND verification_status = ?`,
        [
          JSON.stringify({ source: ocrResult.source, isMock: ocrResult.isMock, response: ocrResult.raw }),
          JSON.stringify({ ...ocrResult.extracted, source: ocrResult.source, isMock: ocrResult.isMock }),
          portalResult ? JSON.stringify(portalResult) : null,
          documentId,
          studentId,
          DOCUMENT_VERIFICATION_STATUS.OCR_PROCESSING,
        ]
      );

      // Run Verification Decision Workflow (Condition A, B, C)
      const decision = await VerificationDecisionService.evaluateDocumentVerification({
        documentId,
        studentId,
        docType: docRow.doc_type,
        extractedOcr: { ...ocrResult.extracted, source: ocrResult.source, isMock: ocrResult.isMock },
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

  static async markOcrJobFailed({ documentId, studentId, reason }, db = pool) {
    await db.execute(
      `UPDATE adm_student_documents SET verification_status = ?,
              extracted_data = JSON_OBJECT('processingError', ?)
        WHERE id = ? AND student_id = ? AND verification_status = ?`,
      [DOCUMENT_VERIFICATION_STATUS.MANUAL_REVIEW, String(reason || 'OCR processing failed').slice(0, 500), documentId, studentId, DOCUMENT_VERIFICATION_STATUS.OCR_PROCESSING]
    );
    await db.execute(
      `UPDATE adm_students SET overall_status = ?,
              discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[OCR processing failed]: document requires staff review.')
        WHERE id = ? AND overall_status = ?`,
      [STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW, studentId, STUDENT_OVERALL_STATUS.UNDER_REVIEW]
    );
  }

  /**
   * Outbox worker job handler for MIGRATE_GDRIVE
   */
  static async migrateGDriveJob({ documentId, studentId, filename, r2Key, fileMime }, db = pool) {
    const [documents] = await db.execute(
      `SELECT storage_provider, storage_key, gdrive_file_id, verification_status
         FROM adm_student_documents WHERE id = ? AND student_id = ?`,
      [documentId, studentId]
    );
    if (!documents.length) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document to archive was not found.');
    const document = documents[0];
    if (![DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED].includes(document.verification_status)) {
      throw new AppError(409, 'DOCUMENT_NOT_VERIFIED', 'Only verified documents can be archived.');
    }
    if (document.gdrive_file_id) {
      await StorageService.deleteFile(document.storage_key || r2Key, document.storage_provider);
      return { gdriveFileId: document.gdrive_file_id, storageState: STORAGE_STATE.ARCHIVED_GDRIVE };
    }
    const migration = await StorageService.migrateToGoogleDrive({
      storageKey: document.storage_key || r2Key,
      filename,
      mimeType: fileMime,
      storageProvider: document.storage_provider,
    });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [updated] = await connection.execute(
        `UPDATE adm_student_documents SET gdrive_file_id = ?, storage_state = ?
          WHERE id = ? AND student_id = ? AND gdrive_file_id IS NULL
            AND verification_status IN (?, ?)`,
        [migration.gdriveFileId, migration.storageState, documentId, studentId, DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED]
      );
      if (updated.affectedRows !== 1) throw new AppError(409, 'ARCHIVE_STATE_CHANGED', 'Document state changed during archive.');
      await connection.execute(`UPDATE adm_students SET gdrive_folder_id = COALESCE(gdrive_folder_id, ?) WHERE id = ?`, [migration.gdriveFolderId, studentId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }

    // Purge only after Drive confirms the file and the archive ID is durable in MySQL.
    await StorageService.deleteFile(document.storage_key || r2Key, document.storage_provider);

    return migration;
  }

  /**
   * Staff query: List candidates needing review or with discrepancies
   */
  static async listManualReviewQueue({ limit = 50, offset = 0, status }, db = pool) {
    const allowedStatuses = [
      STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW,
      STUDENT_OVERALL_STATUS.UNDER_REVIEW,
      STUDENT_OVERALL_STATUS.DOCS_REQUESTED,
      STUDENT_OVERALL_STATUS.VERIFIED,
    ];
    if (status && !allowedStatuses.includes(status)) {
      throw new AppError(400, 'INVALID_QUEUE_STATUS', 'Choose a valid verification queue status.');
    }
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
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 25)));
    const safeOffset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(offset) || 0)));

    const [[rows], [countRows], [summaryRows]] = await Promise.all([
      db.query(
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
      ),
      db.query(`SELECT COUNT(*) AS total FROM adm_students s ${whereSql}`, params),
      db.query(
        `SELECT overall_status, COUNT(*) AS total FROM adm_students
          WHERE overall_status IN (?, ?, ?, ?) GROUP BY overall_status`,
        allowedStatuses
      ),
    ]);

    const items = rows.map((r) => ({
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
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    const summary = Object.fromEntries(allowedStatuses.map((value) => [value, 0]));
    for (const row of summaryRows) summary[row.overall_status] = Number(row.total);
    return {
      items,
      total: Number(countRows[0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset,
      summary,
    };
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
      `SELECT s.id, s.application_no, s.cnic, s.full_name, s.father_name, s.phone_normalized, s.email,
              fsc_roll_no, fsc_obtained_marks, fsc_total_marks,
              matric_obtained_marks, matric_total_marks,
              s.overall_status, s.discrepancy_notes, s.gdrive_folder_id, s.verified_at,
              s.verified_by, verifier.display_name AS verified_by_name, s.created_at, s.updated_at
         FROM adm_students s LEFT JOIN sys_users verifier ON verifier.id = s.verified_by
        WHERE s.id = ?`,
      [studentId]
    );

    if (!students.length) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Candidate not found');
    }

    const [documents] = await db.execute(
      `SELECT d.id AS document_id, d.doc_type, d.original_filename, d.file_mime, d.file_size,
              storage_provider, storage_key, gdrive_file_id, storage_state,
              ocr_raw_response, extracted_data, portal_verification_data,
              d.verification_status, d.verified_at, d.reviewed_at, d.review_method, d.review_notes,
              d.reviewed_by, reviewer.display_name AS reviewed_by_name, d.created_at
         FROM adm_student_documents d LEFT JOIN sys_users reviewer ON reviewer.id = d.reviewed_by
        WHERE d.student_id = ?
        ORDER BY d.id ASC`,
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
      documents: await Promise.all(documents.map(async (d) => {
        const extractedData = typeof d.extracted_data === 'string' ? JSON.parse(d.extracted_data) : d.extracted_data;
        const configuredSource = extractedData?.boardName
          ? await BoardSourceService.findForBoard(extractedData.boardName, extractedData.examYear)
          : null;
        return {
          ...d,
          extractedData,
          portalVerificationData: typeof d.portal_verification_data === 'string' ? JSON.parse(d.portal_verification_data) : d.portal_verification_data,
          boardSource: configuredSource ? {
            id: configuredSource.id,
            boardName: configuredSource.board_name,
            academicYear: configuredSource.academic_year,
            sourceType: configuredSource.source_type,
            resultUrl: configuredSource.result_url,
            gazetteFilename: configuredSource.gazette_filename,
          } : null,
        };
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
    reviewMethod,
    actorId,
    actorType = 'STAFF_USER',
  }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [studentRows] = await connection.execute(
        `SELECT id, cnic, overall_status, fsc_obtained_marks, matric_obtained_marks, phone_normalized, full_name FROM adm_students WHERE id = ? FOR UPDATE`,
        [studentId]
      );
      if (!studentRows.length) throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found.');
      const studentBefore = studentRows[0];
      let targetDocument = null;
      if (documentId) {
        const [documentRows] = await connection.execute(
          `SELECT id, doc_type, verification_status, storage_state, gdrive_file_id, storage_key, original_filename, file_mime
             FROM adm_student_documents WHERE id = ? AND student_id = ? FOR UPDATE`,
          [documentId, studentId]
        );
        if (!documentRows.length) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'The selected document does not belong to this candidate.');
        targetDocument = documentRows[0];
      }

      if (action === 'APPROVE') {
        if (!documentId) throw new AppError(400, 'DOCUMENT_REQUIRED', 'Choose a document before approving verification.');
        await connection.execute(
          `UPDATE adm_student_documents SET verification_status = ?, verified_at = CURRENT_TIMESTAMP(3),
                  reviewed_at = CURRENT_TIMESTAMP(3), reviewed_by = ?, review_method = ?, review_notes = ?
            WHERE id = ? AND student_id = ?`,
          [DOCUMENT_VERIFICATION_STATUS.MATCHED, actorId, reviewMethod, notes.trim(), documentId, studentId]
        );
        const [pending] = await connection.execute(`SELECT id FROM adm_student_documents WHERE student_id = ? AND verification_status NOT IN (?, ?)`, [studentId, DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED]);
        if (!pending.length) {
          await connection.execute(`UPDATE adm_students SET overall_status = ?, verified_at = CURRENT_TIMESTAMP(3), verified_by = ? WHERE id = ?`, [STUDENT_OVERALL_STATUS.VERIFIED, actorId, studentId]);
        } else {
          await connection.execute(`UPDATE adm_students SET overall_status = ?, verified_at = NULL, verified_by = NULL WHERE id = ?`, [STUDENT_OVERALL_STATUS.UNDER_REVIEW, studentId]);
        }
        await this._queueManualArchive({ targetDocument, studentId, studentCnic: studentBefore.cnic, connection });
      } else if (action === 'OVERRIDE_MARKS') {
        if (!documentId) throw new AppError(400, 'DOCUMENT_REQUIRED', 'Choose the document whose marks are being overridden.');
        if (![DOCUMENT_TYPES.FSC_MARKSHEET, DOCUMENT_TYPES.MATRIC_MARKSHEET].includes(targetDocument.doc_type) || (fscObtainedMarks === undefined && matricObtainedMarks === undefined)) {
          throw new AppError(400, 'MARKS_REQUIRED', 'Choose a marksheet and provide at least one verified marks value.');
        }
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
            STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW,
            studentId,
          ]
        );
        await connection.execute(
          `UPDATE adm_student_documents SET verification_status = ?, verified_at = CURRENT_TIMESTAMP(3),
                  reviewed_at = CURRENT_TIMESTAMP(3), reviewed_by = ?, review_method = ?, review_notes = ?
            WHERE id = ? AND student_id = ?`,
          [DOCUMENT_VERIFICATION_STATUS.MATCHED, actorId, reviewMethod, notes.trim(), documentId, studentId]
        );
        const [pending] = await connection.execute(`SELECT id FROM adm_student_documents WHERE student_id = ? AND verification_status NOT IN (?, ?)`, [studentId, DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED]);
        if (!pending.length) {
          await connection.execute(`UPDATE adm_students SET overall_status = ?, verified_at = CURRENT_TIMESTAMP(3), verified_by = ? WHERE id = ?`, [STUDENT_OVERALL_STATUS.VERIFIED, actorId, studentId]);
        } else {
          await connection.execute(`UPDATE adm_students SET verified_at = NULL, verified_by = NULL WHERE id = ?`, [studentId]);
        }
        await this._queueManualArchive({ targetDocument, studentId, studentCnic: studentBefore.cnic, connection });
      } else if (action === 'MARK_DISCREPANCY') {
        if (!targetDocument) throw new AppError(400, 'DOCUMENT_REQUIRED', 'Choose a document to mark as discrepant.');
        if (!discrepancyReason?.trim()) throw new AppError(400, 'DISCREPANCY_REASON_REQUIRED', 'Enter the reason for the discrepancy.');
        await connection.execute(`UPDATE adm_student_documents SET verification_status = ?, verified_at = NULL, reviewed_at = CURRENT_TIMESTAMP(3), reviewed_by = ?, review_method = ?, review_notes = ? WHERE id = ? AND student_id = ?`, [DOCUMENT_VERIFICATION_STATUS.DISCREPANCY, actorId, reviewMethod || 'STAFF_DOCUMENT', discrepancyReason.trim(), documentId, studentId]);
        await connection.execute(`UPDATE adm_students SET overall_status = ?, verified_at = NULL, verified_by = NULL, discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[Staff discrepancy]: ', ?) WHERE id = ?`, [STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW, discrepancyReason.trim(), studentId]);
      } else if (action === 'REJECT_AND_REISSUE') {
        if (!targetDocument) throw new AppError(400, 'DOCUMENT_REQUIRED', 'Choose the document that needs to be uploaded again.');
        if (!studentBefore.phone_normalized) throw new AppError(400, 'PHONE_REQUIRED', 'Add a valid phone number before reissuing an upload link.');
        await connection.execute(`UPDATE adm_student_documents SET verification_status = ?, verified_at = NULL, reviewed_at = CURRENT_TIMESTAMP(3), reviewed_by = ?, review_method = ?, review_notes = ? WHERE id = ? AND student_id = ?`, [DOCUMENT_VERIFICATION_STATUS.REJECTED, actorId, reviewMethod || 'STAFF_DOCUMENT', notes.trim(), documentId, studentId]);
        await connection.execute(
          `UPDATE adm_students SET overall_status = ?, verified_at = NULL, verified_by = NULL, discrepancy_notes = CONCAT(COALESCE(discrepancy_notes, ''), '\n[Manual Reissue]: ', ?) WHERE id = ?`,
          [STUDENT_OVERALL_STATUS.DOCS_REQUESTED, notes || 'Staff requested re-upload', studentId]
        );
        await connection.execute(`UPDATE adm_intake_tokens SET is_revoked = TRUE WHERE student_id = ? AND used_at IS NULL AND is_revoked = FALSE`, [studentId]);
        const token = await IntakeTokenService.generateToken({
          studentId,
          allowedDocTypes: [targetDocument.doc_type],
          expiresInHours: 48,
          connection,
        });
        const uploadUrl = `${config.APP_ORIGIN}/upload/${token.rawToken}`;
        await dispatchJob({ queueName: 'whatsapp_outreach', jobType: EVENT_TYPES.WHATSAPP_MESSAGE, payload: {
          recipientPhone: studentBefore.phone_normalized,
          messageType: 'TRANSACTIONAL',
          messageText: `Admissions document update for ${studentBefore.full_name}: ${notes || 'Please upload a replacement document.'}\n${uploadUrl}\nThis link expires in 48 hours.`,
          metadata: { module: 'MODULE_3_VERIFICATION', studentId, tokenId: token.tokenId },
        }, connection });
      }

      await logAudit({
        actorType,
        actorId,
        eventCategory: 'VERIFICATION',
        action: `MANUAL_REVIEW_${action}`,
        entityTable: 'adm_students',
        entityId: String(studentId),
        before: studentBefore,
        after: { action, documentId, fscObtainedMarks, matricObtainedMarks, reviewMethod, notes, actorId },
        connection,
      });

      const [studentAfter] = await connection.execute(`SELECT overall_status, verified_at, verified_by FROM adm_students WHERE id = ?`, [studentId]);
      await connection.commit();
      return { success: true, action, studentId, ...studentAfter[0] };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async _queueManualArchive({ targetDocument, studentId, studentCnic, connection }) {
    if (!targetDocument || !targetDocument.storage_key || targetDocument.gdrive_file_id
      || [STORAGE_STATE.ARCHIVED_GDRIVE, STORAGE_STATE.DELETED].includes(targetDocument.storage_state)) return;
    if ([DOCUMENT_VERIFICATION_STATUS.MATCHED, DOCUMENT_VERIFICATION_STATUS.PORTAL_VERIFIED].includes(targetDocument.verification_status)) return;
    await dispatchJob({
      queueName: 'storage_migration',
      jobType: EVENT_TYPES.MIGRATE_GDRIVE,
      payload: {
        documentId: targetDocument.id,
        studentId,
        studentCnic: studentCnic || '0000000000000',
        filename: targetDocument.original_filename,
        r2Key: targetDocument.storage_key,
        fileMime: targetDocument.file_mime,
      },
      connection,
    });
  }
}

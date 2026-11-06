import { pool } from '../../../core/db/pool.js';
import { AdmissionIntakeService } from '../services/admission-intake.service.js';
import { DiscrepancyParserService } from '../services/discrepancy-parser.service.js';
import { IntakeTokenService } from '../services/intake-token.service.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  manualReviewActionSchema,
  reissueTokenSchema,
} from '../verification.schemas.js';
import { AppError } from '../../../core/errors/app-error.js';
import { config } from '../../../core/config/env.js';
import { BoardSourceService } from '../services/board-source.service.js';
import { StorageService } from '../services/storage/storage.service.js';

export class StaffVerificationController {
  static async listBoardSources(_req, res, next) {
    try { res.json({ status: 'success', data: await BoardSourceService.list() }); }
    catch (err) { next(err); }
  }

  static async saveBoardSource(req, res, next) {
    try {
      const result = await BoardSourceService.save({ ...req.body, file: req.file, actorId: req.auth.userId });
      res.status(201).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  static async deactivateBoardSource(req, res, next) {
    try {
      const result = await BoardSourceService.deactivate(Number(req.params.sourceId), req.auth.userId);
      res.json({ status: 'success', data: result });
    } catch (err) { next(err); }
  }

  static async downloadBoardGazette(req, res, next) {
    try {
      const sourceId = Number(req.params.sourceId);
      const [rows] = await pool.execute(
        `SELECT gazette_filename, storage_provider, storage_key FROM adm_board_sources
          WHERE id = ? AND is_active = TRUE AND source_type = 'GAZETTE'`,
        [sourceId]
      );
      if (!rows.length || !rows[0].storage_key) throw new AppError(404, 'GAZETTE_NOT_FOUND', 'The gazette is no longer available.');
      const buffer = await StorageService.getFileBuffer(rows[0].storage_key, rows[0].storage_provider);
      const filename = String(rows[0].gazette_filename || 'board-gazette.pdf').replace(/["\\\r\n]/g, '_');
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'private, no-store' });
      res.send(buffer);
    } catch (err) { next(err); }
  }

  static async viewStudentDocument(req, res, next) {
    try {
      const studentId = Number(req.params.studentId);
      const documentId = Number(req.params.documentId);
      if (!Number.isSafeInteger(studentId) || studentId < 1 || !Number.isSafeInteger(documentId) || documentId < 1) {
        throw new AppError(400, 'INVALID_DOCUMENT_REFERENCE', 'The document reference is invalid.');
      }
      const [rows] = await pool.execute(
        `SELECT original_filename, file_mime, storage_provider, storage_key, storage_state, gdrive_file_id
           FROM adm_student_documents WHERE id = ? AND student_id = ?`,
        [documentId, studentId]
      );
      if (!rows.length || rows[0].storage_state === 'DELETED') {
        throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'This candidate document is no longer available.');
      }
      const document = rows[0];
      const buffer = document.storage_state === 'ARCHIVED_GDRIVE'
        ? await StorageService.getArchivedFileBuffer(document.gdrive_file_id)
        : await StorageService.getFileBuffer(document.storage_key, document.storage_provider);
      const filename = String(document.original_filename || 'candidate-document').replace(/["\\\r\n]/g, '_');
      res.set({
        'Content-Type': document.file_mime,
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(buffer);
    } catch (err) { next(err); }
  }

  /**
   * List candidates in manual review queue or with discrepancies
   */
  static async listReviewQueue(req, res, next) {
    try {
      const { limit = 50, offset = 0, status } = req.query;
      const queue = await AdmissionIntakeService.listManualReviewQueue({ limit, offset, status });
      res.json({ status: 'success', data: queue });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get student full verification dossier (uploaded images, OCR, board results)
   */
  static async getStudentDossier(req, res, next) {
    try {
      const dossier = await AdmissionIntakeService.getStudentReviewDossier(Number(req.params.studentId));
      res.json({ status: 'success', data: dossier });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update student phone number
   */
  static async updatePhone(req, res, next) {
    try {
      const studentId = Number(req.params.studentId);
      const { phone } = req.body;
      const result = await AdmissionIntakeService.updateStudentPhone(studentId, phone);
      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Staff action on manual review candidate
   */
  static async executeReviewAction(req, res, next) {
    try {
      const payload = manualReviewActionSchema.parse({
        ...req.body,
        studentId: req.params.studentId || req.body.studentId,
      });

      const result = await AdmissionIntakeService.executeManualReviewAction({
        ...payload,
        actorId: req.auth?.userId || req.user?.id || null,
        actorType: 'STAFF_USER',
      });

      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Ingest discrepancy spreadsheet (CSV upload or JSON)
   */
  static async importDiscrepancies(req, res, next) {
    try {
      let records = [];

      if (req.file && req.file.buffer) {
        records = DiscrepancyParserService.parseDiscrepancyCsv(req.file.buffer);
      } else if (Array.isArray(req.body?.students)) {
        records = req.body.students;
      } else {
        return res.status(400).json({ error: 'Provide a CSV file upload or a JSON "students" array.' });
      }

      const result = await DiscrepancyParserService.ingestDiscrepancies(records);
      res.status(201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Reissue intake token manually by staff
   */
  static async reissueToken(req, res, next) {
    try {
      const payload = reissueTokenSchema.parse(req.body);
      const studentId = payload.studentId;

      // 1. Verify if candidate exists in adm_students
      const [students] = await pool.execute(
        `SELECT id, full_name, phone_normalized FROM adm_students WHERE id = ?`,
        [studentId]
      );

      let targetStudentId = studentId;
      let student = students[0];

      // 2. If not found in adm_students, check if it is a lead from mkt_leads
      if (!student) {
        const [leads] = await pool.execute(
          `SELECT id, full_name, phone_normalized, fsc_marks, prior_degree, city FROM mkt_leads WHERE id = ?`,
          [studentId]
        );

        if (leads.length) {
          const lead = leads[0];
          const [admByLead] = await pool.execute(
            `SELECT id, full_name, phone_normalized FROM adm_students WHERE lead_id = ? OR phone_normalized = ? LIMIT 1`,
            [lead.id, lead.phone_normalized]
          );

          if (admByLead.length) {
            targetStudentId = admByLead[0].id;
            student = admByLead[0];
          } else {
            // Auto-create admissions candidate record from qualified lead
            const [insert] = await pool.execute(
              `INSERT INTO adm_students (lead_id, full_name, phone_normalized, city, prior_degree, fsc_obtained_marks, overall_status)
               VALUES (?, ?, ?, ?, ?, ?, 'DOCS_REQUESTED')`,
              [lead.id, lead.full_name, lead.phone_normalized, lead.city || null, lead.prior_degree || null, lead.fsc_marks || 0]
            );
            targetStudentId = insert.insertId;
            student = {
              id: targetStudentId,
              full_name: lead.full_name,
              phone_normalized: lead.phone_normalized,
            };
          }
        } else {
          throw new AppError(
            404,
            'STUDENT_NOT_FOUND',
            `Candidate with ID #${studentId} was not found in Admissions or Leads. Please check the ID or upload a discrepancy CSV first.`
          );
        }
      }

      // 3. Mint fresh capability token
      const tokenData = await IntakeTokenService.generateToken({
        studentId: targetStudentId,
        allowedDocTypes: payload.allowedDocTypes,
        expiresInHours: payload.expiresInHours,
      });

      // 4. Dispatch WhatsApp notice via Outbox
      const uploadUrl = `${config.APP_ORIGIN}/upload/${tokenData.rawToken}`;
      const docListFormatted = payload.allowedDocTypes.map((d) => d.replace(/_/g, ' ')).join(', ');
      const messageText = `📋 *Admissions Update for ${student.full_name}:*

Your document upload link has been issued.

👉 *Click the link below to open the upload portal:*
${uploadUrl}

*(Required: ${docListFormatted} | Link expires in ${payload.expiresInHours} hours)*`;

      await dispatchJob({
        queueName: 'whatsapp_outreach',
        jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
        payload: {
          recipientPhone: student.phone_normalized,
          messageType: 'TRANSACTIONAL',
          messageText,
          metadata: {
            module: 'MODULE_3_VERIFICATION',
            studentId: targetStudentId,
            tokenId: tokenData.tokenId,
          },
        },
      });

      res.status(201).json({
        status: 'success',
        data: {
          studentId: targetStudentId,
          studentName: student.full_name,
          tokenId: tokenData.tokenId,
          expiresAt: tokenData.expiresAt,
          uploadUrl,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

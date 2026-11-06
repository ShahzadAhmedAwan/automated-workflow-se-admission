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

export class StaffVerificationController {
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

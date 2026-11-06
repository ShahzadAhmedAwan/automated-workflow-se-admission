import { parse } from 'csv-parse/sync';
import { pool } from '../../../core/db/pool.js';
import { normalizePhoneNumber } from '../../marketing/services/csv-parser.service.js';
import { IntakeTokenService } from './intake-token.service.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import { DOCUMENT_TYPES, STUDENT_OVERALL_STATUS } from '../verification.constants.js';
import { config } from '../../../core/config/env.js';

export class DiscrepancyParserService {
  /**
   * Parse discrepancy CSV buffer and map to standardized records
   */
  static parseDiscrepancyCsv(buffer) {
    const content = buffer.toString('utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((row) => {
      // Fuzzy header matching
      const appNo = row['Application No'] || row['application_no'] || row['AppNo'] || null;
      const cnic = row['CNIC'] || row['cnic'] || null;
      const fullName = row['Full Name'] || row['Name'] || row['Student Name'] || row['full_name'] || '';
      const fatherName = row['Father Name'] || row['father_name'] || null;
      const phoneRaw = row['Phone'] || row['Mobile'] || row['Contact'] || row['phone'] || '';
      const email = row['Email'] || row['email'] || null;
      const fscMarks = row['FSc Marks'] || row['fsc_marks'] || row['HSSC Marks'] || null;
      const matricMarks = row['Matric Marks'] || row['matric_marks'] || row['SSC Marks'] || null;
      const issues = row['Issues'] || row['Missing Documents'] || row['Discrepancies'] || row['issues'] || '';

      const phoneNormalized = normalizePhoneNumber(phoneRaw);
      const mappedDocs = this.mapIssueStringToDocTypes(issues);

      return {
        applicationNo: appNo ? String(appNo).trim() : null,
        cnic: cnic ? String(cnic).replace(/\D/g, '') : null,
        fullName: fullName.trim(),
        fatherName: fatherName ? fatherName.trim() : null,
        phoneRaw,
        phoneNormalized,
        email: email ? email.trim() : null,
        fscMarks: fscMarks ? Number(fscMarks) : null,
        matricMarks: matricMarks ? Number(matricMarks) : null,
        allowedDocTypes: mappedDocs,
      };
    });
  }

  /**
   * Map delimiter-separated string to standard DOCUMENT_TYPES enum values
   */
  static mapIssueStringToDocTypes(issueStr) {
    if (!issueStr) return [DOCUMENT_TYPES.FSC_MARKSHEET];

    const tokens = issueStr
      .split(/[;,|/]/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);

    const mapped = new Set();

    for (const t of tokens) {
      if (t.includes('MATRIC') || t.includes('SSC') || t.includes('10TH')) {
        mapped.add(DOCUMENT_TYPES.MATRIC_MARKSHEET);
      } else if (t.includes('FSC') || t.includes('HSSC') || t.includes('INTER') || t.includes('12TH')) {
        mapped.add(DOCUMENT_TYPES.FSC_MARKSHEET);
      } else if (t.includes('CNIC_FRONT') || t.includes('ID_FRONT') || (t.includes('CNIC') && t.includes('FRONT'))) {
        mapped.add(DOCUMENT_TYPES.CNIC_FRONT);
      } else if (t.includes('CNIC_BACK') || t.includes('ID_BACK') || (t.includes('CNIC') && t.includes('BACK'))) {
        mapped.add(DOCUMENT_TYPES.CNIC_BACK);
      } else if (t.includes('DOMICILE')) {
        mapped.add(DOCUMENT_TYPES.DOMICILE);
      } else if (t.includes('EQUIVALENCE')) {
        mapped.add(DOCUMENT_TYPES.EQUIVALENCE_CERTIFICATE);
      } else if (Object.values(DOCUMENT_TYPES).includes(t)) {
        mapped.add(t);
      } else {
        mapped.add(DOCUMENT_TYPES.OTHER);
      }
    }

    return mapped.size ? Array.from(mapped) : [DOCUMENT_TYPES.FSC_MARKSHEET];
  }

  /**
   * Ingest list of discrepancy records into adm_students, mint tokens, and dispatch WhatsApp alerts
   */
  static async ingestDiscrepancies(records, db = pool) {
    const connection = await db.getConnection();
    const results = {
      total: records.length,
      created: 0,
      updated: 0,
      tokensMinted: 0,
      errors: [],
    };

    try {
      for (const rec of records) {
        if (!rec.phoneNormalized) {
          results.errors.push({ fullName: rec.fullName, error: 'Invalid phone number' });
          continue;
        }

        await connection.beginTransaction();

        try {
          // Check if student exists by phone or CNIC
          let studentId = null;
          let [existing] = await connection.execute(
            `SELECT id, overall_status FROM adm_students WHERE phone_normalized = ? OR (cnic IS NOT NULL AND cnic = ?) LIMIT 1 FOR UPDATE`,
            [rec.phoneNormalized, rec.cnic || '']
          );

          if (existing.length) {
            studentId = existing[0].id;
            await connection.execute(
              `UPDATE adm_students
                  SET full_name = COALESCE(?, full_name),
                      father_name = COALESCE(?, father_name),
                      application_no = COALESCE(?, application_no),
                      cnic = COALESCE(?, cnic),
                      email = COALESCE(?, email),
                      fsc_obtained_marks = COALESCE(?, fsc_obtained_marks),
                      matric_obtained_marks = COALESCE(?, matric_obtained_marks),
                      overall_status = ?
                WHERE id = ?`,
              [
                rec.fullName || null,
                rec.fatherName || null,
                rec.applicationNo || null,
                rec.cnic || null,
                rec.email || null,
                rec.fscMarks || null,
                rec.matricMarks || null,
                STUDENT_OVERALL_STATUS.DOCS_REQUESTED,
                studentId,
              ]
            );
            results.updated++;
          } else {
            const [insertResult] = await connection.execute(
              `INSERT INTO adm_students (application_no, cnic, full_name, father_name, phone_normalized, email,
                                         fsc_obtained_marks, matric_obtained_marks, overall_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                rec.applicationNo || null,
                rec.cnic || null,
                rec.fullName,
                rec.fatherName || null,
                rec.phoneNormalized,
                rec.email || null,
                rec.fscMarks || null,
                rec.matricMarks || null,
                STUDENT_OVERALL_STATUS.DOCS_REQUESTED,
              ]
            );
            studentId = insertResult.insertId;
            results.created++;
          }

          // Mint new 48-hour intake token
          const tokenData = await IntakeTokenService.generateToken({
            studentId,
            allowedDocTypes: rec.allowedDocTypes,
            expiresInHours: 48,
            connection,
          });

          // Dispatch transactional WhatsApp message via Outbox
          const uploadUrl = `${config.APP_ORIGIN}/upload/${tokenData.rawToken}`;
          const docListFormatted = rec.allowedDocTypes.map((d) => d.replace(/_/g, ' ')).join(', ');
          const messageText = `Dear ${rec.fullName}, your admissions profile requires verification of the following documents: ${docListFormatted}. Please submit clear copies within 48 hours using your secure link: ${uploadUrl}`;

          await dispatchJob({
            queueName: 'whatsapp_outreach',
            jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
            payload: {
              recipientPhone: rec.phoneNormalized,
              messageType: 'TRANSACTIONAL',
              messageText,
              metadata: {
                module: 'MODULE_3_VERIFICATION',
                studentId,
                tokenId: tokenData.tokenId,
              },
            },
            connection,
          });

          await connection.commit();
          results.tokensMinted++;
        } catch (err) {
          await connection.rollback();
          results.errors.push({ fullName: rec.fullName, error: err.message });
        }
      }
    } finally {
      connection.release();
    }

    return results;
  }
}

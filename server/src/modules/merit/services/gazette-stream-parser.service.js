import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { GazetteSearchService } from '../../verification/services/gazette-search.service.js';
import { RESULT_SOURCES } from '../merit.constants.js';

export class GazetteStreamParserService {
  /**
   * Parse text extracted from PDF gazette buffer into structured candidate records
   */
  static parseGazetteText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const records = [];

    // Typical Pakistani Gazette line patterns:
    // Pattern 1: 541209  MUHAMMAD AHMAD   TARIQ MEHMOOD   890   PASS
    // Pattern 2: 104231  ALI RAZA         720   PASS
    // Pattern 3: 420912  82101-1234567-1  ZAINAB BIBI     950   PASS
    for (const line of lines) {
      // Look for line starting with roll number (5 to 8 digits)
      const rollMatch = line.match(/^(\d{5,8})\b/);
      if (!rollMatch) continue;

      const rollNo = rollMatch[1];
      const afterRoll = line.slice(rollMatch[0].length).trim();

      // Look for marks (number between 200 and 1100, or 30 to 100)
      const marksMatch = afterRoll.match(/\b(\d{2,4})\b(?:\s+(PASS|FAIL|COMPARTMENT))?/i);
      if (!marksMatch) continue;

      const marksObtained = parseFloat(marksMatch[1]);
      const status = (marksMatch[2] || (marksObtained >= 50 ? 'PASS' : 'FAIL')).toUpperCase();

      // Look for optional CNIC in line
      const cnicMatch = line.match(/(\d{5}-?\d{7}-?\d{1})/);
      const cnic = cnicMatch ? cnicMatch[1] : null;

      // The name is typically the text between roll number and marks
      let candidateName = null;
      let fatherName = null;
      const textBeforeMarks = afterRoll.split(marksMatch[0])[0].trim();
      if (textBeforeMarks) {
        const cleanName = textBeforeMarks.replace(/(\d{5}-?\d{7}-?\d{1})/, '').replace(/[^a-zA-Z\s.]/g, '').trim();
        if (cleanName.length >= 3) {
          const parts = cleanName.split(/\s{2,}|\s+S\/O\s+|\s+D\/O\s+/i);
          candidateName = parts[0]?.trim();
          fatherName = parts[1]?.trim() || null;
        }
      }

      records.push({
        rollNo,
        candidateName: candidateName || `Roll ${rollNo}`,
        fatherName,
        cnic,
        marksObtained,
        totalMarks: marksObtained <= 100 ? 100 : (marksObtained <= 550 ? 550 : 1100),
        status,
      });
    }

    return records;
  }

  /**
   * Process uploaded official gazette PDF buffer, extract results, and backfill adm_students
   */
  static async processGazetteBuffer(pdfBuffer, options = {}, db = pool) {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new AppError(400, 'INVALID_FILE', 'Valid PDF buffer is required.');
    }

    const { boardOrTestName = 'OFFICIAL_BOARD', academicYear = '2026' } = options;

    let extractedText = '';
    try {
      try {
        const pdfParseModule = await import('pdf-parse');
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const pdfData = await pdfParse(pdfBuffer);
        extractedText = pdfData.text || '';
      } catch {
        // Fallback to internal zero-dependency pure Node stream extractor
        extractedText = GazetteSearchService.extractTextFromPdfBuffer(pdfBuffer);
      }
    } catch (parseErr) {
      throw new AppError(422, 'PDF_PARSE_FAILED', `Could not extract text layer from PDF: ${parseErr.message}`);
    }

    const records = GazetteStreamParserService.parseGazetteText(extractedText);
    if (!records.length) {
      return {
        totalExtracted: 0,
        matchedStudents: 0,
        message: 'No candidate records could be matched with the standard gazette format.',
      };
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let matchedStudents = 0;
      const batchSize = 100;

      for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        for (const item of chunk) {
          const pct = (item.marksObtained / item.totalMarks) * 100;

          // 1. Insert into mrt_official_results
          await connection.execute(
            `INSERT INTO mrt_official_results (
               source_type, board_or_test_name, cnic, roll_no, candidate_name, father_name,
               marks_obtained, total_marks, percentage, status, raw_payload
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              RESULT_SOURCES.BOARD_GAZETTE,
              boardOrTestName,
              item.cnic,
              item.rollNo,
              item.candidateName,
              item.fatherName,
              item.marksObtained,
              item.totalMarks,
              pct,
              item.status,
              JSON.stringify(item),
            ]
          );

          // 2. Cross-match against adm_students by CNIC or Roll No
          const queryParams = [];
          let matchSql = '';
          if (item.cnic) {
            matchSql = 'SELECT id, overall_status FROM adm_students WHERE cnic = ? OR fsc_roll_no = ? LIMIT 1';
            queryParams.push(item.cnic, item.rollNo);
          } else {
            matchSql = 'SELECT id, overall_status FROM adm_students WHERE fsc_roll_no = ? LIMIT 1';
            queryParams.push(item.rollNo);
          }

          const [matched] = await connection.query(matchSql, queryParams);
          if (matched.length) {
            matchedStudents++;
            const studentId = matched[0].id;
            // Backfill marks
            if (item.totalMarks === 100) {
              await connection.execute(
                `UPDATE adm_students
                 SET entry_test_marks = ?, entry_test_total = 100, entry_test_roll_no = ?
                 WHERE id = ?`,
                [item.marksObtained, item.rollNo, studentId]
              );
            } else {
              await connection.execute(
                `UPDATE adm_students
                 SET fsc_obtained_marks = ?, fsc_total_marks = ?
                 WHERE id = ?`,
                [item.marksObtained, item.totalMarks, studentId]
              );
            }
          }
        }
      }

      await connection.commit();

      return {
        totalExtracted: records.length,
        matchedStudents,
        academicYear,
        boardOrTestName,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

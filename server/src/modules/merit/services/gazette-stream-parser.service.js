import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { GazetteSearchService } from '../../verification/services/gazette-search.service.js';
import { RESULT_SOURCES } from '../merit.constants.js';

export class GazetteStreamParserService {
  /**
   * Parse text extracted from PDF gazette buffer into structured SEET / entry test candidate records.
   */
  static parseGazetteText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const records = [];

    for (let line of lines) {
      // Optional serial number prefix (e.g., "1. 40921" or "10  SEET26-001")
      const srMatch = line.match(/^\d{1,4}[.)\]]?\s+(?=[A-Za-z0-9])/);
      if (srMatch && srMatch[0].length < line.length / 2) {
        const afterSr = line.slice(srMatch[0].length).trim();
        if (/^(SEET|\d{4,8}\b)/i.test(afterSr)) {
          line = afterSr;
        }
      }

      // Check for roll number at the start:
      // Can be:
      // 1. Alphanumeric SEET prefix: e.g. SEET26-P2-UAJK-19, SEET-40921, ET-1049
      // 2. Numeric 4 to 8 digits: e.g. 40921, 540101, 104231
      const rollMatch = line.match(/^((?:SEET|ET)[A-Za-z0-9\-_/]*|\d{4,8})\b/i);
      if (!rollMatch) continue;

      const rollNo = rollMatch[1];
      const afterRoll = line.slice(rollMatch[0].length).trim();

      // Look for optional 13-digit CNIC anywhere in the line
      const cnicMatch = line.match(/(\d{5}-?\d{7}-?\d{1})/);
      const cnic = cnicMatch ? cnicMatch[1] : null;

      // Extract marks and status
      let marksObtained = null;
      let status = null;

      // Pattern A: Marks and status at the end of line
      const endMarksMatch = afterRoll.match(/\b(\d{1,4}(?:\.\d+)?)\s*(PASS|FAIL|COMPARTMENT)?\s*$/i);
      if (endMarksMatch) {
        marksObtained = parseFloat(endMarksMatch[1]);
        if (endMarksMatch[2]) {
          status = endMarksMatch[2].toUpperCase();
        }
      } else {
        // Pattern B: Marks anywhere in afterRoll
        const midMarksMatch = afterRoll.match(/\b(\d{1,4}(?:\.\d+)?)\b(?:\s+(PASS|FAIL|COMPARTMENT))?/i);
        if (midMarksMatch) {
          marksObtained = parseFloat(midMarksMatch[1]);
          if (midMarksMatch[2]) {
            status = midMarksMatch[2].toUpperCase();
          }
        }
      }

      if (marksObtained === null || isNaN(marksObtained)) continue;

      // In SEET gazettes, total marks is 100 with 40% passing threshold.
      // If marks > 100, it corresponds to legacy 550 or 1100 board gazette marks.
      const totalMarks = marksObtained <= 100 ? 100 : (marksObtained <= 550 ? 550 : 1100);
      if (!status) {
        status = totalMarks === 100
          ? (marksObtained >= 40 ? 'PASS' : 'FAIL')
          : (marksObtained >= 363 ? 'PASS' : 'FAIL');
      }

      // Candidate Name & Father Name extraction
      let nameText = afterRoll;
      if (cnicMatch) {
        nameText = nameText.replace(cnicMatch[0], ' ');
      }
      nameText = nameText.replace(/\b\d{1,4}(?:\.\d+)?\b/g, ' ');
      nameText = nameText.replace(/\b(PASS|FAIL|COMPARTMENT)\b/gi, ' ');
      nameText = nameText.replace(/[^a-zA-Z\s.]/g, ' ').trim();

      let candidateName = null;
      let fatherName = null;

      if (nameText.length >= 3) {
        const relationMatch = nameText.match(/\s+(?:S\/O|D\/O|SO|DO)\s+/i);
        if (relationMatch) {
          const parts = nameText.split(relationMatch[0]);
          candidateName = parts[0]?.trim();
          fatherName = parts[1]?.trim() || null;
        } else {
          const parts = nameText.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
          if (parts.length >= 2) {
            candidateName = parts[0];
            fatherName = parts[1];
          } else {
            const words = nameText.split(/\s+/).filter(Boolean);
            if (words.length >= 4) {
              const mid = Math.ceil(words.length / 2);
              candidateName = words.slice(0, mid).join(' ');
              fatherName = words.slice(mid).join(' ');
            } else {
              candidateName = nameText;
            }
          }
        }
      }

      records.push({
        rollNo,
        candidateName: candidateName || `Roll ${rollNo}`,
        fatherName,
        cnic,
        marksObtained,
        totalMarks,
        status,
      });
    }

    return records;
  }

  /**
   * Process uploaded official SEET entrance test gazette PDF buffer,
   * extract results, and backfill candidates with pending SEET scores.
   */
  static async processGazetteBuffer(pdfBuffer, options = {}, db = pool) {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      throw new AppError(400, 'INVALID_FILE', 'Valid PDF buffer is required.');
    }

    const { boardOrTestName = 'UAJK_SEET_TEST', academicYear = '2026' } = options;

    let extractedText = '';
    try {
      try {
        const pdfParseModule = await import('pdf-parse');
        const pdfParse = pdfParseModule.default || pdfParseModule;
        const pdfData = await pdfParse(pdfBuffer);
        extractedText = pdfData?.text || '';
      } catch {
        // Fallback to internal zero-dependency pure Node stream extractor
      }
      if (!extractedText || !extractedText.trim()) {
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
        matchedPendingStudents: 0,
        remainingPending: 0,
        message: 'No candidate records could be matched with the SEET gazette format.',
      };
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Insert extracted SEET scores into mrt_official_results for institutional audit
      const batchSize = 100;
      for (let i = 0; i < records.length; i += batchSize) {
        const chunk = records.slice(i, i + batchSize);
        for (const item of chunk) {
          const pct = item.totalMarks > 0 ? (item.marksObtained / item.totalMarks) * 100 : 0;
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
        }
      }

      // 2. Build fast in-memory lookup indexes for candidate cross-matching
      const byCnic = new Map();
      const byRoll = new Map();
      const byName = new Map();

      for (const item of records) {
        if (item.cnic) {
          const normCnic = String(item.cnic).replace(/\D/g, '');
          if (normCnic.length === 13) {
            byCnic.set(normCnic, item);
          }
        }
        if (item.rollNo) {
          byRoll.set(String(item.rollNo).trim().toUpperCase(), item);
        }
        if (item.candidateName) {
          const normName = String(item.candidateName).toLowerCase().replace(/[^a-z]/g, '');
          if (normName.length >= 3 && !byName.has(normName)) {
            byName.set(normName, item);
          }
        }
      }

      // 3. Search specifically for students in adm_students with pending SEET scores
      const [pendingStudents] = await connection.query(
        `SELECT id, application_no, cnic, full_name, father_name, fsc_roll_no, entry_test_roll_no, entry_test_marks, overall_status
         FROM adm_students
         WHERE (entry_test_marks IS NULL OR entry_test_marks = 0)
         ORDER BY id ASC`
      );

      const matchedDetails = [];

      for (const student of pendingStudents) {
        let matchedRecord = null;

        // Match Strategy A: 13-digit CNIC match (highest confidence)
        if (student.cnic) {
          const cnicDigits = String(student.cnic).replace(/\D/g, '');
          if (cnicDigits.length === 13 && byCnic.has(cnicDigits)) {
            matchedRecord = byCnic.get(cnicDigits);
          }
        }

        // Match Strategy B: Entry test roll number match
        if (!matchedRecord && student.entry_test_roll_no) {
          const rollKey = String(student.entry_test_roll_no).trim().toUpperCase();
          if (byRoll.has(rollKey)) {
            matchedRecord = byRoll.get(rollKey);
          }
        }

        // Match Strategy C: FSc roll number match
        if (!matchedRecord && student.fsc_roll_no) {
          const fscKey = String(student.fsc_roll_no).trim().toUpperCase();
          if (byRoll.has(fscKey)) {
            matchedRecord = byRoll.get(fscKey);
          }
        }

        // Match Strategy D: Normalized candidate name match (+ father name check)
        if (!matchedRecord && student.full_name) {
          const nameKey = String(student.full_name).toLowerCase().replace(/[^a-z]/g, '');
          if (nameKey.length >= 4 && byName.has(nameKey)) {
            const candidateRecord = byName.get(nameKey);
            if (student.father_name && candidateRecord.fatherName) {
              const studentFather = String(student.father_name).toLowerCase().replace(/[^a-z]/g, '');
              const recFather = String(candidateRecord.fatherName).toLowerCase().replace(/[^a-z]/g, '');
              if (studentFather.includes(recFather) || recFather.includes(studentFather)) {
                matchedRecord = candidateRecord;
              }
            } else {
              matchedRecord = candidateRecord;
            }
          }
        }

        if (matchedRecord) {
          await connection.execute(
            `UPDATE adm_students
             SET entry_test_marks = ?, entry_test_total = 100.00, entry_test_roll_no = COALESCE(?, entry_test_roll_no)
             WHERE id = ?`,
            [matchedRecord.marksObtained, matchedRecord.rollNo, student.id]
          );

          matchedDetails.push({
            studentId: student.id,
            studentName: student.full_name,
            cnic: student.cnic,
            rollNo: matchedRecord.rollNo,
            entryTestMarks: matchedRecord.marksObtained,
            status: matchedRecord.status,
          });
        }
      }

      // 4. Calculate remaining pending candidates count
      let remainingPending = 0;
      try {
        const [pendingCountRes] = await connection.query(
          `SELECT COUNT(*) AS remainingCount
           FROM adm_students
           WHERE (entry_test_marks IS NULL OR entry_test_marks = 0)`
        );
        remainingPending = Number(pendingCountRes[0]?.remainingCount || 0);
      } catch {
        remainingPending = Math.max(0, pendingStudents.length - matchedDetails.length);
      }

      await connection.commit();

      return {
        totalExtracted: records.length,
        matchedStudents: matchedDetails.length,
        matchedPendingStudents: matchedDetails.length,
        remainingPending,
        matchedDetails,
        academicYear,
        boardOrTestName,
        message: `Processed SEET Gazette: ${records.length} scores parsed. ${matchedDetails.length} candidates with pending SEET scores updated. ${remainingPending} candidates still pending.`,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

export const SeetGazetteParserService = GazetteStreamParserService;

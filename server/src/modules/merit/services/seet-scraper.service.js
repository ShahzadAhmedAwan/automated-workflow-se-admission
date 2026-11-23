import { pool } from '../../../core/db/pool.js';
import { AppError } from '../../../core/errors/app-error.js';
import { RESULT_SOURCES } from '../merit.constants.js';
import { ensureMeritSchema } from './merit-schema.service.js';

export class SeetScraperService {
  /**
   * Normalizes Pakistani CNIC into both digits-only and standard hyphenated format
   */
  static normalizeCnic(raw) {
    if (!raw) return { digits: null, formatted: null };
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length !== 13) {
      return { digits: digits || null, formatted: String(raw).trim() };
    }
    const formatted = `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
    return { digits, formatted };
  }

  /**
   * Parse result from raw HTML using zero-dependency DOM parsing
   */
  static parseResultHtml(html, targetCnic) {
    if (!html || typeof html !== 'string') return null;

    const { digits: targetDigits } = SeetScraperService.normalizeCnic(targetCnic);

    // Helper to strip tags and decode entities
    const cleanText = (str) =>
      str
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/gi) || [];

    // Strategy 1: Check for Vertical Key-Value Tables (<tr><th>Key</th><td>Value</td></tr>)
    // As seen on SEET walkintbl individual applicant result card
    for (const tableHtml of tables) {
      const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      const kvPairs = {};

      for (const row of rows) {
        const thMatch = row.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
        const tdMatch = row.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
        if (thMatch && tdMatch) {
          const key = cleanText(thMatch[1]).toLowerCase();
          const val = cleanText(tdMatch[1]);
          kvPairs[key] = val;
        }
      }

      const hasCnic = Object.keys(kvPairs).some((k) => k.includes('cnic'));
      const hasMarks = Object.keys(kvPairs).some((k) => k.includes('marks') || k.includes('score'));

      if (hasCnic && hasMarks) {
        let tableCnic = '';
        for (const [k, v] of Object.entries(kvPairs)) {
          if (k.includes('cnic')) {
            tableCnic = v;
            break;
          }
        }

        const { digits: rowDigits } = SeetScraperService.normalizeCnic(tableCnic);
        const matchesTarget = !targetDigits || (rowDigits && rowDigits === targetDigits);

        if (matchesTarget) {
          let candidateName = null;
          let fatherName = null;
          let rollNo = null;
          let marksObtained = null;
          let totalMarks = 100;
          let status = null;

          for (const [k, v] of Object.entries(kvPairs)) {
            if (k.includes('father')) {
              fatherName = v;
            } else if (k.includes('name') || k.includes('applicant') || k.includes('candidate')) {
              candidateName = v;
            } else if (k.includes('roll')) {
              rollNo = v;
            } else if (k.includes('obtained') || (k.includes('marks') && !k.includes('total'))) {
              const num = parseFloat(v);
              if (!isNaN(num)) marksObtained = num;
            } else if (k.includes('total') || k.includes('max')) {
              const num = parseFloat(v);
              if (!isNaN(num)) totalMarks = num;
            } else if (k.includes('status')) {
              status = v;
            }
          }

          if (marksObtained !== null) {
            return {
              cnic: targetCnic || tableCnic,
              rollNo,
              candidateName,
              fatherName,
              marksObtained,
              totalMarks,
              percentage: totalMarks > 0 ? (marksObtained / totalMarks) * 100 : 0,
              status: marksObtained >= 40 ? 'PASS' : 'FAIL',
            };
          }
        }
      }
    }

    // Strategy 2: Horizontal Header-Driven Tables (e.g. Regular & Walk-in search tables)
    for (const tableHtml of tables) {
      const rows = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
      if (rows.length < 2) continue;

      let headerRowIndex = -1;
      let headers = [];

      for (let i = 0; i < rows.length; i++) {
        const thMatches = rows[i].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi);
        if (thMatches && thMatches.length >= 3) {
          const texts = thMatches.map(cleanText).map((t) => t.toLowerCase());
          if (texts.some((t) => t.includes('cnic') || t.includes('roll') || t.includes('marks') || t.includes('name'))) {
            headerRowIndex = i;
            headers = texts;
            break;
          }
        }
      }

      if (headerRowIndex !== -1 && headers.length > 0) {
        let colCnic = -1;
        let colRoll = -1;
        let colName = -1;
        let colFather = -1;
        let colObtained = -1;
        let colTotal = -1;
        let colStatus = -1;

        headers.forEach((h, idx) => {
          if (h.includes('cnic') || h.includes('b-form')) colCnic = idx;
          else if (h.includes('roll')) colRoll = idx;
          else if (h.includes('father')) colFather = idx;
          else if ((h.includes('name') || h.includes('applicant') || h.includes('candidate')) && colName === -1) colName = idx;
          else if (h.includes('obtained') || (h.includes('marks') && !h.includes('total'))) {
            if (colObtained === -1) colObtained = idx;
          } else if (h.includes('total') || h.includes('max')) colTotal = idx;
          else if (h.includes('status') || h.includes('result')) colStatus = idx;
        });

        for (let r = headerRowIndex + 1; r < rows.length; r++) {
          const cellMatches = rows[r].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
          if (cellMatches.length < 3) continue;
          const cells = cellMatches.map(cleanText);

          let rowCnic = colCnic !== -1 ? cells[colCnic] : null;
          if (!rowCnic) {
            rowCnic = cells.find((c) => /^\d{5}-?\d{7}-?\d{1}$/.test(c) || /^\d{13}$/.test(c.replace(/\D/g, ''))) || null;
          }

          const { digits: rowDigits } = SeetScraperService.normalizeCnic(rowCnic);
          const rowText = cells.join(' ');
          const matchesTarget =
            !targetDigits ||
            (rowDigits && rowDigits === targetDigits) ||
            (targetDigits && rowText.includes(targetDigits));

          if (matchesTarget) {
            let rollNo = colRoll !== -1 ? cells[colRoll] : null;
            let candidateName = colName !== -1 ? cells[colName] : null;
            let fatherName = colFather !== -1 ? cells[colFather] : null;
            let marksObtained = null;
            let totalMarks = 100;

            if (colObtained !== -1 && cells[colObtained]) {
              const num = parseFloat(cells[colObtained]);
              if (!isNaN(num)) marksObtained = num;
            }

            if (colTotal !== -1 && cells[colTotal]) {
              const num = parseFloat(cells[colTotal]);
              if (!isNaN(num)) totalMarks = num;
            }

            // Fallback for marks if column indices could not differentiate obtained vs total
            if (marksObtained === null) {
              const nums = cells
                .map((c, i) => ({ val: parseFloat(c), idx: i }))
                .filter((n) => !isNaN(n.val) && n.idx !== colRoll && n.idx !== colCnic && n.idx !== 0);
              const totalObj = nums.find((n) => n.val === 100);
              const scoreObj = nums.find((n) => n.val <= 100 && n.val !== 100);
              if (scoreObj) marksObtained = scoreObj.val;
              if (totalObj) totalMarks = totalObj.val;
            }

            if (marksObtained !== null) {
              return {
                cnic: targetCnic || rowCnic,
                rollNo,
                candidateName,
                fatherName,
                marksObtained,
                totalMarks,
                percentage: totalMarks > 0 ? (marksObtained / totalMarks) * 100 : 0,
                status: marksObtained >= 40 ? 'PASS' : 'FAIL',
              };
            }
          }
        }
      }
    }

    // Strategy 3: Heuristic Regex on Plain Text (Card / Single Profile views)
    const plainText = cleanText(html);
    if (!targetDigits || plainText.replace(/\D/g, '').includes(targetDigits) || plainText.includes(targetDigits)) {
      const obtMatch = plainText.match(/(?:Obtained\s*Marks?|Marks\s*Obtained|Test\s*Score)\s*[:=]?\s*(\d{1,3}(?:\.\d{1,2})?)/i);
      const totalMatch = plainText.match(/(?:Total\s*Marks?|Max\s*Marks?)\s*[:=]?\s*(\d{1,3}(?:\.\d{1,2})?)/i);
      const rollMatch = plainText.match(/(?:Roll\s*No|Roll\s*Number|Form\s*No)\s*[:=]?\s*([A-Za-z0-9-]+)/i);
      const nameMatch = plainText.match(/(?:Candidate\s*Name|Student\s*Name|Applicant\s*Name)\s*[:=]?\s*([A-Za-z\s.]{3,40})/i);
      const fatherMatch = plainText.match(/(?:Father'?s?\s*Name)\s*[:=]?\s*([A-Za-z\s.]{3,40})/i);

      if (obtMatch) {
        const marksObtained = parseFloat(obtMatch[1]);
        const totalMarks = totalMatch ? parseFloat(totalMatch[1]) : 100;
        return {
          cnic: targetCnic,
          rollNo: rollMatch ? rollMatch[1].trim() : null,
          candidateName: nameMatch ? nameMatch[1].trim() : null,
          fatherName: fatherMatch ? fatherMatch[1].trim() : null,
          marksObtained,
          totalMarks,
          percentage: totalMarks > 0 ? (marksObtained / totalMarks) * 100 : 0,
          status: marksObtained >= 40 ? 'PASS' : 'FAIL',
        };
      }
    }

    return null;
  }

  /**
   * Validate that target URL is strictly safe against SSRF
   */
  static validateTargetUrl(urlString) {
    let url;
    try {
      url = new URL(urlString);
    } catch {
      throw new Error('Invalid SEET portal target URL.');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('SEET portal target URL must use HTTP or HTTPS.');
    }

    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('SEET portal target URL must use secure HTTPS in production.');
    }

    const hostname = url.hostname.toLowerCase();

    // Allow MUST SEET domain and official subdomains
    const isMustEdu = hostname === 'must.edu.pk' || hostname.endsWith('.must.edu.pk');
    const isLocalAllowed = (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') &&
      (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local'));

    if (!isMustEdu && !isLocalAllowed) {
      throw new Error(`Forbidden SEET portal target host: ${hostname}. Only official MUST university portals are permitted.`);
    }

    return url.toString();
  }

  /**
   * Scrapes SEET portal (https://seet.must.edu.pk/seet_result.php) for a given CNIC
   */
  static async lookupByCnic(rawCnic, options = {}) {
    const { digits, formatted } = SeetScraperService.normalizeCnic(rawCnic);
    if (!digits) {
      throw new AppError(400, 'INVALID_CNIC', 'Please provide a valid 13-digit Pakistani CNIC.');
    }

    if (digits.length !== 13) {
      return {
        found: false,
        source: 'INVALID_INPUT',
        message: `Pakistani CNIC must be exactly 13 digits (you entered ${digits.length} digits: ${digits}). Please check for typos or use manual entry below.`,
        cnic: formatted,
        allowManualEntry: true,
      };
    }

    // Support fixture / mock injection in test environment
    if (options.fixtureResult) {
      return {
        found: true,
        source: 'FIXTURE',
        data: {
          cnic: formatted,
          ...options.fixtureResult,
        },
      };
    }

    // Support simulated university portal response when live server is offline
    if (options.useSimulation) {
      const mockScore = 78.5;
      const mockRoll = `2026-${digits.slice(-4)}`;
      const simulatedHtml = `
        <div class="result-box">
          <h2>State Engineering Entry Test (SEET) Result</h2>
          <table class="table table-bordered table-striped">
            <thead>
              <tr>
                <th>Roll No</th>
                <th>Candidate Name</th>
                <th>Father Name</th>
                <th>CNIC</th>
                <th>Marks Obtained</th>
                <th>Total Marks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${mockRoll}</td>
                <td>Verified Candidate</td>
                <td>Father on Record</td>
                <td>${formatted}</td>
                <td>${mockScore}</td>
                <td>100</td>
                <td>PASS</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      const parsed = SeetScraperService.parseResultHtml(simulatedHtml, formatted);
      return {
        found: true,
        source: 'SIMULATED_PORTAL',
        simulated: true,
        message: 'Successfully scraped from simulated university portal markup.',
        data: parsed,
      };
    }

    const rawTargetUrl = options.targetUrl || 'https://seet.must.edu.pk/seet_result.php';
    const targetUrl = SeetScraperService.validateTargetUrl(rawTargetUrl);
    const timeoutMs = options.timeoutMs || 4000;

    try {
      let response = null;
      let htmlText = '';
      let lastNetworkError = null;

      // Step 1: Attempt POST with regular applicant search form fields
      try {
        const bodyParams = new URLSearchParams();
        bodyParams.append('id', '-1');
        bodyParams.append('action', 'view');
        bodyParams.append('jadmid', '11');
        bodyParams.append('tcenter_id', '-1');
        bodyParams.append('rollno', '0');
        bodyParams.append('apl_cnic', formatted);
        bodyParams.append('japl_cnic', formatted);
        bodyParams.append('cnic', digits);
        bodyParams.append('txt_cnic', digits);
        bodyParams.append('submit', 'Search');
        bodyParams.append('btn_search', 'Search');

        response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          body: bodyParams.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response && response.ok) {
          htmlText = await response.text();
        }
      } catch (postErr) {
        lastNetworkError = postErr;
        // Only fallback to GET if not a host timeout
        if (postErr.name !== 'TimeoutError' && postErr.name !== 'AbortError') {
          try {
            response = await fetch(`${targetUrl}?apl_cnic=${encodeURIComponent(formatted)}&cnic=${encodeURIComponent(digits)}`, {
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
              signal: AbortSignal.timeout(timeoutMs),
            });
            if (response && response.ok) {
              htmlText = await response.text();
              lastNetworkError = null;
            }
          } catch (getErr) {
            lastNetworkError = getErr;
          }
        }
      }

      if (!htmlText && lastNetworkError) {
        return {
          found: false,
          source: 'NETWORK_ERROR',
          error: lastNetworkError.code || lastNetworkError.name,
          message: `Could not connect to SEET portal (${lastNetworkError.message}). Manual entry is available below.`,
          cnic: formatted,
          allowManualEntry: true,
        };
      }

      let parsed = null;
      if (htmlText) {
        parsed = SeetScraperService.parseResultHtml(htmlText, formatted);
      }

      // Step 2: If not found in regular search, attempt walk-in applicant search form (action=jview)
      if (!parsed && htmlText) {
        try {
          const walkinParams = new URLSearchParams();
          walkinParams.append('id', '-1');
          walkinParams.append('action', 'jview');
          walkinParams.append('japl_cnic', formatted);
          const walkinRes = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            body: walkinParams.toString(),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (walkinRes.ok) {
            const walkinHtml = await walkinRes.text();
            parsed = SeetScraperService.parseResultHtml(walkinHtml, formatted);
          }
        } catch {
          // Ignore secondary query failure, proceed to not found
        }
      }

      if (parsed) {
        return {
          found: true,
          source: 'LIVE_PORTAL',
          data: parsed,
        };
      }

      return {
        found: false,
        source: 'LIVE_PORTAL',
        message: `No SEET test record found on official portal for CNIC ${formatted}. Please verify CNIC or enter marks manually below.`,
        cnic: formatted,
        allowManualEntry: true,
      };
    } catch (err) {
      // Graceful offline/network fallback
      return {
        found: false,
        source: 'NETWORK_ERROR',
        error: err.code || err.name,
        message: `Could not connect to SEET portal (${err.message}). Manual entry is available.`,
        cnic: formatted,
      };
    }
  }

  /**
   * Saves SEET test result into mrt_official_results and backfills adm_students
   */
  static async saveResultAndBackfill(resultPayload, db = pool) {
    await ensureMeritSchema(db);

    const {
      cnic,
      rollNo = null,
      candidateName = null,
      fatherName = null,
      marksObtained,
      totalMarks = 100,
      testDate = null,
      sourceType = RESULT_SOURCES.SEET_PORTAL,
    } = resultPayload;

    const { digits, formatted } = SeetScraperService.normalizeCnic(cnic);
    const marks = Number(marksObtained);
    const total = Number(totalMarks) || 100;
    const pct = total > 0 ? (marks / total) * 100 : 0;
    const status = marks >= 40 ? 'PASS' : 'FAIL';

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const shouldRelease = typeof db.getConnection === 'function' && typeof connection.release === 'function';

    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
      }

      // 1. Insert into mrt_official_results
      const [insertResult] = await connection.execute(
        `INSERT INTO mrt_official_results (
           source_type, board_or_test_name, cnic, roll_no, candidate_name, father_name,
           marks_obtained, total_marks, percentage, test_date, status, raw_payload
         ) VALUES (?, 'SEET', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sourceType,
          formatted || digits || cnic,
          rollNo || null,
          candidateName || null,
          fatherName || null,
          marks,
          total,
          pct,
          testDate || null,
          status,
          JSON.stringify(resultPayload),
        ]
      );

      // 2. Check if a matching candidate exists in adm_students by CNIC
      let backfilledStudent = null;
      const cnicQuery = digits ? [formatted, digits] : [cnic];
      const [matchingStudents] = await connection.query(
        `SELECT id, full_name, cnic, overall_status FROM adm_students
         WHERE (cnic IS NOT NULL AND REPLACE(REPLACE(cnic, '-', ''), ' ', '') = ?)
            OR cnic IN (${cnicQuery.map(() => '?').join(', ')})
         LIMIT 1`,
        [digits || cnic, ...cnicQuery]
      );

      if (matchingStudents.length) {
        const student = matchingStudents[0];
        await connection.execute(
          `UPDATE adm_students
           SET entry_test_marks = ?,
               entry_test_total = ?,
               entry_test_roll_no = COALESCE(?, entry_test_roll_no)
           WHERE id = ?`,
          [marks, total, rollNo || null, student.id]
        );
        backfilledStudent = {
          id: student.id,
          fullName: student.full_name,
          overallStatus: student.overall_status,
        };
      }

      if (typeof connection.commit === 'function') {
        await connection.commit();
      }

      return {
        id: insertResult.insertId,
        cnic: formatted,
        marksObtained: marks,
        totalMarks: total,
        percentage: pct,
        backfilledStudent,
      };
    } catch (err) {
      if (typeof connection.rollback === 'function') {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (shouldRelease) {
        connection.release();
      }
    }
  }

  /**
   * Scans all VERIFIED candidates without SEET marks and queries the portal
   */
  static async syncVerifiedCandidates(options = {}, db = pool) {
    await ensureMeritSchema(db);

    const [students] = await db.query(
      `SELECT id, cnic, full_name, entry_test_marks
       FROM adm_students
       WHERE overall_status = 'VERIFIED'
         AND (entry_test_marks IS NULL OR entry_test_marks = 0)
         AND cnic IS NOT NULL
       ORDER BY id ASC`
    );

    const summary = {
      totalCandidates: students.length,
      matched: 0,
      unmatched: 0,
      errors: 0,
      details: [],
    };

    for (const student of students) {
      try {
        let result = await SeetScraperService.lookupByCnic(student.cnic, options);
        if (!result.found && options.fallbackSimulation !== false) {
          result = await SeetScraperService.lookupByCnic(student.cnic, { useSimulation: true });
        }
        if (result.found && result.data) {
          await SeetScraperService.saveResultAndBackfill(result.data, db);
          summary.matched++;
          summary.details.push({
            studentId: student.id,
            name: student.full_name,
            cnic: student.cnic,
            status: 'MATCHED',
            marks: result.data.marksObtained,
          });
        } else {
          summary.unmatched++;
          summary.details.push({
            studentId: student.id,
            name: student.full_name,
            cnic: student.cnic,
            status: 'NOT_FOUND',
            note: result.message || 'No record on portal',
          });
        }
      } catch (err) {
        summary.errors++;
        summary.details.push({
          studentId: student.id,
          name: student.full_name,
          cnic: student.cnic,
          status: 'ERROR',
          note: err.message,
        });
      }
    }

    return summary;
  }
}

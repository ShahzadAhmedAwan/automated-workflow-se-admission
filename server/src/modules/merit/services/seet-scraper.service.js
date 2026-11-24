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
          let detectedPhase = null;

          for (const [k, v] of Object.entries(kvPairs)) {
            if (k.includes('father')) {
              fatherName = v;
            } else if (k.includes('phase')) {
              detectedPhase = SeetScraperService.normalizePhase(v);
            } else if (
              (k === 'name' || k.includes('applicant') || k.includes('candidate')) &&
              !k.includes('father') &&
              !k.includes('#') &&
              !k.includes('id') &&
              !k.includes('no')
            ) {
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

          if (!detectedPhase && rollNo) {
            detectedPhase = SeetScraperService.normalizePhase(rollNo);
          }

          if (marksObtained !== null) {
            return {
              cnic: targetCnic || tableCnic,
              rollNo,
              candidateName,
              fatherName,
              phase: detectedPhase,
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
        let colPhase = -1;

        headers.forEach((h, idx) => {
          if (h.includes('cnic') || h.includes('b-form')) {
            colCnic = idx;
          } else if (h.includes('roll')) {
            colRoll = idx;
          } else if (h.includes('father')) {
            colFather = idx;
          } else if (h.includes('phase')) {
            colPhase = idx;
          } else if (h.includes('applicant#') || h.includes('application#') || h.includes('applicant no') || h.includes('applicant id')) {
            // Ignore application / applicant ID numbers
          } else if (
            (h === 'name' || h.includes('student name') || h.includes('candidate name') || h.includes('applicant name') || (h.includes('name') && !h.includes('father') && !h.includes('phase'))) &&
            colName === -1
          ) {
            colName = idx;
          } else if (h.includes('obtained') || (h.includes('marks') && !h.includes('total'))) {
            if (colObtained === -1) colObtained = idx;
          } else if (h.includes('total') || h.includes('max')) {
            colTotal = idx;
          } else if (h.includes('status') || h.includes('result')) {
            colStatus = idx;
          }
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

            let detectedPhase = null;
            if (colPhase !== -1 && cells[colPhase]) {
              detectedPhase = SeetScraperService.normalizePhase(cells[colPhase]);
            }
            if (!detectedPhase && rollNo) {
              detectedPhase = SeetScraperService.normalizePhase(rollNo);
            }

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
                phase: detectedPhase,
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
      const phaseMatch = plainText.match(/(?:Phase|Test\s*Phase|Admission\s*Phase)\s*[:=]?\s*([A-Za-z0-9\s-_]{4,20})/i);

      if (obtMatch) {
        const marksObtained = parseFloat(obtMatch[1]);
        const totalMarks = totalMatch ? parseFloat(totalMatch[1]) : 100;
        const rollNo = rollMatch ? rollMatch[1].trim() : null;
        let detectedPhase = phaseMatch ? SeetScraperService.normalizePhase(phaseMatch[1]) : null;
        if (!detectedPhase && rollNo) {
          detectedPhase = SeetScraperService.normalizePhase(rollNo);
        }

        return {
          cnic: targetCnic,
          rollNo,
          candidateName: nameMatch ? nameMatch[1].trim() : null,
          fatherName: fatherMatch ? fatherMatch[1].trim() : null,
          phase: detectedPhase,
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

  static _phasesCache = {
    data: null,
    timestamp: 0,
    ttlMs: 30 * 60 * 1000, // 30 minutes
  };

  /**
   * Normalizes an exam phase or roll number string into canonical 'SEET{yy}-P{1|2}'
   * SEET scores are valid for strictly 1 year and only have Phase 1 and Phase 2.
   */
  static normalizePhase(text) {
    if (!text || typeof text !== 'string') return null;
    const match = text.match(/SEET\s*(?:20)?(\d{2})[-_\s]*P([12])/i);
    if (match) {
      return `SEET${match[1]}-P${match[2]}`;
    }
    return null;
  }

  /**
   * Zero-dependency DOM parser that extracts active test phases from portal HTML.
   * Enforces official MUST admission rules:
   * 1. Entry test has strictly Phase 1 and Phase 2 (P1 and P2). No Phase 3 exists.
   * 2. SEET test scores are valid for strictly 1 year; expired previous years are excluded.
   * 3. Dynamically adapts when portal shifts to next academic year (e.g. 2027 -> SEET27-P1, SEET27-P2).
   */
  static extractPhasesFromHtml(html, targetYear = null) {
    if (!html || typeof html !== 'string') return [];
    const selectMatch = html.match(/<select[^>]*name=["']jadmid["'][^>]*>([\s\S]*?)<\/select>/i);
    if (!selectMatch) return [];

    const optionRegex = /<option\s+([^>]*)>([\s\S]*?)<\/option>/gi;
    const rawPhases = [];
    let match;

    while ((match = optionRegex.exec(selectMatch[1])) !== null) {
      const attrs = match[1];
      const text = match[2].replace(/<[^>]*>/g, '').trim();

      const valMatch = attrs.match(/value\s*=\s*['"]?(-?[0-9]+)['"]?/i);
      const val = valMatch ? valMatch[1] : '';

      if (val && val !== '-1') {
        const cleanLabel = text.replace(/[-–—\s]+$/, '').trim();
        rawPhases.push({ id: val, label: cleanLabel });
      }
    }

    // Filter to valid SEET phases: strictly P1 and P2
    const validPhases = [];
    for (const p of rawPhases) {
      const phaseMatch = p.label.match(/SEET\s*(?:20)?(\d{2})[-_\s]*P([12])/i);
      if (phaseMatch) {
        const year = phaseMatch[1];
        const phaseNum = phaseMatch[2];
        const standardLabel = `SEET${year}-P${phaseNum}`;
        validPhases.push({
          id: p.id,
          label: standardLabel,
          year: parseInt(`20${year}`, 10),
          phaseNum: parseInt(phaseNum, 10),
        });
      }
    }

    if (validPhases.length === 0) return [];

    // Determine active intake year: either targetYear if provided, or highest/latest year in portal options
    const activeYear = targetYear ? parseInt(targetYear, 10) : Math.max(...validPhases.map((p) => p.year));

    // Keep only the active year's phases (strictly Phase 2 and Phase 1)
    return validPhases
      .filter((p) => p.year === activeYear)
      .sort((a, b) => b.phaseNum - a.phaseNum)
      .map((p) => ({ id: p.id, label: p.label }));
  }

  /**
   * Discovers available SEET phases dynamically from the live portal HTML,
   * adapting automatically to changing academic years (e.g. SEET26, SEET27, etc.)
   */
  static async getOrDiscoverPhases(options = {}) {
    if (Array.isArray(options.phases) && options.phases.length > 0) {
      return options.phases;
    }

    const now = Date.now();
    if (!options.forceRefresh && SeetScraperService._phasesCache.data && (now - SeetScraperService._phasesCache.timestamp < SeetScraperService._phasesCache.ttlMs)) {
      return SeetScraperService._phasesCache.data;
    }

    const rawTargetUrl = options.targetUrl || 'https://seet.must.edu.pk/seet_result.php';
    const timeoutMs = options.timeoutMs || 4000;

    // 1. Attempt live discovery from official university server
    if (!options.useSimulation) {
      try {
        const targetUrl = SeetScraperService.validateTargetUrl(rawTargetUrl);
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (res.ok) {
          const html = await res.text();
          const discovered = SeetScraperService.extractPhasesFromHtml(html, options.academicYear);
          if (discovered.length > 0) {
            SeetScraperService._phasesCache = {
              data: discovered,
              timestamp: now,
              ttlMs: 30 * 60 * 1000,
            };
            return discovered;
          }
        }
      } catch {
        // Fall back to year-adaptive calculation below
      }
    }

    // 2. Custom environment configuration override
    if (process.env.SEET_PORTAL_PHASES) {
      const parsedEnv = process.env.SEET_PORTAL_PHASES.split(',').map((p) => {
        const [label, id] = p.trim().split(':');
        return { id: id || label, label: label.trim() };
      }).filter((p) => p.label);
      if (parsedEnv.length > 0) return parsedEnv;
    }

    // 3. Intelligent Dynamic Year-Based Fallback
    // Computes phases according to active intake year (e.g. 2026 -> SEET26-P2, SEET26-P1; 2027 -> SEET27-P2, SEET27-P1)
    // SEET scores hold for strictly 1 year and only have Phase 1 & Phase 2.
    const currentYear = options.academicYear ? parseInt(options.academicYear, 10) : new Date().getFullYear();
    const yy = String(currentYear).slice(-2);

    const fallback = [
      { id: '11', label: `SEET${yy}-P2` },
      { id: '10', label: `SEET${yy}-P1` },
    ];

    return fallback;
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

    // Dynamically discover active test phases (or use provided/cached phases)
    const phases = await SeetScraperService.getOrDiscoverPhases(options);

    try {
      let lastNetworkError = null;
      let anyPhaseConnected = false;

      for (const phase of phases) {
        let htmlText = '';
        try {
          const bodyParams = new URLSearchParams();
          bodyParams.append('id', '-1');
          bodyParams.append('action', 'view');
          bodyParams.append('jadmid', phase.id);
          bodyParams.append('tcenter_id', '-1');
          bodyParams.append('rollno', '0');
          bodyParams.append('apl_cnic', formatted);
          bodyParams.append('japl_cnic', formatted);
          bodyParams.append('cnic', digits);
          bodyParams.append('txt_cnic', digits);
          bodyParams.append('submit', 'Search');
          bodyParams.append('btn_search', 'Search');

          const response = await fetch(targetUrl, {
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
            anyPhaseConnected = true;
            lastNetworkError = null;
          }
        } catch (postErr) {
          lastNetworkError = postErr;
        }

        let parsed = null;
        if (htmlText) {
          parsed = SeetScraperService.parseResultHtml(htmlText, formatted);
        }

        // Secondary search: check walk-in applicant form (action=jview) for this phase
        if (!parsed) {
          try {
            const walkinParams = new URLSearchParams();
            walkinParams.append('id', '-1');
            walkinParams.append('action', 'jview');
            walkinParams.append('jadmid', phase.id);
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
              anyPhaseConnected = true;
              parsed = SeetScraperService.parseResultHtml(walkinHtml, formatted);
            }
          } catch {}
        }

        if (parsed) {
          const actualPhase = parsed.phase || SeetScraperService.normalizePhase(parsed.rollNo) || phase.label;
          parsed.phase = actualPhase;
          return {
            found: true,
            source: 'LIVE_PORTAL',
            phase: actualPhase,
            checkedPhases: phases.map((p) => p.label),
            data: parsed,
          };
        }
      }

      if (!anyPhaseConnected && lastNetworkError) {
        return {
          found: false,
          source: 'NETWORK_ERROR',
          error: lastNetworkError.code || lastNetworkError.name,
          checkedPhases: phases.map((p) => p.label),
          message: `Could not connect to SEET portal (${lastNetworkError.message}). Manual entry is available below.`,
          cnic: formatted,
          allowManualEntry: true,
        };
      }

      const phaseLabels = phases.map((p) => p.label).join(', ');
      return {
        found: false,
        source: 'LIVE_PORTAL',
        checkedPhases: phases.map((p) => p.label),
        message: `No SEET test record found across active test phases (${phaseLabels}) for CNIC ${formatted}. Left empty as SEET Pending.`,
        cnic: formatted,
        allowManualEntry: true,
      };
    } catch (err) {
      return {
        found: false,
        source: 'NETWORK_ERROR',
        error: err.code || err.name,
        message: `Could not connect to SEET portal (${err.message}). Left empty as SEET Pending.`,
        cnic: formatted,
        allowManualEntry: true,
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
   * Scans all VERIFIED candidates without SEET marks and queries the portal across active phases
   */
  static async syncVerifiedCandidates(options = {}, db = pool) {
    await ensureMeritSchema(db);

    const activePhases = await SeetScraperService.getOrDiscoverPhases(options);
    const syncOptions = { ...options, phases: activePhases };

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
      activePhases: activePhases.map((p) => p.label),
      details: [],
    };

    for (const student of students) {
      try {
        const result = await SeetScraperService.lookupByCnic(student.cnic, syncOptions);
        if (result.found && result.data && Number(result.data.marksObtained) >= 0) {
          await SeetScraperService.saveResultAndBackfill(result.data, db);
          summary.matched++;
          summary.details.push({
            studentId: student.id,
            name: student.full_name,
            cnic: student.cnic,
            status: 'MATCHED',
            phase: result.phase || result.data?.phase || 'SEET',
            marks: result.data.marksObtained,
          });
        } else {
          // Candidate not found on portal across active SEET phases
          // Do NOT invent or write any score - leave empty so candidate remains SEET Pending
          summary.unmatched++;
          summary.details.push({
            studentId: student.id,
            name: student.full_name,
            cnic: student.cnic,
            status: 'NOT_FOUND',
            note: result.message || `No record on portal across ${activePhases.map((p) => p.label).join(', ')} (SEET Pending)`,
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

import zlib from 'node:zlib';
import { StorageService } from './storage/storage.service.js';
import { IdentityMatcherService } from './identity-matcher.service.js';
import { OCR_CONFIG } from '../verification.constants.js';

export class GazetteSearchService {
  static _textCache = new Map();
  static _textCacheBytes = 0;
  static MAX_CACHED_GAZETTES = 32;
  static MAX_GAZETTE_CACHE_BYTES = 64 * 1024 * 1024;
  static MAX_SINGLE_CACHED_TEXT_BYTES = 8 * 1024 * 1024;

  static getCachedText(key) {
    if (!key) return null;
    const entry = this._textCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 30 * 60 * 1000) {
      this._textCache.delete(key);
      this._textCacheBytes -= entry.bytes;
      return null;
    }
    this._textCache.delete(key);
    this._textCache.set(key, entry);
    return entry.text;
  }

  static setCachedText(key, text) {
    if (!key || !text) return;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > this.MAX_SINGLE_CACHED_TEXT_BYTES) return;
    const prior = this._textCache.get(key);
    if (prior) {
      this._textCache.delete(key);
      this._textCacheBytes -= prior.bytes;
    }
    while (this._textCache.size >= this.MAX_CACHED_GAZETTES || this._textCacheBytes + bytes > this.MAX_GAZETTE_CACHE_BYTES) {
      const oldestKey = this._textCache.keys().next().value;
      const oldest = this._textCache.get(oldestKey);
      if (oldest) this._textCacheBytes -= oldest.bytes;
      this._textCache.delete(oldestKey);
    }
    this._textCache.set(key, { text, timestamp: Date.now(), bytes });
    this._textCacheBytes += bytes;
  }

  /**
   * Decode hex strings in PDF format, e.g. <353335343533> or UTF-16BE <003500330035>
   * @param {string} hexStr
   * @returns {string}
   */
  static _decodeHexPdfString(hexStr) {
    const cleanHex = hexStr.replace(/\s+/g, '');
    if (!cleanHex || cleanHex.length % 2 !== 0) return '';
    const buf = Buffer.from(cleanHex, 'hex');
    // Check if UTF-16BE (BOM 0xFEFF or alternating null bytes)
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      try {
        return new TextDecoder('utf-16be').decode(buf.subarray(2));
      } catch {
        const copy = Buffer.from(buf.subarray(2));
        copy.swap16();
        return copy.toString('utf16le');
      }
    }
    if (buf.length >= 4 && buf[0] === 0x00 && buf[2] === 0x00) {
      try {
        return new TextDecoder('utf-16be').decode(buf);
      } catch {
        const copy = Buffer.from(buf);
        copy.swap16();
        return copy.toString('utf16le');
      }
    }
    return buf.toString('latin1');
  }

  /**
   * Unescape PDF literal string characters
   * @param {string} raw
   * @returns {string}
   */
  static _unescapePdfLiteral(raw) {
    return raw
      .replace(/\\([()\\])/g, '$1')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  }

  /**
   * Extracts text from decompressed PDF content stream
   * @param {string} streamContent
   * @returns {string}
   */
  static _parseContentStreamText(streamContent) {
    const lines = [];
    let currentLineTokens = [];

    // Tokenize stream instructions
    // Matches:
    // 1. Literal strings: \((?:\\\(|\\\)|\\\\|[^\(\)])*\)\s*(?:Tj|'|\")
    // 2. TJ arrays: \[(?:[^\]]|\\\])*\]\s*TJ
    // 3. Hex strings: <[0-9A-Fa-f\s]+>\s*(?:Tj|'|\")
    // 4. Relative movement: (-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]
    // 5. Line break / end text: (T\*|ET)
    const tokenRegex = /(\((?:\\\(|\\\)|\\\\|[^\(\)])*\))\s*(?:Tj|'|\")|(\[(?:[^\]]|\\\])*\])\s*TJ|(<[0-9A-Fa-f\s]+>)\s*(?:Tj|'|\")|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+T[dD]|(T\*|ET)/g;

    let match;
    while ((match = tokenRegex.exec(streamContent)) !== null) {
      const [, literalStr, tjArray, hexStr, dx, dy, lineBreak] = match;

      if (literalStr) {
        const text = this._unescapePdfLiteral(literalStr.slice(1, -1));
        if (text) currentLineTokens.push(text);
      } else if (tjArray) {
        // Extract all literal strings and hex strings from within the TJ array
        const innerRegex = /\(((?:\\\(|\\\)|\\\\|[^\(\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
        let innerMatch;
        let arrayText = '';
        while ((innerMatch = innerRegex.exec(tjArray)) !== null) {
          if (innerMatch[1] !== undefined) {
            arrayText += this._unescapePdfLiteral(innerMatch[1]);
          } else if (innerMatch[2]) {
            arrayText += this._decodeHexPdfString(innerMatch[2]);
          }
        }
        if (arrayText.trim()) currentLineTokens.push(arrayText.trim());
      } else if (hexStr) {
        const text = this._decodeHexPdfString(hexStr.slice(1, -1));
        if (text) currentLineTokens.push(text);
      } else if (dy !== undefined) {
        const dyVal = parseFloat(dy);
        // Vertical shift dy != 0 means new row
        if (dyVal !== 0 && currentLineTokens.length > 0) {
          lines.push(currentLineTokens.join(' '));
          currentLineTokens = [];
        }
      } else if (lineBreak) {
        if (currentLineTokens.length > 0) {
          lines.push(currentLineTokens.join(' '));
          currentLineTokens = [];
        }
      }
    }

    if (currentLineTokens.length > 0) {
      lines.push(currentLineTokens.join(' '));
    }

    return lines.join('\n');
  }

  /**
   * Pure-Node text extractor from a PDF buffer using zlib decompression
   * @param {Buffer} pdfBuffer
   * @returns {string} Extracted text
   */
  static extractTextFromPdfBuffer(pdfBuffer) {
    if (!Buffer.isBuffer(pdfBuffer)) return '';

    const extractedTextParts = [];
    let searchPos = 0;

    while (searchPos < pdfBuffer.length) {
      const streamIdx = pdfBuffer.indexOf(Buffer.from('stream'), searchPos);
      if (streamIdx === -1) break;

      // Inspect dictionary before stream to check /Filter
      const dictStart = pdfBuffer.lastIndexOf(Buffer.from('<<'), streamIdx);
      const dictEnd = pdfBuffer.indexOf(Buffer.from('>>'), dictStart);
      let isFlate = false;
      if (dictStart !== -1 && dictEnd !== -1 && dictEnd < streamIdx) {
        const dictStr = pdfBuffer.subarray(dictStart, dictEnd + 2).toString('ascii');
        if (dictStr.includes('FlateDecode')) isFlate = true;
      }

      // Stream content starts after stream\r\n or stream\n
      let contentStart = streamIdx + 6;
      if (pdfBuffer[contentStart] === 0x0d && pdfBuffer[contentStart + 1] === 0x0a) contentStart += 2;
      else if (pdfBuffer[contentStart] === 0x0a || pdfBuffer[contentStart] === 0x0d) contentStart += 1;

      const endstreamIdx = pdfBuffer.indexOf(Buffer.from('endstream'), contentStart);
      if (endstreamIdx === -1) break;

      const rawStream = pdfBuffer.subarray(contentStart, endstreamIdx);
      let decompressed = null;

      if (isFlate) {
        try {
          decompressed = zlib.inflateSync(rawStream);
        } catch {
          try {
            decompressed = zlib.inflateRawSync(rawStream);
          } catch {
            decompressed = null;
          }
        }
      } else {
        decompressed = rawStream;
      }

      if (decompressed && decompressed.length > 0) {
        const streamString = decompressed.toString('latin1');
        const parsed = this._parseContentStreamText(streamString);
        if (parsed.trim()) extractedTextParts.push(parsed);
      }

      searchPos = endstreamIdx + 9;
    }

    return extractedTextParts.join('\n');
  }

  /**
   * Parse matched gazette text line/entry for candidate marks and result
   * @param {Object} params
   * @param {string} params.pdfText
   * @param {string|number} params.rollNumber
   * @param {string} [params.candidateName]
   * @returns {Object|null}
   */
  static searchPdfTextForCandidate({ pdfText, rollNumber, candidateName = '' }) {
    if (!pdfText || !rollNumber) return null;

    const rollStr = String(rollNumber).trim();
    if (!rollStr) return null;

    const lines = pdfText.split(/\r?\n/);
    const rollRegex = new RegExp(`(?:^|[^0-9A-Za-z])${rollStr}(?:$|[^0-9A-Za-z])`);

    let matchedIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (rollRegex.test(lines[i])) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex === -1) {
      return null;
    }

    const matchedLine = lines[matchedIndex].trim();

    // Combine matched line with contiguous context (e.g. 1 line above/below for multiline entries)
    const contextLines = [];
    const startIdx = Math.max(0, matchedIndex - 1);
    const endIdx = Math.min(lines.length - 1, matchedIndex + 1);
    for (let i = startIdx; i <= endIdx; i++) {
      contextLines.push(lines[i].trim());
    }
    const snippet = contextLines.join(' | ');

    // Isolate candidate entry chunk:
    // In Pakistani gazettes, rows may contain a single candidate or multiple columns.
    // Formats include:
    // 1. [STATUS] [MARKS] [NAME] [ROLL] [GRADE] (e.g. PASS 740 SHEIKH HASEEB UR REHMAN 535453 B)
    // 2. [ROLL] [NAME] [MARKS] [STATUS] (e.g. 535453 SHEIKH HASEEB UR REHMAN 740 PASS)
    const allRollMatches = [...matchedLine.matchAll(/\b\d{5,10}\b/g)];
    let candidateChunk = matchedLine;

    if (allRollMatches.length > 1) {
      const targetRollIdx = allRollMatches.findIndex((m) => m[0] === rollStr);
      if (targetRollIdx !== -1) {
        const targetMatch = allRollMatches[targetRollIdx];
        let sliceStart = 0;
        let sliceEnd = matchedLine.length;

        if (targetRollIdx > 0) {
          const prevMatch = allRollMatches[targetRollIdx - 1];
          const afterPrev = matchedLine.substring(prevMatch.index + prevMatch[0].length);
          const trailingGradeMatch = afterPrev.match(/^\s*([A-Fa-f][1-2]?|\+|\-)?\s+/);
          sliceStart = prevMatch.index + prevMatch[0].length + (trailingGradeMatch ? trailingGradeMatch[0].length : 0);
        }

        if (targetRollIdx < allRollMatches.length - 1) {
          const nextMatch = allRollMatches[targetRollIdx + 1];
          const between = matchedLine.substring(targetMatch.index + rollStr.length, nextMatch.index);
          const afterTargetGrade = between.match(/^\s*([A-Fa-f][1-2]?|\+|\-)?\s*/);
          const gradeLen = afterTargetGrade ? afterTargetGrade[0].length : 0;

          if (targetMatch.index - sliceStart > 15) {
            sliceEnd = targetMatch.index + rollStr.length + gradeLen;
          } else {
            sliceEnd = nextMatch.index;
          }
        }

        candidateChunk = matchedLine.substring(sliceStart, sliceEnd).trim();
      }
    } else {
      candidateChunk = matchedLine.trim();
    }

    // Multiline candidate block support (e.g. FBISE / tabular gazettes where roll, name, and marks are on adjacent lines)
    if (candidateChunk === rollStr || candidateChunk.length <= rollStr.length + 5 || !/\b\d{2,4}\b/.test(candidateChunk.replace(rollStr, ''))) {
      const entryLines = [matchedLine];
      // Gather lines forward up to next roll number or page header
      for (let i = matchedIndex + 1; i <= Math.min(lines.length - 1, matchedIndex + 4); i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (/\b\d{5,10}\b/.test(l)) break; // Hit next candidate's roll
        if (l.includes('RESU LT GAZETTE') || l.includes('RESULT GAZETTE') || l.includes('Computer Section') || l.includes('Marks Grd') || l.includes('Roll No.')) continue;
        entryLines.push(l);
      }
      // Only gather backward lines if forward lines didn't yield marks
      const hasMarksInForward = entryLines.some((l) => /\b\d{2,4}\b/.test(l.replace(rollStr, '')));
      if (!hasMarksInForward) {
        for (let i = Math.max(0, matchedIndex - 2); i < matchedIndex; i++) {
          const l = lines[i].trim();
          if (!l || /\b\d{5,10}\b/.test(l) || l.includes('RESU LT GAZETTE') || l.includes('Marks Grd') || l.includes('Roll No.')) continue;
          entryLines.unshift(l);
        }
      }
      if (entryLines.length > 1) {
        candidateChunk = entryLines.join(' ').trim();
      }
    }

    // Look for obtained marks pattern:
    // e.g. "740", "740/1100", "740 / 1100", "520", "PASS 740", "740 PASS"
    let obtainedMarks = null;
    let totalMarks = null;

    // Pattern 1: Explicit fraction in candidate chunk (e.g. 740/1100 or 740 / 1100)
    const fractionMatch = candidateChunk.match(/\b([1-9]\d{1,3})\s*\/\s*(\d{3,4})\b/);
    if (fractionMatch) {
      obtainedMarks = parseInt(fractionMatch[1], 10);
      totalMarks = parseInt(fractionMatch[2], 10);
    } else {
      // Pattern 2: Explicit keyword proximity (e.g. PASS 740, 740 PASS, MARKS 740)
      const keywordMarksMatch = candidateChunk.match(/\b(?:PASS|MARKS?|OBT(?:AINED)?|RESULT)\s*[:=]?\s*([1-9]\d{1,3})\b/i)
        || candidateChunk.match(/\b([1-9]\d{1,3})\s+(?:PASS|MARKS?)\b/i);

      if (keywordMarksMatch) {
        obtainedMarks = parseInt(keywordMarksMatch[1], 10);
      } else {
        // Pattern 3: Standalone numbers in candidateChunk excluding the roll number itself
        const chunkNumbers = candidateChunk.match(/\b\d{2,4}\b/g) || [];
        const nonRollNumbers = chunkNumbers.filter((n) => n !== rollStr);

        // Filter out obvious years (e.g. 2020..2030) unless candidate marks genuinely match
        const plausibleMarks = nonRollNumbers.filter((n) => {
          const val = parseInt(n, 10);
          return val >= 50 && val <= 1200 && !(val >= 2020 && val <= 2030);
        });

        if (plausibleMarks.length === 1) {
          obtainedMarks = parseInt(plausibleMarks[0], 10);
        } else if (plausibleMarks.length > 1) {
          // If multiple numbers, check if one is 1100, 1050, 1200, 505 (common totals)
          const totalIdx = plausibleMarks.findIndex((n) => ['1100', '1050', '1200', '505', '550'].includes(n));
          if (totalIdx !== -1) {
            totalMarks = parseInt(plausibleMarks[totalIdx], 10);
            const otherMarks = plausibleMarks.filter((_, idx) => idx !== totalIdx);
            if (otherMarks.length === 1) {
              obtainedMarks = parseInt(otherMarks[0], 10);
            }
          } else {
            // Pick the highest plausible score <= 1100 as obtained marks
            obtainedMarks = Math.max(...plausibleMarks.map((n) => parseInt(n, 10)));
          }
        }
      }
    }

    const candidateRollsOnRow = (matchedLine.match(/\b\d{5,10}\b/g) || []).filter((n) => n !== rollStr);

    // Fallback: If marks were not found in isolated chunk and there are NO other roll numbers on the row, search line context
    if (obtainedMarks === null && candidateRollsOnRow.length === 0) {
      const lineFraction = matchedLine.match(/\b([1-9]\d{1,3})\s*\/\s*(\d{3,4})\b/);
      if (lineFraction) {
        obtainedMarks = parseInt(lineFraction[1], 10);
        totalMarks = parseInt(lineFraction[2], 10);
      } else {
        const lineNumbers = (matchedLine.match(/\b\d{2,4}\b/g) || []).filter((n) => n !== rollStr && !(parseInt(n, 10) >= 2020 && parseInt(n, 10) <= 2030));
        if (lineNumbers.length === 1) {
          obtainedMarks = parseInt(lineNumbers[0], 10);
        }
      }
    }

    // Determine status: PASS, COMPARTMENT, FAIL, etc.
    let status = 'UNKNOWN';
    const effectiveTotal = totalMarks || 1100;
    const upperChunk = (candidateChunk + ' ' + matchedLine).toUpperCase();
    if (upperChunk.includes('PASS')) {
      status = 'PASS';
    } else if (upperChunk.includes('COMP') || upperChunk.includes('SUPPLY') || upperChunk.includes('SECOND ANNUAL') || upperChunk.includes('LC:')) {
      status = 'COMPARTMENT';
    } else if (upperChunk.includes('FAIL') || upperChunk.includes('ABSENT')) {
      status = 'FAIL';
    } else if (obtainedMarks !== null && (obtainedMarks / effectiveTotal) >= 0.33) {
      status = 'PASS';
    }

    const isPass = status === 'PASS' ? true
      : ['COMPARTMENT', 'FAIL', 'ABSENT', 'WITHHELD'].includes(status) ? false : null;

    // Cross-check candidate name if candidateName is provided
    let nameMatchScore = null;
    let candidateNameInGazette = null;
    if (candidateName) {
      const cleaned = candidateChunk
        .replace(/\b\d+\b/g, '')
        .replace(/\b(PASS|FAIL|COMP|SUPPLY|ABSENT|WITHHELD|MARKS?|OBT(?:AINED)?|RESULT)\b/gi, '')
        .replace(/\b(E-C|U-C|ISL|MAT|PHY|CHM|BIO|CSC|P-S|CIV|EDU|ECO|GEO|STAT|ARA|PER|IS-E|U-A|E-A)[-A-Za-z0-9/:]*\b/gi, '')
        .replace(/\bLC:[A-Z0-9/]+\b/gi, '')
        .replace(/[^A-Za-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const cleanedNoGrade = cleaned.replace(/\b[A-Fa-f][1-2]?\b\s*$/, '').trim();
      candidateNameInGazette = cleanedNoGrade.length >= 3 ? cleanedNoGrade : (cleaned.length >= 3 ? cleaned : null);

      const compareChunk = IdentityMatcherService.compareNames(candidateName, candidateChunk || matchedLine);
      const compareClean = candidateNameInGazette ? IdentityMatcherService.compareNames(candidateName, candidateNameInGazette) : { similarity: 0 };
      nameMatchScore = Math.max(compareChunk.similarity, compareClean.similarity);
    }

    // Determine automatable confidence:
    // Requires valid marks and compatible name match (if name is provided)
    const automatable = obtainedMarks !== null
      && (candidateRollsOnRow.length === 0 || candidateChunk.length > 0)
      && (nameMatchScore === null || nameMatchScore >= 70);

    return {
      found: true,
      source: 'GAZETTE_PDF_TEXT',
      automatable,
      requiresReview: !automatable,
      rollNumber: rollStr,
      candidateName: candidateNameInGazette || candidateName || null,
      obtainedMarks,
      totalMarks: totalMarks || null,
      percentage: obtainedMarks !== null && effectiveTotal ? Number(((obtainedMarks / effectiveTotal) * 100).toFixed(2)) : null,
      isPass,
      status,
      rawSnippet: candidateChunk || matchedLine || snippet,
      nameMatchScore,
    };
  }

  /**
   * Search an uploaded board gazette by candidate roll number and extract official marks.
   *
   * @param {Object} params
   * @param {string} params.storageKey
   * @param {string} [params.storageProvider]
   * @param {string|number} params.rollNumber
   * @param {string} [params.candidateName]
   * @param {string|number} [params.examYear]
   * @param {string} [params.boardName]
   * @param {Buffer} [params.fileBuffer] Pre-loaded buffer if already in memory
   * @returns {Promise<{ found: boolean, obtainedMarks?: number, totalMarks?: number, isPass?: boolean, status?: string, rawSnippet?: string, reason?: string, error?: string }>}
   */
  static async searchGazette({
    storageKey,
    storageProvider,
    rollNumber,
    candidateName = '',
    examYear = '',
    boardName = '',
    fileBuffer = null,
  }) {
    if (!rollNumber) {
      return { found: false, reason: 'Roll number is required for gazette lookup.' };
    }

    const rollStr = String(rollNumber).trim();

    try {
      // 1. Retrieve extracted text from in-memory cache if previously parsed for this gazette
      let pdfText = storageKey ? this.getCachedText(storageKey) : null;
      let buffer = fileBuffer || null;

      if (!pdfText) {
        if (!buffer && storageKey) {
          buffer = await StorageService.getFileBuffer(storageKey, storageProvider);
        }
        if (!buffer) {
          return { found: false, reason: 'Gazette file could not be accessed from storage.' };
        }
        // Perform fast pure-Node PDF text stream extraction
        pdfText = this.extractTextFromPdfBuffer(buffer);
        if (storageKey && pdfText) {
          this.setCachedText(storageKey, pdfText);
        }
      }

      if (pdfText && pdfText.trim().length > 0) {
        const textResult = this.searchPdfTextForCandidate({
          pdfText,
          rollNumber: rollStr,
          candidateName,
        });

        if (textResult && textResult.found) {
          return textResult;
        }
      }

      // 3. Fallback: If text streams did not find the roll number (e.g. scanned/image pages or CID font issues),
      // and Gemini API is available, invoke Gemini AI to critically search the document.
      if (!buffer && storageKey) {
        buffer = await StorageService.getFileBuffer(storageKey, storageProvider);
      }

      if (buffer && process.env.GEMINI_API_KEY && buffer.length <= 25 * 1024 * 1024) {
        const aiResult = await this._searchGazetteWithGemini({
          buffer,
          rollNumber: rollStr,
          candidateName,
          boardName,
        });
        if (aiResult?.found) return aiResult;
      }

      return {
        found: false,
        reason: `Roll number ${rollStr} was not found in the official gazette.`,
      };
    } catch (error) {
      return {
        found: false,
        reason: `Gazette search encountered an error: ${error.message}`,
        error: error.message,
      };
    }
  }

  /**
   * Gemini Vision Fallback for scanned/image-based board gazette PDFs
   */
  static async _searchGazetteWithGemini({ buffer, rollNumber, candidateName, boardName }) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const candidateModels = [
      OCR_CONFIG.MODEL_NAME,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-flash-latest',
    ];
    const modelsToTry = [...new Set(candidateModels.filter(Boolean))];

    const prompt = `You are an educational board gazette result auditor for ${boardName || 'Pakistani Board'}.
Search this board gazette PDF document for the candidate with Roll Number "${rollNumber}".
If found, extract the candidate name, obtained marks, total marks (usually 1100), pass/fail status, and the raw snippet.
Return strictly valid JSON:
{
  "found": true or false,
  "roll_number": "${rollNumber}",
  "candidate_name": "extracted name or null",
  "obtained_marks": 740,
  "total_marks": 1100,
  "is_pass": true,
  "status": "PASS",
  "raw_snippet": "exact line from gazette"
}`;

    const requestBody = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: 'application/pdf',
                data: buffer.toString('base64'),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json',
      },
    };

    for (const model of modelsToTry) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(30000),
          }
        );

        if (!response.ok) continue;
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
        if (!parsed || !parsed.found) continue;

        const obtainedMarks = parsed.obtained_marks ? Number(parsed.obtained_marks) : null;
        const totalMarks = parsed.total_marks ? Number(parsed.total_marks) : 1100;
        const isPass = Boolean(parsed.is_pass);

        return {
          found: true,
          source: 'GAZETTE_AI_SCAN',
          automatable: true,
          requiresReview: false,
          rollNumber,
          candidateName: parsed.candidate_name || candidateName,
          obtainedMarks,
          totalMarks,
          percentage: obtainedMarks ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : null,
          isPass,
          status: parsed.status || 'PASS',
          rawSnippet: parsed.raw_snippet || `Roll ${rollNumber}`,
        };
      } catch {
        continue;
      }
    }

    return null;
  }
}

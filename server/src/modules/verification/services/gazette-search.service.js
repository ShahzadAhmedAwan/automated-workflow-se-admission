import zlib from 'node:zlib';
import { StorageService } from './storage/storage.service.js';
import { IdentityMatcherService } from './identity-matcher.service.js';
import { OCR_CONFIG } from '../verification.constants.js';

export class GazetteSearchService {
  static _textCache = new Map();

  static getCachedText(key) {
    if (!key) return null;
    const entry = this._textCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 30 * 60 * 1000) {
      this._textCache.delete(key);
      return null;
    }
    return entry.text;
  }

  static setCachedText(key, text) {
    if (!key || !text) return;
    if (this._textCache.size >= 3) {
      const oldestKey = this._textCache.keys().next().value;
      this._textCache.delete(oldestKey);
    }
    this._textCache.set(key, { text, timestamp: Date.now() });
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
      return buf.subarray(2).toString('utf16be');
    }
    if (buf.length >= 4 && buf[0] === 0x00 && buf[2] === 0x00) {
      return buf.toString('utf16be');
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

    // Combine matched line with contiguous context (e.g. 1 line above/below for multiline entries)
    const contextLines = [];
    const startIdx = Math.max(0, matchedIndex - 1);
    const endIdx = Math.min(lines.length - 1, matchedIndex + 1);
    for (let i = startIdx; i <= endIdx; i++) {
      contextLines.push(lines[i].trim());
    }
    const snippet = contextLines.join(' | ');
    const matchedLine = lines[matchedIndex].trim();

    // Look for obtained marks pattern:
    // e.g. "740", "740/1100", "740 / 1100", "520"
    // Marks are typically 2 to 4 digits between 100 and 1100 (or up to 1200)
    let obtainedMarks = null;
    let totalMarks = 1100;

    // Pattern 1: Explicit fraction (e.g. 740/1100)
    const fractionMatch = matchedLine.match(/\b([1-9]\d{1,3})\s*\/\s*(\d{3,4})\b/);
    if (fractionMatch) {
      obtainedMarks = parseInt(fractionMatch[1], 10);
      totalMarks = parseInt(fractionMatch[2], 10);
    } else {
      // Pattern 2: Standalone numbers excluding the roll number itself
      const numberMatches = matchedLine.match(/\b\d{2,4}\b/g) || [];
      const nonRollNumbers = numberMatches.filter((n) => n !== rollStr);

      for (const numStr of nonRollNumbers) {
        const val = parseInt(numStr, 10);
        // Scores are typically between 150 and 1100
        if (val >= 150 && val <= 1100) {
          obtainedMarks = val;
          break;
        }
      }
    }

    // Fallback: If marks were not found on the exact line, search surrounding snippet context
    if (obtainedMarks === null) {
      const snippetFraction = snippet.match(/\b([1-9]\d{1,3})\s*\/\s*(\d{3,4})\b/);
      if (snippetFraction) {
        obtainedMarks = parseInt(snippetFraction[1], 10);
        totalMarks = parseInt(snippetFraction[2], 10);
      } else {
        const snippetNumbers = snippet.match(/\b\d{2,4}\b/g) || [];
        const nonRoll = snippetNumbers.filter((n) => n !== rollStr);
        for (const numStr of nonRoll) {
          const val = parseInt(numStr, 10);
          if (val >= 150 && val <= 1100) {
            obtainedMarks = val;
            break;
          }
        }
      }
    }

    // Determine status: PASS, COMPARTMENT, FAIL, etc.
    let status = 'UNKNOWN';
    const upperSnippet = snippet.toUpperCase();
    if (upperSnippet.includes('PASS')) {
      status = 'PASS';
    } else if (upperSnippet.includes('COMP') || upperSnippet.includes('SUPPLY') || upperSnippet.includes('FAIL')) {
      status = 'COMPARTMENT';
    } else if (obtainedMarks && obtainedMarks >= 363) {
      // 33% of 1100 = 363 is passing threshold in Pakistan
      status = 'PASS';
    } else if (obtainedMarks) {
      status = 'PASS';
    }

    const isPass = status === 'PASS' || (obtainedMarks !== null && obtainedMarks >= 363);

    // Cross-check candidate name if candidateName is provided
    let nameMatchScore = null;
    if (candidateName) {
      const compare = IdentityMatcherService.compareNames(candidateName, matchedLine);
      nameMatchScore = compare.similarity;
    }

    return {
      found: true,
      source: 'GAZETTE_PDF_TEXT',
      rollNumber: rollStr,
      candidateName: candidateName || null,
      obtainedMarks,
      totalMarks,
      percentage: obtainedMarks ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : null,
      isPass,
      status,
      rawSnippet: matchedLine || snippet,
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
      let buffer = null;

      if (!pdfText) {
        buffer = fileBuffer || (storageKey ? await StorageService.getFileBuffer(storageKey, storageProvider) : null);
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

        // If text was extracted but roll number was not found in the text:
        return {
          found: false,
          reason: `Roll number ${rollStr} was not found in the official gazette text.`,
          textLength: pdfText.length,
        };
      }

      // 3. Fallback: If the PDF is scanned images (no text streams extracted),
      // and Gemini API is available, use Gemini Flash to parse the gazette page.
      if (process.env.GEMINI_API_KEY && buffer.length <= 20 * 1024 * 1024) {
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
        reason: `Roll number ${rollStr} could not be located in the gazette.`,
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

    try {
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

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${OCR_CONFIG.MODEL_NAME}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        }
      );

      if (!response.ok) return null;
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;

      const parsed = JSON.parse(rawText);
      if (!parsed.found) return { found: false, reason: `Roll number ${rollNumber} not found by AI vision.` };

      return {
        found: true,
        source: 'GAZETTE_AI_SCAN',
        rollNumber,
        candidateName: parsed.candidate_name || candidateName,
        obtainedMarks: parsed.obtained_marks ? Number(parsed.obtained_marks) : null,
        totalMarks: parsed.total_marks ? Number(parsed.total_marks) : 1100,
        percentage: parsed.obtained_marks ? Number(((parsed.obtained_marks / (parsed.total_marks || 1100)) * 100).toFixed(2)) : null,
        isPass: Boolean(parsed.is_pass),
        status: parsed.status || 'PASS',
        rawSnippet: parsed.raw_snippet || `Roll ${rollNumber}`,
      };
    } catch {
      return null;
    }
  }
}

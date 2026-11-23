import { OCR_CONFIG } from '../../verification.constants.js';

let lastCallTimestamp = 0;

export class GeminiOcrService {
  /**
   * Enforce the mandatory sequential rate-limit throttle (4500ms between calls)
   */
  static async _throttle() {
    const now = Date.now();
    const elapsed = now - lastCallTimestamp;
    if (elapsed < OCR_CONFIG.THROTTLE_MS) {
      const waitTime = OCR_CONFIG.THROTTLE_MS - elapsed;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    lastCallTimestamp = Date.now();
  }

  /**
   * Extract academic and identity data from a document buffer using Gemini Flash OCR
   *
   * @param {Object} params
   * @param {Buffer} params.fileBuffer
   * @param {string} params.mimeType
   * @param {string} params.docType
   * @param {Object} [params.studentContext]
   * @returns {Promise<{ raw: Object, extracted: Object, model: string }>}
   */
  static async extractDocumentData({ fileBuffer, mimeType, docType, studentContext = {} }) {
    const apiKey = process.env.GEMINI_API_KEY || '';

    if (process.env.USE_MOCK_OCR === '1' && process.env.NODE_ENV !== 'production') {
      return this._extractWithMock({ docType, studentContext });
    }
    if (!apiKey) throw new Error('OCR is not configured: set GEMINI_API_KEY before processing documents.');

    try {
      // Apply sequential rate-limit guard
      await this._throttle();

      // Normalize MIME type to standard IANA media types required by Gemini API
      let normalizedMime = String(mimeType || 'image/jpeg').toLowerCase();
      if (normalizedMime === 'image/jpg' || normalizedMime === 'image/pjpeg') normalizedMime = 'image/jpeg';
      if (normalizedMime === 'application/octet-stream') {
        if (fileBuffer.slice(0, 4).toString('ascii').startsWith('%PDF')) normalizedMime = 'application/pdf';
        else if (fileBuffer[0] === 0x89 && fileBuffer[1] === 0x50) normalizedMime = 'image/png';
        else normalizedMime = 'image/jpeg';
      }

      const base64Data = fileBuffer.toString('base64');
      const isCnic = docType === 'CNIC_FRONT' || docType === 'CNIC_BACK';
      const isDomicile = docType === 'DOMICILE';
      const prompt = isCnic ? `
You are an expert OCR parser for Pakistani National Identity Cards (CNIC / Smart Card / B-Form).
Extract structured identity information strictly as legible from this document image into valid JSON without any markdown or code blocks.
Document type: ${docType}

Expected JSON Schema:
{
  "candidate_name": "Full Name in English",
  "father_name": "Father Name or Husband Name in English",
  "cnic": "13-digit CNIC number without dashes or spaces, e.g. 8220312345671",
  "dob": "Date of birth if visible, e.g. YYYY-MM-DD or DD.MM.YYYY",
  "gender": "M or F if visible",
  "expiry_date": "Card expiry date if visible"
}
` : isDomicile ? `
You are an expert OCR parser for Pakistani Domicile Certificates and PRC (Permanent Residence Certificates).
Extract structured candidate identity and residence/domicile district information strictly as legible from this document image/PDF into valid, pure JSON without any markdown code block formatting.
Document type: ${docType}

Expected JSON Schema:
{
  "candidate_name": "Candidate Full Name in English as on Domicile Certificate",
  "father_name": "Father or Guardian Name in English",
  "district": "Domicile District Name (e.g. Mirpur, Islamabad, Lahore, Rawalpindi, Muzaffarabad, Faisalabad, etc.)",
  "city": "City, Town, or Tehsil Name (e.g. Mirpur, Dadyal, Islamabad, Rawalpindi)",
  "province": "Province or Territory (e.g. Azad Kashmir, Punjab, Islamabad Capital Territory, KPK, Sindh)",
  "cnic": "CNIC or B-Form number if visible",
  "issue_date": "Date of issue if visible"
}
` : `
You are an expert OCR parser for Pakistani Educational Board Marksheets and Certificates.
Extract structured academic result data strictly as legible from this document image/PDF into valid, pure JSON without any markdown code block formatting.
Document type: ${docType}

Expected JSON Schema:
{
  "candidate_name": "string (Candidate / Student Name exactly as written on marksheet)",
  "father_name": "string or null",
  "roll_number": "string or null (Roll Number)",
  "registration_number": "string or null",
  "board_name": "string (e.g. BISE MIRPUR, BISE LAHORE, FBISE, BISE RAWALPINDI, etc. Identify the exact board name shown on the header)",
  "exam_level": "SSC or HSSC or null (Matric/Secondary is SSC; Intermediate/FSc is HSSC)",
  "exam_session": "ANNUAL or SUPPLEMENTARY or SECOND_ANNUAL or null",
  "exam_part": "PART_I or PART_II or COMPOSITE or null",
  "exam_year": 2024,
  "total_marks": 1100,
  "obtained_marks": 940,
  "percentage": 85.45,
  "is_pass": true,
  "cnic": "string or null",
  "subjects": [
    { "subject": "string", "total": 100, "obtained": 85 }
  ]
}
`;

      const candidateModels = [
        OCR_CONFIG.MODEL_NAME,
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-flash-latest',
        'gemini-3.8-flash',
      ];
      const modelsToTry = [...new Set(candidateModels.filter(Boolean))];

      const requestBody = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: normalizedMime,
                  data: base64Data,
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

      let lastError = null;
      let result = null;
      let usedModel = null;

      for (const model of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(20000),
          });

          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            // If model is not found (404) or temporarily overloaded (503), try next candidate
            if (res.status === 404 || res.status === 503) {
              console.warn(`[Gemini OCR] Model ${model} returned HTTP ${res.status}. Trying next candidate model...`);
              lastError = new Error(`Model ${model} returned HTTP ${res.status}: ${errText}`);
              continue;
            }
            throw new Error(`Gemini Flash OCR API failed with status ${res.status}: ${errText}`);
          }

          const json = await res.json();
          const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!candidateText) {
            throw new Error(`Gemini model ${model} returned an empty candidate text response.`);
          }

          result = json;
          usedModel = model;
          break;
        } catch (callErr) {
          lastError = callErr;
          console.warn(`[Gemini OCR] Error attempting model ${model}: ${callErr.message}`);
        }
      }

      if (!result) {
        throw lastError || new Error('All configured Gemini OCR models failed to respond.');
      }

      const candidateText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      const cleanedJson = candidateText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      let parsedData;
      try {
        parsedData = JSON.parse(cleanedJson);
      } catch {
        const jsonBlock = candidateText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonBlock) {
          parsedData = JSON.parse(jsonBlock[1].trim());
        } else {
          const start = candidateText.indexOf('{');
          const end = candidateText.lastIndexOf('}');
          if (start !== -1 && end > start) {
            parsedData = JSON.parse(candidateText.substring(start, end + 1).trim());
          } else {
            throw new Error(`Invalid JSON returned from Gemini OCR: ${candidateText.slice(0, 200)}`);
          }
        }
      }

      return {
        raw: result,
        extracted: this._normalizeExtractedData(parsedData),
        model: usedModel,
        source: 'GEMINI',
        isMock: false,
      };
    } catch (networkOrApiError) {
      if (process.env.NODE_ENV !== 'production' && process.env.STRICT_LIVE_OCR !== '1' && process.env.USE_MOCK_OCR === '1') {
        console.warn(`[Gemini OCR] Live OCR failed (${networkOrApiError.message}). Falling back to development mock extraction.`);
        return this._extractWithMock({ docType, studentContext });
      }
      throw new Error(`Live OCR failed: ${networkOrApiError.message}`, { cause: networkOrApiError });
    }
  }

  /**
   * Deterministic mock OCR fallback
   */
  static async _extractWithMock({ docType, studentContext = {} }) {
    await new Promise((resolve) => setTimeout(resolve, 30));

    let base = {
      candidate_name: studentContext.fullName || 'Muhammad Usman',
      father_name: studentContext.fatherName || 'Tariq Mahmood',
      roll_number: studentContext.fscRollNo || '542198',
      board_name: 'FBISE ISLAMABAD',
      exam_year: 2025,
      total_marks: 1100,
      obtained_marks: studentContext.fscMarks || 940,
      is_pass: true,
    };

    if (docType === 'CNIC_FRONT' || docType === 'CNIC_BACK') {
      base = {
        candidate_name: studentContext.fullName || 'Muhammad Usman',
        father_name: studentContext.fatherName || 'Tariq Mahmood',
        cnic: studentContext.cnic || '3740512345671',
        dob: '2005-08-14',
        gender: 'M',
        expiry_date: '2030-08-14',
      };
    } else if (docType === 'DOMICILE') {
      base = {
        candidate_name: studentContext.fullName || 'Muhammad Usman',
        father_name: studentContext.fatherName || 'Tariq Mahmood',
        district: studentContext.city || 'Mirpur',
        city: studentContext.city || 'Mirpur',
        province: 'Azad Kashmir',
      };
    }

    return {
      raw: { mock: true, timestamp: new Date().toISOString() },
      extracted: this._normalizeExtractedData(base),
      model: 'mock-ocr-engine',
      source: 'MOCK',
      isMock: true,
    };
  }

  static _normalizeExtractedData(data) {
    const numberOrNull = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    const obtainedMarks = numberOrNull(data.obtained_marks ?? data.obtainedMarks);
    const totalMarks = numberOrNull(data.total_marks ?? data.totalMarks);
    return {
      candidateName: (data.candidate_name || data.candidateName || '').trim(),
      fatherName: (data.father_name || data.fatherName || '').trim(),
      rollNumber: String(data.roll_number || data.rollNumber || '').trim(),
      registrationNumber: String(data.registration_number || data.registrationNumber || '').trim(),
      boardName: (data.board_name || data.boardName || '').toUpperCase().trim(),
      examYear: Number(data.exam_year || data.examYear) || null,
      examLevel: this._normalizeExamLevel(data.exam_level || data.examLevel),
      examSession: this._normalizeExamSession(data.exam_session || data.examSession),
      examPart: this._normalizeExamPart(data.exam_part || data.examPart),
      totalMarks,
      obtainedMarks,
      percentage: numberOrNull(data.percentage) ?? (obtainedMarks !== null && totalMarks ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : null),
      isPass: typeof (data.is_pass ?? data.isPass) === 'boolean' ? (data.is_pass ?? data.isPass) : null,
      cnic: data.cnic ? String(data.cnic).replace(/\D/g, '') : null,
      dob: data.dob ? String(data.dob).trim() : null,
      gender: data.gender ? String(data.gender).trim() : null,
      expiryDate: (data.expiry_date || data.expiryDate) ? String(data.expiry_date || data.expiryDate).trim() : null,
      district: String(data.district || '').trim(),
      city: String(data.city || data.district || data.tehsil || '').trim(),
      tehsil: String(data.tehsil || '').trim(),
      province: String(data.province || '').trim(),
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
    };
  }

  static _normalizeExamLevel(value) {
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (['SSC', 'MATRIC', 'SECONDARY', 'SSC1', 'SSC2'].includes(normalized)) return 'SSC';
    if (['HSSC', 'FSC', 'INTERMEDIATE', 'INTER', 'HSSC1', 'HSSC2'].includes(normalized)) return 'HSSC';
    return null;
  }

  static _normalizeExamSession(value) {
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (['ANNUAL', 'FIRSTANNUAL', '1STANNUAL'].includes(normalized)) return 'ANNUAL';
    if (['SUPPLEMENTARY', 'SUPPLY', 'SUPPLEMENT', 'SECONDANNUAL', '2NDANNUAL'].includes(normalized)) return 'SECOND_ANNUAL';
    return null;
  }

  static _normalizeExamPart(value) {
    const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (['I', '1', 'PARTI', 'PART1', 'SSCI', 'HSSCI', 'SSC1', 'HSSC1', '9TH', '11TH'].includes(normalized)) return 'PART_I';
    if (['II', '2', 'PARTII', 'PART2', 'SSCII', 'HSSCII', 'SSC2', 'HSSC2', '10TH', '12TH'].includes(normalized)) return 'PART_II';
    if (['COMPOSITE', 'COMBINED'].includes(normalized)) return 'COMPOSITE';
    return null;
  }
}

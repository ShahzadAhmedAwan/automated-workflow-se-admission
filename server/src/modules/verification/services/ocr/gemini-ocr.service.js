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

      const base64Data = fileBuffer.toString('base64');
      const prompt = `
You are an expert OCR parser for Pakistani Educational Board Marksheets and Identity documents.
Extract structured data from this document image/PDF into valid, pure JSON without any markdown code block formatting.
Document type: ${docType}

Expected JSON Schema:
{
  "candidate_name": "string",
  "father_name": "string or null",
  "roll_number": "string or null",
  "registration_number": "string or null",
  "board_name": "string (e.g. FBISE, BISE LAHORE, BISE AJK)",
  "exam_year": 2024,
  "total_marks": 1100,
  "obtained_marks": 940,
  "percentage": 85.45,
  "is_pass": true,
  "cnic": "string or null",
  "subjects": [
    { "subject": "Mathematics", "total": 200, "obtained": 180 }
  ]
}
`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${OCR_CONFIG.MODEL_NAME}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
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

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => '');
        throw new Error(`Gemini Flash OCR API failed with status ${res.status}: ${err}`);
      }

      const result = await res.json();
      const candidateText = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!candidateText) {
        throw new Error('Gemini OCR returned an empty candidate text response.');
      }

      const cleanedJson = candidateText.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
      const parsedData = JSON.parse(cleanedJson);

      return {
        raw: result,
        extracted: this._normalizeExtractedData(parsedData),
        model: OCR_CONFIG.MODEL_NAME,
        source: 'GEMINI',
        isMock: false,
      };
    } catch (networkOrApiError) {
      throw new Error(`Live OCR failed: ${networkOrApiError.message}`, { cause: networkOrApiError });
    }
  }

  /**
   * Deterministic mock OCR fallback
   */
  static async _extractWithMock({ docType, studentContext = {} }) {
    await new Promise((resolve) => setTimeout(resolve, 30));

    const base = {
      candidate_name: studentContext.fullName || 'Muhammad Usman',
      father_name: studentContext.fatherName || 'Tariq Mahmood',
      roll_number: studentContext.fscRollNo || '542198',
      board_name: 'FBISE ISLAMABAD',
      exam_year: 2025,
      total_marks: 1100,
      obtained_marks: studentContext.fscMarks || 940,
      is_pass: true,
    };

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
      totalMarks,
      obtainedMarks,
      percentage: numberOrNull(data.percentage) ?? (obtainedMarks !== null && totalMarks ? Number(((obtainedMarks / totalMarks) * 100).toFixed(2)) : null),
      isPass: typeof (data.is_pass ?? data.isPass) === 'boolean' ? (data.is_pass ?? data.isPass) : null,
      cnic: data.cnic ? String(data.cnic).replace(/\D/g, '') : null,
      subjects: Array.isArray(data.subjects) ? data.subjects : [],
    };
  }
}

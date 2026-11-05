import { parse } from 'csv-parse';
import { Readable } from 'node:stream';
import { pool } from '../../../core/db/pool.js';

/**
 * Normalizes phone numbers to standard E.164 without '+' sign.
 * Specially handles Pakistani phone numbers (03xx -> 923xx).
 */
export function normalizePhoneNumber(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // Local Pakistani format: 03001234567 -> 923001234567 (11 digits starting with 0)
  if (digits.startsWith('0') && digits.length === 11) {
    digits = '92' + digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith('3')) {
    // Missing country code: 3001234567 -> 923001234567
    digits = '92' + digits;
  }

  // Validate E.164 length (8 to 15 digits)
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return digits;
}

/**
 * Fuzzy matches raw CSV header strings to canonical model fields
 */
function mapHeaderToField(header) {
  const clean = String(header).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['name', 'fullname', 'studentname', 'applicantname', 'candidate'].includes(clean)) {
    return 'fullName';
  }
  if (['phone', 'phonenumber', 'contact', 'contactnumber', 'mobile', 'cell', 'whatsapp'].includes(clean)) {
    return 'phone';
  }
  if (['city', 'location', 'district', 'town'].includes(clean)) {
    return 'city';
  }
  if (['priordegree', 'education', 'degree', 'qualification', 'lasteducation', 'group'].includes(clean)) {
    return 'priorDegree';
  }
  return null;
}

/**
 * Memory-safe streaming CSV parser and dry-run validator
 * @param {Buffer|Readable} inputSource
 * @param {Object} options
 * @returns {Promise<{ totalRows: number, validCount: number, duplicateCount: number, invalidPhoneCount: number, previewRows: Array, validLeads: Array }>}
 */
export async function parseAndPreviewLeads(inputSource, { previewLimit = 10, dbConnection = pool } = {}) {
  const stream = Buffer.isBuffer(inputSource)
    ? Readable.from(inputSource)
    : inputSource;

  const parser = stream.pipe(
    parse({
      columns: (headers) => headers.map(mapHeaderToField),
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  );

  let totalRows = 0;
  let invalidPhoneCount = 0;
  let duplicateCount = 0;
  const seenInFile = new Set();
  const validLeads = [];
  const previewRows = [];

  for await (const record of parser) {
    totalRows++;
    const rawName = record.fullName || 'Applicant';
    const rawPhone = record.phone || '';
    const rawCity = record.city || '';
    const rawDegree = record.priorDegree || '';

    const normalizedPhone = normalizePhoneNumber(rawPhone);

    if (!normalizedPhone) {
      invalidPhoneCount++;
      if (previewRows.length < previewLimit) {
        previewRows.push({
          fullName: rawName,
          phoneRaw: rawPhone,
          phoneNormalized: null,
          city: rawCity,
          priorDegree: rawDegree,
          status: 'INVALID_PHONE',
        });
      }
      continue;
    }

    if (seenInFile.has(normalizedPhone)) {
      duplicateCount++;
      if (previewRows.length < previewLimit) {
        previewRows.push({
          fullName: rawName,
          phoneRaw: rawPhone,
          phoneNormalized: normalizedPhone,
          city: rawCity,
          priorDegree: rawDegree,
          status: 'DUPLICATE_IN_FILE',
        });
      }
      continue;
    }
    seenInFile.add(normalizedPhone);

    const leadItem = {
      fullName: rawName,
      phoneRaw: rawPhone,
      phoneNormalized: normalizedPhone,
      city: rawCity,
      priorDegree: rawDegree,
      status: 'VALID',
    };

    validLeads.push(leadItem);
    if (previewRows.length < previewLimit) {
      previewRows.push(leadItem);
    }
  }

  // Cross-reference existing leads in database to flag existing phone numbers
  if (validLeads.length > 0) {
    const phonesToCheck = validLeads.map((l) => l.phoneNormalized);
    // Chunk query in batches of 500 for SQL safety
    const chunkSize = 500;
    const existingPhones = new Set();

    for (let i = 0; i < phonesToCheck.length; i += chunkSize) {
      const slice = phonesToCheck.slice(i, i + chunkSize);
      const [rows] = await dbConnection.query(
        `SELECT phone_normalized FROM mkt_leads WHERE phone_normalized IN (${slice.map(() => '?').join(',')})`,
        slice
      );
      for (const row of rows) {
        existingPhones.add(row.phone_normalized);
      }
    }

    // Adjust counts and statuses
    for (let i = 0; i < validLeads.length; i++) {
      if (existingPhones.has(validLeads[i].phoneNormalized)) {
        validLeads[i].status = 'DUPLICATE_IN_DB';
        duplicateCount++;
      }
    }
    for (const preview of previewRows) {
      if (preview.phoneNormalized && existingPhones.has(preview.phoneNormalized)) {
        preview.status = 'DUPLICATE_IN_DB';
      }
    }
  }

  const trulyValid = validLeads.filter((l) => l.status === 'VALID');

  return {
    totalRows,
    validCount: trulyValid.length,
    duplicateCount,
    invalidPhoneCount,
    previewRows,
    validLeads: trulyValid,
  };
}

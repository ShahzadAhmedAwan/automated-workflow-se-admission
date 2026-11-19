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
  if (['name', 'fullname', 'studentname', 'applicantname', 'candidate', 'student'].includes(clean)) {
    return 'fullName';
  }
  if (['phone', 'phonenumber', 'contact', 'contactnumber', 'mobile', 'cell', 'whatsapp', 'number'].includes(clean)) {
    return 'phone';
  }
  if (['fathername', 'father', 'guardian', 'guardianname', 'parentname'].includes(clean)) {
    return 'fatherName';
  }
  if (['cnic', 'bform', 'idcard', 'nationalid', 'identity', 'cnicno'].includes(clean)) {
    return 'cnic';
  }
  if (['email', 'emailaddress', 'mail'].includes(clean)) {
    return 'email';
  }
  if (['city', 'location', 'district', 'town', 'address'].includes(clean)) {
    return 'city';
  }
  if (['priordegree', 'education', 'degree', 'qualification', 'lasteducation', 'group', 'intergroup'].includes(clean)) {
    return 'priorDegree';
  }
  if (['fscmarks', 'marks', 'score', 'obtainedmarks', 'intermediate', 'fscscore', 'intermarks'].includes(clean)) {
    return 'fscMarks';
  }
  if (['hasmaths', 'maths', 'mathematics', 'math'].includes(clean)) {
    return 'hasMaths';
  }
  if (['eligiblefor', 'program', 'preferredprogram', 'desiredprogram', 'appliedfor'].includes(clean)) {
    return 'eligibleFor';
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
    const rawFather = record.fatherName || '';
    const rawCnic = record.cnic ? String(record.cnic).trim() : '';
    const rawEmail = record.email ? String(record.email).trim() : '';
    const rawProgram = record.eligibleFor ? String(record.eligibleFor).trim() : '';
    
    let parsedMarks = null;
    if (record.fscMarks !== undefined && record.fscMarks !== null && String(record.fscMarks).trim() !== '') {
      const num = Number(record.fscMarks);
      if (!Number.isNaN(num) && num >= 0 && num <= 1100) {
        parsedMarks = Math.round(num);
      }
    }

    let parsedMaths = null;
    if (record.hasMaths !== undefined && record.hasMaths !== null && String(record.hasMaths).trim() !== '') {
      const mStr = String(record.hasMaths).trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(mStr)) parsedMaths = true;
      else if (['no', 'n', 'false', '0'].includes(mStr)) parsedMaths = false;
    }

    const normalizedPhone = normalizePhoneNumber(rawPhone);

    if (!normalizedPhone) {
      invalidPhoneCount++;
      if (previewRows.length < previewLimit) {
        previewRows.push({
          fullName: rawName,
          fatherName: rawFather || null,
          phoneRaw: rawPhone,
          phoneNormalized: null,
          cnic: rawCnic || null,
          email: rawEmail || null,
          city: rawCity,
          priorDegree: rawDegree,
          fscMarks: parsedMarks,
          hasMaths: parsedMaths,
          eligibleFor: rawProgram || null,
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
          fatherName: rawFather || null,
          phoneRaw: rawPhone,
          phoneNormalized: normalizedPhone,
          cnic: rawCnic || null,
          email: rawEmail || null,
          city: rawCity,
          priorDegree: rawDegree,
          fscMarks: parsedMarks,
          hasMaths: parsedMaths,
          eligibleFor: rawProgram || null,
          status: 'DUPLICATE_IN_FILE',
        });
      }
      continue;
    }
    seenInFile.add(normalizedPhone);

    const leadItem = {
      fullName: rawName,
      fatherName: rawFather || null,
      phoneRaw: rawPhone,
      phoneNormalized: normalizedPhone,
      cnic: rawCnic || null,
      email: rawEmail || null,
      city: rawCity,
      priorDegree: rawDegree,
      fscMarks: parsedMarks,
      hasMaths: parsedMaths,
      eligibleFor: rawProgram || null,
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
      try {
        const [studentRows] = await dbConnection.query(
          `SELECT phone_normalized FROM adm_students WHERE phone_normalized IN (${slice.map(() => '?').join(',')})`,
          slice
        );
        for (const row of studentRows) {
          existingPhones.add(row.phone_normalized);
        }
      } catch {
        // Non-blocking if adm_students is not populated in mock DB fixtures
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

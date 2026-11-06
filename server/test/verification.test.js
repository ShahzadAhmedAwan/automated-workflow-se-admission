import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { IntakeTokenService } from '../src/modules/verification/services/intake-token.service.js';
import { DiscrepancyParserService } from '../src/modules/verification/services/discrepancy-parser.service.js';
import { StorageService } from '../src/modules/verification/services/storage/storage.service.js';
import { GeminiOcrService } from '../src/modules/verification/services/ocr/gemini-ocr.service.js';
import { BoardRegistryService } from '../src/modules/verification/services/scrapers/board-registry.service.js';
import { VerificationDecisionService } from '../src/modules/verification/services/verification-decision.service.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_VERIFICATION_STATUS,
  STUDENT_OVERALL_STATUS,
  TOKEN_CONFIG,
} from '../src/modules/verification/verification.constants.js';

test('IntakeTokenService: creates high-entropy 32-byte tokens and deterministic SHA-256 hashes', async () => {
  const mockDb = {
    async execute(query, params) {
      assert.ok(query.includes('INSERT INTO adm_intake_tokens'));
      assert.equal(params[0], 42); // student_id
      assert.equal(params[1].length, 64); // sha256 hex string
      assert.equal(params[3], 1); // attempt_count
      return [{ insertId: 88 }];
    },
  };

  const result = await IntakeTokenService.generateToken({
    studentId: 42,
    allowedDocTypes: [DOCUMENT_TYPES.FSC_MARKSHEET, DOCUMENT_TYPES.MATRIC_MARKSHEET],
    expiresInHours: 48,
    connection: mockDb,
  });

  assert.equal(result.tokenId, 88);
  assert.equal(result.rawToken.length, 64); // 32 bytes in hex = 64 hex characters
  assert.equal(result.tokenHash, crypto.createHash('sha256').update(result.rawToken).digest('hex'));
  assert.equal(result.attemptCount, 1);
  assert.ok(result.expiresAt > new Date());
});

test('IntakeTokenService: validateToken blocks revoked, used, and expired tokens', async () => {
  // Test non-existent token
  const emptyDb = {
    async execute() { return [[]]; },
  };
  await assert.rejects(
    IntakeTokenService.validateToken('a'.repeat(64), emptyDb),
    (err) => err.code === 'TOKEN_NOT_FOUND'
  );

  // Test revoked token
  const revokedDb = {
    async execute() {
      return [[{
        token_id: 1, student_id: 10, is_revoked: 1, used_at: null,
        expires_at: new Date(Date.now() + 100000), full_name: 'Test Student'
      }]];
    },
  };
  await assert.rejects(
    IntakeTokenService.validateToken('b'.repeat(64), revokedDb),
    (err) => err.code === 'TOKEN_REVOKED'
  );

  // Test already used token
  const usedDb = {
    async execute() {
      return [[{
        token_id: 1, student_id: 10, is_revoked: 0, used_at: new Date(),
        expires_at: new Date(Date.now() + 100000), full_name: 'Test Student'
      }]];
    },
  };
  await assert.rejects(
    IntakeTokenService.validateToken('c'.repeat(64), usedDb),
    (err) => err.code === 'TOKEN_ALREADY_USED'
  );

  // Test expired token
  const expiredDb = {
    async execute() {
      return [[{
        token_id: 1, student_id: 10, is_revoked: 0, used_at: null,
        expires_at: new Date(Date.now() - 100000), full_name: 'Test Student'
      }]];
    },
  };
  await assert.rejects(
    IntakeTokenService.validateToken('d'.repeat(64), expiredDb),
    (err) => err.code === 'TOKEN_EXPIRED'
  );

  // Test valid token with privacy masking
  const validDb = {
    async execute() {
      return [[{
        token_id: 12,
        student_id: 99,
        allowed_doc_types: JSON.stringify([DOCUMENT_TYPES.FSC_MARKSHEET]),
        attempt_count: 1,
        is_revoked: 0,
        used_at: null,
        expires_at: new Date(Date.now() + 100000),
        application_no: 'APP-1234',
        full_name: 'Muhammad Usman Tariq',
        phone_normalized: '923001234567',
        overall_status: 'DOCS_REQUESTED',
      }]];
    },
  };

  const validated = await IntakeTokenService.validateToken('e'.repeat(64), validDb);
  assert.equal(validated.studentId, 99);
  assert.equal(validated.applicationNo, 'APP-1234');
  assert.equal(validated.maskedFullName, 'Muhammad U**** T****');
  assert.deepEqual(validated.allowedDocTypes, [DOCUMENT_TYPES.FSC_MARKSHEET]);
});

test('DiscrepancyParserService: parses CSV with messy separators and maps to DOCUMENT_TYPES', () => {
  const csvData = `Application No,CNIC,Full Name,Phone,Issues
APP-01,3740512345671,Ali Khan,0300-1122334,MATRIC_MARKSHEET; FSC_MARKSHEET
APP-02,3740512345672,Sara Ahmed,+92 312 9988776,cnic front | cnic back
APP-03,3740512345673,Hamza Tariq,0333 4455667,"Domicile, Equivalence"`;

  const parsed = DiscrepancyParserService.parseDiscrepancyCsv(Buffer.from(csvData));
  assert.equal(parsed.length, 3);

  assert.equal(parsed[0].phoneNormalized, '923001122334');
  assert.deepEqual(parsed[0].allowedDocTypes, [DOCUMENT_TYPES.MATRIC_MARKSHEET, DOCUMENT_TYPES.FSC_MARKSHEET]);

  assert.equal(parsed[1].phoneNormalized, '923129988776');
  assert.deepEqual(parsed[1].allowedDocTypes, [DOCUMENT_TYPES.CNIC_FRONT, DOCUMENT_TYPES.CNIC_BACK]);

  assert.equal(parsed[2].phoneNormalized, '923334455667');
  assert.deepEqual(parsed[2].allowedDocTypes, [DOCUMENT_TYPES.DOMICILE, DOCUMENT_TYPES.EQUIVALENCE_CERTIFICATE]);
});

test('StorageService: handles local fallback, key generation and file deletion cleanly', async () => {
  const testBuffer = Buffer.from('SE_ADMISSIONS_TEST_IMAGE_BYTES');
  const upload = await StorageService.uploadFile({
    buffer: testBuffer,
    originalFilename: 'test_document.png',
    mimeType: 'image/png',
    studentId: 777,
    docType: DOCUMENT_TYPES.FSC_MARKSHEET,
  });

  assert.ok(upload.storageKey.startsWith('uploads/student_777/fsc_marksheet_'));
  assert.ok(upload.storageKey.endsWith('.png'));

  const retrieved = await StorageService.getFileBuffer(upload.storageKey, upload.storageProvider);
  assert.equal(retrieved.toString(), 'SE_ADMISSIONS_TEST_IMAGE_BYTES');

  await StorageService.deleteFile(upload.storageKey, upload.storageProvider);
  await assert.rejects(
    StorageService.getFileBuffer(upload.storageKey, upload.storageProvider),
    /File not found/
  );
});

test('GeminiOcrService: normalizes extracted academic attributes properly', () => {
  const raw = {
    candidate_name: ' Muhammad Usman ',
    father_name: ' Tariq Mahmood ',
    roll_number: ' 542198 ',
    board_name: ' fbise islamabad ',
    exam_year: '2024',
    total_marks: '1100',
    obtained_marks: '950',
    is_pass: true,
  };

  const normalized = GeminiOcrService._normalizeExtractedData(raw);
  assert.equal(normalized.candidateName, 'Muhammad Usman');
  assert.equal(normalized.fatherName, 'Tariq Mahmood');
  assert.equal(normalized.rollNumber, '542198');
  assert.equal(normalized.boardName, 'FBISE ISLAMABAD');
  assert.equal(normalized.obtainedMarks, 950);
  assert.equal(normalized.totalMarks, 1100);
  assert.equal(normalized.percentage, 86.36);
  assert.equal(normalized.isPass, true);
});

test('BoardRegistryService: safely returns failure status on invalid roll number or network error', async () => {
  const result = await BoardRegistryService.verifyCandidate({
    boardName: 'FBISE',
    rollNumber: '',
  });
  assert.equal(result.isVerified, false);
  assert.equal(result.status, 'NO_ROLL_NUMBER');

  const unsupported = await BoardRegistryService.verifyCandidate({
    boardName: 'UNKNOWN_FOREIGN_BOARD',
    rollNumber: '12345',
  });
  assert.equal(unsupported.isVerified, false);
});

test('VerificationDecisionService: Condition A (Verified Match) sets VERIFIED and schedules GDrive migration', async () => {
  const executedQueries = [];
  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 50,
          cnic: '3740512345671',
          full_name: 'Muhammad Usman',
          phone_normalized: '923001234567',
          fsc_obtained_marks: 940,
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ?') || query.includes('verification_status NOT IN')) {
        return [[]]; // No remaining unmatched documents -> all verified!
      }
      if (query.includes('FROM adm_student_documents WHERE id = ?')) {
        return [[{ storage_key: 'uploads/fsc.jpg', original_filename: 'fsc.jpg', file_mime: 'image/jpeg' }]];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        return [{ insertId: 999 }];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 10,
    studentId: 50,
    docType: 'FSC_MARKSHEET',
    extractedOcr: { obtainedMarks: 940, totalMarks: 1100, rollNumber: '542198', isPass: true },
    portalVerification: { isVerified: true },
    connection: mockDb,
  });

  assert.equal(decision.status, 'MATCHED');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.VERIFIED);

  const gdriveJob = executedQueries.find((q) => q.query.includes('INSERT INTO outbox_jobs') && q.params[1] === 'MIGRATE_GDRIVE');
  assert.ok(gdriveJob, 'MIGRATE_GDRIVE outbox job was scheduled');
});

test('VerificationDecisionService: Condition B (Discrepancy Attempt 1) reissues fresh token and WhatsApp alert', async () => {
  const executedQueries = [];
  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 50,
          cnic: '3740512345671',
          full_name: 'Muhammad Usman',
          phone_normalized: '923001234567',
          fsc_obtained_marks: 940, // Student declared 940
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1, // First attempt
        }]];
      }
      if (query.includes('INSERT INTO adm_intake_tokens')) {
        return [{ insertId: 77 }];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        return [{ insertId: 1001 }];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 10,
    studentId: 50,
    docType: 'FSC_MARKSHEET',
    extractedOcr: { obtainedMarks: 810, totalMarks: 1100, isPass: true }, // Mismatched marks: 810 vs 940
    portalVerification: { isVerified: false },
    connection: mockDb,
  });

  assert.equal(decision.status, 'DISCREPANCY_REISSUED');
  assert.equal(decision.nextAttempt, 2);
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.DOCS_REQUESTED);

  // Confirms WhatsApp discrepancy alert was dispatched
  const alertJob = executedQueries.find((q) => q.query.includes('INSERT INTO outbox_jobs') && q.params[1] === 'WHATSAPP_MESSAGE');
  assert.ok(alertJob, 'WhatsApp discrepancy alert job was dispatched');
});

test('VerificationDecisionService: Condition C (Discrepancy Attempt 3) escalates to NEEDS_MANUAL_REVIEW', async () => {
  const executedQueries = [];
  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 50,
          cnic: '3740512345671',
          full_name: 'Muhammad Usman',
          phone_normalized: '923001234567',
          fsc_obtained_marks: 940,
          overall_status: 'UNDER_REVIEW',
          attempt_count: 3, // Max attempt reached
        }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 10,
    studentId: 50,
    docType: 'FSC_MARKSHEET',
    extractedOcr: { obtainedMarks: 810, totalMarks: 1100, isPass: true },
    portalVerification: { isVerified: false },
    connection: mockDb,
  });

  assert.equal(decision.status, 'ESCALATED_MANUAL_REVIEW');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);

  const escalationUpdate = executedQueries.find((q) => q.query.includes('UPDATE adm_students') && q.params[0] === 'NEEDS_MANUAL_REVIEW');
  assert.ok(escalationUpdate, 'adm_students was updated to NEEDS_MANUAL_REVIEW');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { IntakeTokenService } from '../src/modules/verification/services/intake-token.service.js';
import { DiscrepancyParserService } from '../src/modules/verification/services/discrepancy-parser.service.js';
import { StorageService } from '../src/modules/verification/services/storage/storage.service.js';
import { GeminiOcrService } from '../src/modules/verification/services/ocr/gemini-ocr.service.js';
import { BoardRegistryService } from '../src/modules/verification/services/scrapers/board-registry.service.js';
import { VerificationDecisionService } from '../src/modules/verification/services/verification-decision.service.js';
import { AdmissionIntakeService } from '../src/modules/verification/services/admission-intake.service.js';
import { BoardSourceService } from '../src/modules/verification/services/board-source.service.js';
import { manualReviewActionSchema } from '../src/modules/verification/verification.schemas.js';
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

test('BoardSourceService: matches configured board aliases and exact academic year', async () => {
  const mockDb = {
    async execute() {
      return [[
        { id: 1, board_name: 'Federal Board (FBISE)', board_aliases: ['FBISE', 'Federal Board'], academic_year: 'ALL', source_type: 'PORTAL_URL' },
        { id: 2, board_name: 'AJK BISE Mirpur', board_aliases: '["AJK BISE","Mirpur Board"]', academic_year: '2026', source_type: 'GAZETTE' },
      ]];
    },
  };

  assert.equal((await BoardSourceService.findForBoard('Federal Board Islamabad', '2026', mockDb)).id, 1);
  assert.equal((await BoardSourceService.findForBoard('AJK BISE', '2026', mockDb)).id, 2);
  assert.equal(await BoardSourceService.findForBoard('AJK BISE', undefined, mockDb), null);
  assert.equal(await BoardSourceService.findForBoard('Unconfigured Board', '2026', mockDb), null);
});

test('Manual review schema requires a document decision, evidence type, and audit note', () => {
  assert.equal(manualReviewActionSchema.safeParse({ studentId: 5, documentId: 9, action: 'APPROVE' }).success, false);
  assert.equal(manualReviewActionSchema.safeParse({ studentId: 5, documentId: 9, action: 'APPROVE', reviewMethod: 'STAFF_PORTAL' }).success, false);
  assert.equal(manualReviewActionSchema.safeParse({ studentId: 5, documentId: 9, action: 'APPROVE', reviewMethod: 'STAFF_DOCUMENT', notes: 'Checked original transcript.' }).success, true);
});

test('AdmissionIntakeService: queue returns stable pages and independent status totals', async () => {
  const mockDb = {
    async query(query) {
      if (query.includes('GROUP BY overall_status')) return [[
        { overall_status: 'NEEDS_MANUAL_REVIEW', total: 3 },
        { overall_status: 'UNDER_REVIEW', total: 12 },
        { overall_status: 'DOCS_REQUESTED', total: 2 },
        { overall_status: 'VERIFIED', total: 40 },
      ]];
      if (query.includes('COUNT(*) AS total')) return [[{ total: 27 }]];
      return [[{ student_id: 26, full_name: 'Queue Page Candidate', document_count: 1, overall_status: 'UNDER_REVIEW' }]];
    },
  };

  const result = await AdmissionIntakeService.listManualReviewQueue({ limit: 25, offset: 25 }, mockDb);
  assert.equal(result.items[0].studentId, 26);
  assert.equal(result.total, 27);
  assert.equal(result.offset, 25);
  assert.equal(result.summary.VERIFIED, 40);
  assert.equal(result.summary.UNDER_REVIEW, 12);
});

test('AdmissionIntakeService: OCR job skips documents already manually decided', async () => {
  const calls = [];
  let committed = false;
  let released = false;
  const connection = {
    async beginTransaction() {},
    async commit() { committed = true; },
    async rollback() { assert.fail('Skipped job must not roll back.'); },
    release() { released = true; },
    async execute(query, params) {
      calls.push({ query, params });
      return [[]]; // Document is not PENDING or OCR_PROCESSING.
    },
  };
  const result = await AdmissionIntakeService.processOcrDocumentJob(
    { documentId: 12, studentId: 44, docType: DOCUMENT_TYPES.FSC_MARKSHEET },
    { getConnection: async () => connection }
  );

  assert.equal(result.status, 'SKIPPED');
  assert.equal(committed, true);
  assert.equal(released, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /d\.student_id = \?/);
  assert.deepEqual(calls[0].params, [12, 44, DOCUMENT_VERIFICATION_STATUS.PENDING]);
});

test('AdmissionIntakeService: manual approval attributes reviewer and queues archive atomically', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() { assert.fail('Review transaction should commit.'); },
    release() {},
    async execute(query, params) {
      calls.push({ query, params });
      if (query.includes('FROM adm_students WHERE id = ? FOR UPDATE')) {
        return [[{ id: 44, cnic: '3740512345671', phone_normalized: '923001234567', full_name: 'Candidate' }]];
      }
      if (query.includes('FROM adm_student_documents WHERE id = ? AND student_id = ? FOR UPDATE')) {
        return [[{ id: 12, doc_type: DOCUMENT_TYPES.FSC_MARKSHEET, verification_status: DOCUMENT_VERIFICATION_STATUS.MANUAL_REVIEW,
          storage_state: 'ACTIVE_R2', storage_key: 'uploads/candidate/fsc.pdf', original_filename: 'fsc.pdf', file_mime: 'application/pdf' }]];
      }
      if (query.includes('SELECT id FROM adm_student_documents WHERE student_id = ? AND verification_status NOT IN')) return [[]];
      if (query.includes('SELECT overall_status, verified_at, verified_by')) return [[{ overall_status: 'VERIFIED', verified_at: new Date(), verified_by: 'staff-1' }]];
      if (query.includes('INSERT INTO outbox_jobs')) return [{ insertId: 91 }];
      if (query.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 92 }];
      return [{ affectedRows: 1 }];
    },
  };

  const result = await AdmissionIntakeService.executeManualReviewAction({
    studentId: 44, documentId: 12, action: 'APPROVE', reviewMethod: 'STAFF_DOCUMENT',
    notes: 'Compared original marksheet.', actorId: 'staff-1',
  }, { getConnection: async () => connection });

  assert.equal(result.overall_status, 'VERIFIED');
  assert.equal(result.verified_by, 'staff-1');
  const archiveJob = calls.find(({ query, params }) => query.includes('INSERT INTO outbox_jobs') && params[1] === 'MIGRATE_GDRIVE');
  assert.ok(archiveJob, 'manual approval queues document archival');
  const payload = JSON.parse(archiveJob.params[2]);
  assert.equal(payload.documentId, 12);
  assert.equal(payload.studentId, 44);
  const audit = calls.find(({ query }) => query.includes('INSERT INTO sys_audit_logs'));
  assert.equal(audit.params[3], 'VERIFICATION');
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

test('GeminiOcrService: missing live credentials fails closed instead of using fixture data', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousMock = process.env.USE_MOCK_OCR;
  delete process.env.GEMINI_API_KEY;
  process.env.USE_MOCK_OCR = '0';
  try {
    await assert.rejects(
      GeminiOcrService.extractDocumentData({ fileBuffer: Buffer.from('not a document'), mimeType: 'application/pdf', docType: 'FSC_MARKSHEET' }),
      /OCR is not configured/
    );
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousMock === undefined) delete process.env.USE_MOCK_OCR;
    else process.env.USE_MOCK_OCR = previousMock;
  }
});

test('BoardRegistryService: safely returns failure for invalid rolls and unsupported boards', async () => {
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
  assert.equal(unsupported.status, 'UNSUPPORTED_BOARD');
});

test('VerificationDecisionService: fixture OCR never approves a candidate', async () => {
  const updates = [];
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) return [[{
        id: 50, full_name: 'Muhammad Usman', phone_normalized: '923001234567',
        fsc_obtained_marks: 940, overall_status: 'UNDER_REVIEW', attempt_count: 1,
      }]];
      updates.push({ query, params });
      return [[], undefined];
    },
  };
  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 10,
    studentId: 50,
    docType: DOCUMENT_TYPES.FSC_MARKSHEET,
    extractedOcr: { source: 'MOCK', isMock: true, candidateName: 'Muhammad Usman', obtainedMarks: 940, totalMarks: 1100, isPass: true },
    portalVerification: { isVerified: true, candidateName: 'Muhammad Usman', boardMarks: 940 },
    connection: mockDb,
  });
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);
  assert.ok(updates.some(({ query, params }) => query.includes('UPDATE adm_student_documents') && params[0] === DOCUMENT_VERIFICATION_STATUS.MANUAL_REVIEW));
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
    extractedOcr: { candidateName: 'Muhammad Usman', obtainedMarks: 940, totalMarks: 1100, rollNumber: '542198', isPass: true },
    portalVerification: { isVerified: true, boardMarks: 940, candidateName: 'Muhammad Usman' },
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
    extractedOcr: { candidateName: 'Muhammad Usman', obtainedMarks: 810, totalMarks: 1100, isPass: true }, // Mismatched marks: 810 vs 940
    portalVerification: { isVerified: false, boardMarks: 940, candidateName: 'Muhammad Usman' },
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
    extractedOcr: { candidateName: 'Muhammad Usman', obtainedMarks: 810, totalMarks: 1100, isPass: true },
    portalVerification: { isVerified: false, boardMarks: 940, candidateName: 'Muhammad Usman' },
    connection: mockDb,
  });

  assert.equal(decision.status, 'ESCALATED_MANUAL_REVIEW');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);

  const escalationUpdate = executedQueries.find((q) => q.query.includes('UPDATE adm_students') && q.params[0] === 'NEEDS_MANUAL_REVIEW');
  assert.ok(escalationUpdate, 'adm_students was updated to NEEDS_MANUAL_REVIEW');
});

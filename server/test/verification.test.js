import './setup-test-env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { IntakeTokenService } from '../src/modules/verification/services/intake-token.service.js';
import { DiscrepancyParserService } from '../src/modules/verification/services/discrepancy-parser.service.js';
import { StorageService } from '../src/modules/verification/services/storage/storage.service.js';
import { GeminiOcrService } from '../src/modules/verification/services/ocr/gemini-ocr.service.js';
import { BoardRegistryService } from '../src/modules/verification/services/scrapers/board-registry.service.js';
import {
  VerificationDecisionService,
  resolveBestVerifiedNames,
  formatProperName,
} from '../src/modules/verification/services/verification-decision.service.js';
import { AdmissionIntakeService } from '../src/modules/verification/services/admission-intake.service.js';
import { BoardSourceService } from '../src/modules/verification/services/board-source.service.js';
import { IdentityMatcherService } from '../src/modules/verification/services/identity-matcher.service.js';
import { ExpirationReminderService } from '../src/modules/verification/services/expiration-reminder.service.js';
import { GazetteSearchService } from '../src/modules/verification/services/gazette-search.service.js';
import {
  formatDocumentLabel,
  formatDocumentList,
  buildPortalUrl,
  formatUploadRequestMessage,
  formatDiscrepancyMessage,
  formatReminderMessage,
} from '../src/modules/verification/services/portal-message.service.js';
import { manualReviewActionSchema } from '../src/modules/verification/verification.schemas.js';
import {
  DOCUMENT_TYPES,
  DOCUMENT_VERIFICATION_STATUS,
  STUDENT_OVERALL_STATUS,
  TOKEN_CONFIG,
} from '../src/modules/verification/verification.constants.js';

test('IntakeTokenService: creates high-entropy 16-byte tokens and deterministic SHA-256 hashes', async () => {
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
  assert.equal(result.rawToken.length, TOKEN_CONFIG.BYTES * 2); // 16 bytes in hex = 32 hex characters
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

test('BoardSourceService: returns every gazette matching board, year, level, session, and part', async () => {
  const mockDb = {
    async execute() {
      return [[
        { id: 10, board_name: 'AJK BISE Mirpur', board_aliases: ['AJK BISE'], academic_year: '2022', exam_level: 'HSSC', exam_session: 'ANNUAL', exam_part: 'PART_II', source_type: 'GAZETTE', gazette_filename: 'annual-a.pdf' },
        { id: 11, board_name: 'AJK BISE Mirpur', board_aliases: ['AJK BISE'], academic_year: '2022', exam_level: 'HSSC', exam_session: 'ANNUAL', exam_part: 'PART_II', source_type: 'GAZETTE', gazette_filename: 'annual-b.pdf' },
        { id: 12, board_name: 'AJK BISE Mirpur', board_aliases: ['AJK BISE'], academic_year: '2022', exam_level: 'HSSC', exam_session: 'SECOND_ANNUAL', exam_part: 'PART_II', source_type: 'GAZETTE' },
        { id: 13, board_name: 'BISE Lahore', board_aliases: [], academic_year: '2022', exam_level: 'HSSC', exam_session: 'ANNUAL', exam_part: 'PART_II', source_type: 'GAZETTE' },
      ]];
    },
  };
  const matches = await BoardSourceService.findMatchingSources({
    boardName: 'AJK BISE', academicYear: '2022', examLevel: 'HSSC',
    examSession: 'ANNUAL', examPart: 'PART_II', sourceType: 'GAZETTE',
  }, mockDb);
  assert.deepEqual(matches.map((source) => source.id), [10, 11]);
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
      if (query.includes('SELECT doc_type FROM adm_student_documents')) {
        return [[
          { doc_type: DOCUMENT_TYPES.CNIC_FRONT },
          { doc_type: DOCUMENT_TYPES.FSC_MARKSHEET },
          { doc_type: DOCUMENT_TYPES.MATRIC_MARKSHEET },
        ]];
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
  assert.equal(unsupported.status, 'PORTAL_NOT_CONFIGURED');
});

test('BoardRegistryService: submits a public result form and extracts the matching result', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return new Response(`
        <form method="post" action="/result/search">
          <input type="hidden" name="csrf" value="token-1">
          <select name="examYear"><option value="2024">2024</option></select>
          <select name="examLevel"><option value="ssc">Matric SSC</option><option value="hssc">FSc HSSC</option></select>
          <select name="examSession"><option value="annual">First Annual Examination</option><option value="second">Second Annual Examination</option></select>
          <select name="examPart"><option value="part1">Part I</option><option value="part2">Part II</option></select>
          <input name="rollNumber" placeholder="Roll No">
          <button name="submit" value="Search">Search</button>
        </form>`, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    assert.equal(options.method, 'POST');
    assert.match(options.body, /rollNumber=123456/);
    assert.match(options.body, /csrf=token-1/);
    assert.match(options.body, /examLevel=hssc/);
    assert.match(options.body, /examSession=annual/);
    assert.match(options.body, /examPart=part2/);
    return new Response(`Roll No: 123456\nStudent Name: Ayesha Noor\nMarks Obtained: 900\nResult Status: PASS`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  const result = await BoardRegistryService.verifyCandidate({
    boardName: 'FBISE', rollNumber: '123456', examYear: '2024', examLevel: 'HSSC',
    examSession: 'ANNUAL', examPart: 'PART_II', candidateName: 'Ayesha Noor', sourceUrl: 'https://portal.fbise.edu.pk/result',
    portalAdapter: 'FBISE', fetchImpl, resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(requests.length, 2);
  assert.equal(result.status, 'PORTAL_MATCHED');
  assert.equal(result.boardMarks, 900);
  assert.equal(result.candidateName, 'Ayesha Noor');
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
      if (query.includes('verification_status IN')) {
        return [[
          { doc_type: 'FSC_MARKSHEET' },
          { doc_type: 'MATRIC_MARKSHEET' },
          { doc_type: 'CNIC_FRONT' },
          { doc_type: 'DOMICILE' },
        ]];
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

test('VerificationDecisionService: Condition A leaves status as UNDER_REVIEW if mandatory documents are still missing', async () => {
  const mockDb = {
    async execute(query) {
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
      if (query.includes('verification_status IN')) {
        // Only FSC is verified so far; Matric, CNIC, and Domicile are missing
        return [[{ doc_type: 'FSC_MARKSHEET' }]];
      }
      if (query.includes('verification_status NOT IN')) {
        return [[]]; // No other files currently pending in adm_student_documents
      }
      if (query.includes('FROM adm_student_documents WHERE id = ?')) {
        return [[{ storage_key: 'uploads/fsc.jpg', original_filename: 'fsc.jpg', file_mime: 'image/jpeg' }]];
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
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.UNDER_REVIEW);
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

test('IdentityMatcherService: computes Levenshtein distance and fuzzy name matching with confidence', () => {
  // Exact match
  const exact = IdentityMatcherService.compareNames('Sheikh Haseeb Ur Rehman', 'SHEIKH HASEEB UR REHMAN');
  assert.equal(exact.similarity, 100);
  assert.equal(exact.isMatch, true);

  // Hyphenation variation
  const hyphen = IdentityMatcherService.compareNames('Sheikh Haseeb Ur Rehman', 'SHEIKH HASEEB-UR-REHMAN');
  assert.ok(hyphen.similarity >= 95);
  assert.equal(hyphen.isMatch, true);
  assert.ok(hyphen.reason.includes('hyphenation'));

  // Given name subset of legal full name
  const subset = IdentityMatcherService.compareNames('haseeb', 'Sheikh Haseeb Ur Rehman');
  assert.ok(subset.similarity >= 85);
  assert.equal(subset.isMatch, true);

  // Cross check full dossier
  const cross = IdentityMatcherService.crossCheckStudentIdentity({
    student: { full_name: 'haseeb', father_name: 'Sheikh Abdul Hafeez' },
    documents: [
      { doc_type: 'CNIC_FRONT', extractedData: { candidateName: 'Sheikh Haseeb Ur Rehman', fatherName: 'Sheikh Abdul Hafeez' } },
      { doc_type: 'FSC_MARKSHEET', extractedData: { candidateName: 'SHEIKH HASEEB UR REHMAN', fatherName: 'SHEIKH ABDUL HAFEEZ' } },
      { doc_type: 'MATRIC_MARKSHEET', extractedData: { candidateName: 'SHEIKH HASEEB-UR-REHMAN', fatherName: 'SHEIKH ABDUL HAFEEZ' } },
    ],
  });

  assert.ok(cross.overallScore >= 95);
  assert.equal(cross.status, 'CONFIRMED_MATCH');
  assert.equal(cross.allMatched, true);
  assert.equal(cross.comparisons.length, 5);
});

test('ExpirationReminderService: scans expiring tokens and dispatches WhatsApp reminders with pending docs', async () => {
  const executedUpdates = [];
  const dispatchedJobs = [];
  const futureExpiry = new Date(Date.now() + 6 * 3600 * 1000); // 6 hours left

  const mockDb = {
    async query(query, params) {
      if (query.includes('FROM adm_intake_tokens t')) {
        return [[
          {
            token_id: 101,
            student_id: 201,
            raw_token: 'abc123tokenraw',
            allowed_doc_types: JSON.stringify(['CNIC_FRONT', 'FSC_MARKSHEET', 'MATRIC_MARKSHEET']),
            expires_at: futureExpiry,
            full_name: 'Sheikh Haseeb Ur Rehman',
            phone_normalized: '923179459856',
            overall_status: 'UNDER_REVIEW',
          },
          {
            token_id: 102,
            student_id: 202,
            raw_token: 'def456tokenraw',
            allowed_doc_types: JSON.stringify(['CNIC_FRONT']),
            expires_at: futureExpiry,
            full_name: 'Ali Khan',
            phone_normalized: '923001234567',
            overall_status: 'UNDER_REVIEW',
          },
        ]];
      }
      if (query.includes('FROM adm_student_documents')) {
        // Student 201 has CNIC_FRONT verified, FSC & Matric still pending
        // Student 202 has CNIC_FRONT verified (all required docs verified)
        return [[
          { student_id: 201, doc_type: 'CNIC_FRONT', verification_status: 'MATCHED' },
          { student_id: 202, doc_type: 'CNIC_FRONT', verification_status: 'MATCHED' },
        ]];
      }
      return [[], undefined];
    },
    async execute(query, params) {
      if (query.includes('INSERT INTO outbox_jobs')) {
        dispatchedJobs.push({ query, params });
        return [{ insertId: 999 }];
      }
      if (query.includes('UPDATE adm_intake_tokens SET reminder_sent_at')) {
        executedUpdates.push({ query, params });
        return [{ affectedRows: 1 }];
      }
      return [{}];
    },
  };

  const result = await ExpirationReminderService.processExpiringTokens({
    windowHours: 12,
    db: mockDb,
  });

  assert.equal(result.scanned, 2);
  assert.equal(result.reminded, 1); // Only Student 201 needed a reminder
  assert.equal(result.skipped, 1); // Student 202 already had all docs verified
  assert.equal(result.reminders.length, 1);

  const reminder = result.reminders[0];
  assert.equal(reminder.studentId, 201);
  assert.deepEqual(reminder.pendingDocs, ['FSC_MARKSHEET', 'MATRIC_MARKSHEET']);
  assert.equal(reminder.hoursLeft, 6);

  // Check dispatched outbox job
  assert.equal(dispatchedJobs.length, 1);
  const jobPayload = JSON.parse(dispatchedJobs[0].params[2]);
  assert.equal(jobPayload.recipientPhone, '923179459856');
  assert.ok(jobPayload.messageText.includes('Admissions Deadline Reminder'));
  assert.ok(jobPayload.messageText.includes('expires in *6 hours*'));
  assert.ok(jobPayload.messageText.includes('FSc / HSSC Intermediate Marksheet'));
  assert.ok(jobPayload.messageText.includes('abc123tokenraw'));

  // Both tokens should have reminder_sent_at updated so they are never double-processed
  assert.equal(executedUpdates.length, 2);
});

test('GazetteSearchService: extracts text from PDF buffer and automatically searches candidate by roll number', async () => {
  // Construct a realistic board gazette PDF buffer in memory with FlateDecode compressed streams
  const gazetteContent = [
    'BT /F1 12 Tf 72 712 Td (AJK BOARD OF INTERMEDIATE AND SECONDARY EDUCATION MIRPUR) Tj ET',
    'BT /F1 10 Tf 72 690 Td (ROLL NO) Tj 150 0 Td (CANDIDATE NAME) Tj 350 0 Td (MARKS) Tj 450 0 Td (REMARKS) Tj ET',
    'BT /F1 10 Tf 72 670 Td (535450) Tj 150 0 Td (MUHAMMAD USMAN) Tj 350 0 Td (680) Tj 450 0 Td (PASS) Tj ET',
    'BT /F1 10 Tf 72 650 Td (535453) Tj 150 0 Td [(SHEIKH ) 10 (HASEEB) 10 (-UR-REHMAN)] TJ 350 0 Td (740) Tj 450 0 Td (PASS) Tj ET',
    'BT /F1 10 Tf 72 630 Td (535455) Tj 150 0 Td (BILAL AHMED) Tj 350 0 Td (510) Tj 450 0 Td (PASS) Tj ET',
  ].join('\n');

  const compressedStream = zlib.deflateSync(Buffer.from(gazetteContent, 'latin1'));
  const testPdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page /Length ' + compressedStream.length + ' /Filter /FlateDecode >>\nstream\n'),
    compressedStream,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);

  // Test 1: extractTextFromPdfBuffer
  const extractedText = GazetteSearchService.extractTextFromPdfBuffer(testPdf);
  assert.ok(extractedText.includes('535453'));
  assert.ok(extractedText.includes('HASEEB'));
  assert.ok(extractedText.includes('740'));

  // Test 2: searchPdfTextForCandidate
  const matchResult = GazetteSearchService.searchPdfTextForCandidate({
    pdfText: extractedText,
    rollNumber: '535453',
    candidateName: 'Sheikh Haseeb Ur Rehman',
  });

  assert.ok(matchResult);
  assert.equal(matchResult.found, true);
  assert.equal(matchResult.rollNumber, '535453');
  assert.equal(matchResult.obtainedMarks, 740);
  assert.equal(matchResult.totalMarks, null);
  assert.equal(matchResult.isPass, true);
  assert.equal(matchResult.status, 'PASS');
  assert.equal(matchResult.automatable, true);
  assert.ok(matchResult.rawSnippet.includes('535453'));
  assert.ok(matchResult.rawSnippet.includes('740'));
  assert.ok(matchResult.nameMatchScore >= 90);

  const ambiguousRow = GazetteSearchService.searchPdfTextForCandidate({
    pdfText: '535453 SHEIKH HASEEB 535454 OTHER CANDIDATE 740 PASS',
    rollNumber: '535453',
    candidateName: 'Sheikh Haseeb',
  });
  assert.equal(ambiguousRow.automatable, false, 'two candidate rolls on one extracted row must be reviewed by staff');

  // Test 3: searchGazette directly using buffer
  const directSearchResult = await GazetteSearchService.searchGazette({
    fileBuffer: testPdf,
    rollNumber: '535453',
    candidateName: 'Sheikh Haseeb Ur Rehman',
    boardName: 'AJK BISE',
  });

  assert.equal(directSearchResult.found, true);
  assert.equal(directSearchResult.obtainedMarks, 740);

  // Test 4: Roll number not present in gazette
  const notFoundResult = await GazetteSearchService.searchGazette({
    fileBuffer: testPdf,
    rollNumber: '999999',
    candidateName: 'Non Existent',
    boardName: 'AJK BISE',
  });

  assert.equal(notFoundResult.found, false);
  assert.ok(notFoundResult.reason.includes('not found'));
});

test('AdmissionIntakeService.searchGazetteForDocument: performs on-demand gazette search and updates document', async () => {
  const gazetteContent = 'BT /F1 10 Tf (535453) Tj 150 0 Td (SHEIKH HASEEB-UR-REHMAN) Tj 350 0 Td (740) Tj ( PASS) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(gazetteContent, 'latin1'));
  const gazettePdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);

  let updatedDocData = null;
  const mockDb = {
    async query(query, params) {
      if (query.includes('FROM adm_student_documents d')) {
        return [[
          {
            id: 5,
            student_id: 1,
            doc_type: 'FSC_MARKSHEET',
            extracted_data: JSON.stringify({
              rollNumber: '535453',
              candidateName: 'Sheikh Haseeb Ur Rehman',
              boardName: 'AJK BISE',
              examYear: '2024',
              examLevel: 'HSSC',
              examSession: 'ANNUAL',
              examPart: 'PART_II',
              obtainedMarks: 740,
              totalMarks: 1100,
            }),
            portal_verification_data: null,
            full_name: 'Sheikh Haseeb Ur Rehman',
          },
        ]];
      }
      return [[], undefined];
    },
    async execute(query, params) {
      if (query.includes('FROM adm_board_sources')) {
        return [[
          {
            id: 10,
            board_name: 'AJK BISE Mirpur',
            board_aliases: JSON.stringify(['AJK BISE', 'Mirpur Board']),
            academic_year: '2024',
            source_type: 'GAZETTE',
            gazette_filename: 'AJKBISE_HSSC_2024.pdf',
            storage_provider: 'LOCAL_MOCK',
            storage_key: 'uploads/board-gazettes/ajkbise-mock.pdf',
          },
        ]];
      }
      if (query.includes('UPDATE adm_student_documents') && query.includes('portal_verification_data')) {
        updatedDocData = JSON.parse(params[0]);
        return [{ affectedRows: 1 }];
      }
      if (query.includes('INSERT INTO sys_audit_logs')) {
        return [{ insertId: 55 }];
      }
      return [{}];
    },
  };

  // Stub StorageService.getFileBuffer for this test
  const originalGetFileBuffer = StorageService.getFileBuffer;
  StorageService.getFileBuffer = async () => gazettePdf;

  try {
    const result = await AdmissionIntakeService.searchGazetteForDocument({
      documentId: 5,
      actorId: 'staff-uuid-1234',
      db: mockDb,
    });

    assert.equal(result.documentId, 5);
    assert.equal(result.studentId, 1);
    assert.equal(result.portalVerification.status, 'GAZETTE_VERIFIED');
    assert.equal(result.portalVerification.boardMarks, 740);
    assert.equal(result.portalVerification.isVerified, true);
    assert.ok(updatedDocData);
    assert.equal(updatedDocData.status, 'GAZETTE_VERIFIED');
    assert.equal(updatedDocData.boardMarks, 740);
  } finally {
    StorageService.getFileBuffer = originalGetFileBuffer;
  }
});

test('AdmissionIntakeService._buildCandidateTimeline: constructs chronologically sorted candidate lifecycle timeline', () => {
  const student = {
    id: 1,
    application_no: 'APP-2026-001',
    full_name: 'Sheikh Haseeb Ur Rehman',
    phone_normalized: '923179459856',
    fsc_obtained_marks: 740,
    created_at: '2026-11-06T10:00:00.000Z',
    verified_at: '2026-11-16T18:15:00.000Z',
    verified_by_name: 'Admissions Officer',
  };

  const tokens = [
    {
      token_id: 10,
      attempt_count: 1,
      allowedDocTypes: ['FSC_MARKSHEET', 'MATRIC_MARKSHEET'],
      created_at: '2026-11-06T10:05:00.000Z',
      reminder_sent_at: '2026-11-15T22:00:00.000Z',
      used_at: '2026-11-16T18:00:00.000Z',
      expires_at: '2026-11-16T22:00:00.000Z',
    },
  ];

  const documents = [
    {
      document_id: 5,
      doc_type: 'FSC_MARKSHEET',
      original_filename: 'fsc-transcript.pdf',
      file_size: 102400,
      created_at: '2026-11-16T18:01:00.000Z',
      extractedData: {
        candidateName: 'Sheikh Haseeb Ur Rehman',
        rollNumber: '535453',
        boardName: 'AJK BISE',
        obtainedMarks: 740,
        totalMarks: 1100,
      },
      portalVerificationData: {
        status: 'GAZETTE_VERIFIED',
        sourceType: 'GAZETTE',
        boardMarks: 740,
        gazetteFilename: 'AJKBISE_2024.pdf',
        candidateName: 'Sheikh Haseeb Ur Rehman',
      },
      reviewed_at: '2026-11-16T18:14:00.000Z',
      reviewed_by_name: 'Reviewer Staff',
      review_method: 'STAFF_DOCUMENT',
      review_notes: 'Confirmed with original board gazette',
    },
  ];

  const auditLogs = [
    {
      id: 88,
      action: 'OVERRIDE_MARKS',
      payload_before: { fsc_obtained_marks: 520 },
      payload_after: { fsc_obtained_marks: 740 },
      created_at: '2026-11-16T18:13:00.000Z',
    },
  ];

  const timeline = AdmissionIntakeService._buildCandidateTimeline({
    student,
    documents,
    tokens,
    auditLogs,
  });

  assert.ok(timeline.length >= 7);

  // Check chronological sort
  for (let i = 1; i < timeline.length; i++) {
    const prev = new Date(timeline[i - 1].timestamp).getTime();
    const curr = new Date(timeline[i].timestamp).getTime();
    assert.ok(prev <= curr, `Timeline event ${i - 1} (${timeline[i - 1].title}) must precede event ${i} (${timeline[i].title})`);
  }

  // Check specific milestones
  assert.equal(timeline[0].category, 'LEAD');
  assert.ok(timeline[0].title.includes('Lead imported'));

  const tokenCreate = timeline.find((e) => e.category === 'INTAKE_LINK');
  assert.ok(tokenCreate);
  assert.ok(tokenCreate.title.toLowerCase().includes('upload link generated'));

  const reminder = timeline.find((e) => e.category === 'REMINDER');
  assert.ok(reminder);
  assert.ok(reminder.title.includes('12-hour expiration reminder'));

  const upload = timeline.find((e) => e.category === 'UPLOAD');
  assert.ok(upload);
  assert.ok(upload.title.includes('FSC MARKSHEET'));

  const ocr = timeline.find((e) => e.category === 'OCR');
  assert.ok(ocr);
  assert.ok(ocr.title.includes('Neural OCR'));
  assert.ok(ocr.description.includes('740 / 1100'));

  const gazette = timeline.find((e) => e.category === 'GAZETTE');
  assert.ok(gazette);
  assert.ok(gazette.title.includes('Official Gazette match confirmed'));

  const override = timeline.find((e) => e.category === 'OVERRIDE');
  assert.ok(override);
  assert.ok(override.title.includes('Staff overrode candidate marks'));
  assert.ok(override.description.includes('520 -> 740'));

  const verified = timeline.find((e) => e.category === 'VERIFIED');
  assert.ok(verified);
  assert.ok(verified.title.includes('Candidate officially verified'));
});

test('PortalMessageService: formats clean, structured WhatsApp upload messages with short clickable link', () => {
  const url = buildPortalUrl('dfc903954dcdb0f30dced2e786c409d8');
  assert.ok(url.includes('/u/dfc903954dcdb0f30dced2e786c409d8'));
  assert.ok(url.length < 75); // Compact URL ensures no WhatsApp word-wrapping bugs

  // Test document label formatting (clean, emoji-free)
  assert.equal(formatDocumentLabel(DOCUMENT_TYPES.CNIC_FRONT), 'CNIC / B-Form (Front Side)');
  assert.equal(formatDocumentLabel(DOCUMENT_TYPES.FSC_MARKSHEET), 'FSc / HSSC Intermediate Marksheet');
  assert.equal(formatDocumentLabel(DOCUMENT_TYPES.MATRIC_MARKSHEET), 'Matric / SSC Marksheet');
  assert.equal(formatDocumentLabel('CUSTOM_DOC'), 'Custom Doc');

  // Test structured upload request message
  const message = formatUploadRequestMessage({
    studentName: 'Sheikh Haseeb Ur Rehman',
    allowedDocTypes: [
      DOCUMENT_TYPES.CNIC_FRONT,
      DOCUMENT_TYPES.FSC_MARKSHEET,
      DOCUMENT_TYPES.MATRIC_MARKSHEET,
    ],
    rawToken: 'dfc903954dcdb0f30dced2e786c409d8',
    expiresInHours: 48,
  });

  assert.ok(message.includes('DEPARTMENT OF SOFTWARE ENGINEERING'));
  assert.ok(message.includes('Dear *Sheikh Haseeb Ur Rehman*'));
  assert.ok(message.includes('- CNIC / B-Form (Front Side)'));
  assert.ok(message.includes('- FSc / HSSC Intermediate Marksheet'));
  assert.ok(message.includes('- Matric / SSC Marksheet'));
  assert.ok(message.includes('*Portal Link:*'));
  assert.ok(message.includes(url));
  assert.ok(message.includes('*Validity:* 48 hours'));

  // Ensure URL is on its own separate line for guaranteed WhatsApp linkifier detection
  const lines = message.split('\n');
  const urlLineIndex = lines.indexOf(url);
  assert.ok(urlLineIndex > 0);
  assert.equal(lines[urlLineIndex - 1], '*Portal Link:*');
  assert.equal(lines[urlLineIndex + 1], '');

  // Test discrepancy message
  const discrepancyMsg = formatDiscrepancyMessage({
    studentName: 'Ali Khan',
    docType: DOCUMENT_TYPES.FSC_MARKSHEET,
    discrepancyReason: 'Marksheet was blurry and serial number was unreadable.',
    uploadUrl: url,
    attemptCount: 2,
    maxAttempts: 3,
  });

  assert.ok(discrepancyMsg.includes('*Admissions Verification Notice*'));
  assert.ok(discrepancyMsg.includes('FSc / HSSC Intermediate Marksheet'));
  assert.ok(discrepancyMsg.includes('Marksheet was blurry and serial number was unreadable.'));
  assert.ok(discrepancyMsg.includes('Attempt 2 of 3'));
  assert.ok(discrepancyMsg.includes(url));

  // Test deadline reminder message
  const reminderMsg = formatReminderMessage({
    studentName: 'Sara Ahmed',
    pendingDocTypes: [DOCUMENT_TYPES.CNIC_FRONT],
    uploadUrl: url,
    hoursLeft: 6,
  });

  assert.ok(reminderMsg.includes('*Admissions Deadline Reminder*'));
  assert.ok(reminderMsg.includes('expires in *6 hours*'));
  assert.ok(reminderMsg.includes('- CNIC / B-Form (Front Side)'));
  assert.ok(reminderMsg.includes(url));
});

test('VerificationDecisionService: CNIC Front matches declared marketing CNIC and marksheet name -> MATCHED', async () => {
  const executedQueries = [];
  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 17,
          cnic: '82203-0585551-5',
          lead_cnic: '82203-0585551-5',
          full_name: 'SHEIKH HASEEB UR REHMAN',
          lead_name: 'SHEIKH HASEEB UR REHMAN',
          phone_normalized: '923179459856',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[{
          doc_type: 'FSC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB UR REHMAN' }),
        }, {
          doc_type: 'MATRIC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB-UR-REHMAN' }),
        }]];
      }
      if (query.includes('verification_status IN')) {
        return [[
          { doc_type: 'FSC_MARKSHEET' },
          { doc_type: 'MATRIC_MARKSHEET' },
          { doc_type: 'CNIC_FRONT' },
          { doc_type: 'DOMICILE' },
        ]];
      }
      if (query.includes('verification_status NOT IN')) {
        return [[]]; // All documents verified
      }
      if (query.includes('FROM adm_student_documents WHERE id = ?')) {
        return [[{ storage_key: 'uploads/cnic.jpg', original_filename: 'cnic.jpg', file_mime: 'image/jpeg' }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 25,
    studentId: 17,
    docType: DOCUMENT_TYPES.CNIC_FRONT,
    extractedOcr: {
      candidateName: 'SHEIKH HASEEB UR REHMAN',
      cnic: '8220305855515',
      fatherName: 'SHEIKH ABDUL HAFEEZ',
    },
    connection: mockDb,
  });

  assert.equal(decision.status, DOCUMENT_VERIFICATION_STATUS.MATCHED);
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.VERIFIED);
});

test('VerificationDecisionService: CNIC Front with mismatched CNIC number -> MANUAL_REVIEW with reason', async () => {
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 17,
          cnic: '82203-0585551-5',
          lead_cnic: '82203-0585551-5',
          full_name: 'SHEIKH HASEEB UR REHMAN',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[{
          doc_type: 'FSC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB UR REHMAN' }),
        }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 25,
    studentId: 17,
    docType: DOCUMENT_TYPES.CNIC_FRONT,
    extractedOcr: {
      candidateName: 'SHEIKH HASEEB UR REHMAN',
      cnic: '3740511111111', // Mismatched CNIC
    },
    connection: mockDb,
  });

  assert.equal(decision.status, 'ESCALATED_MANUAL_REVIEW');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);
  assert.ok(decision.discrepancyReason.includes('does not match applicant declared CNIC'));
});

test('VerificationDecisionService: CNIC Front with mismatched name -> MANUAL_REVIEW with reason', async () => {
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 17,
          cnic: '82203-0585551-5',
          lead_cnic: '82203-0585551-5',
          full_name: 'SHEIKH HASEEB UR REHMAN',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[{
          doc_type: 'FSC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB UR REHMAN' }),
        }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 25,
    studentId: 17,
    docType: DOCUMENT_TYPES.CNIC_FRONT,
    extractedOcr: {
      candidateName: 'Ali Ahmed Khan', // Mismatched name
      cnic: '8220305855515',
    },
    connection: mockDb,
  });

  assert.equal(decision.status, 'ESCALATED_MANUAL_REVIEW');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);
  assert.ok(decision.discrepancyReason.includes('does not match marksheet name'));
});

test('VerificationDecisionService: Domicile matches marksheet name and updates student city in DB', async () => {
  const executedQueries = [];
  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 17,
          lead_id: 31,
          cnic: '82203-0585551-5',
          full_name: 'SHEIKH HASEEB UR REHMAN',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[{
          doc_type: 'FSC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB UR REHMAN' }),
        }]];
      }
      if (query.includes('verification_status IN')) {
        return [[
          { doc_type: 'FSC_MARKSHEET' },
          { doc_type: 'MATRIC_MARKSHEET' },
          { doc_type: 'CNIC_FRONT' },
          { doc_type: 'DOMICILE' },
        ]];
      }
      if (query.includes('verification_status NOT IN')) {
        return [[]]; // All documents verified
      }
      if (query.includes('FROM adm_student_documents WHERE id = ?')) {
        return [[{ storage_key: 'uploads/domicile.jpg', original_filename: 'domicile.jpg', file_mime: 'image/jpeg' }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 26,
    studentId: 17,
    docType: DOCUMENT_TYPES.DOMICILE,
    extractedOcr: {
      candidateName: 'SHEIKH HASEEB-UR-REHMAN',
      district: 'Mirpur',
      city: 'Mirpur',
    },
    connection: mockDb,
  });

  assert.equal(decision.status, DOCUMENT_VERIFICATION_STATUS.MATCHED);
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.VERIFIED);

  const cityUpdate = executedQueries.find((q) => q.query.includes('UPDATE adm_students SET city = ? WHERE id = ?'));
  assert.ok(cityUpdate, 'adm_students.city was updated with extracted city');
  assert.equal(cityUpdate.params[0], 'Mirpur');
});

test('VerificationDecisionService: Domicile with mismatched name -> MANUAL_REVIEW with reason', async () => {
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 17,
          cnic: '82203-0585551-5',
          full_name: 'SHEIKH HASEEB UR REHMAN',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[{
          doc_type: 'FSC_MARKSHEET',
          extracted_data: JSON.stringify({ candidateName: 'SHEIKH HASEEB UR REHMAN' }),
        }]];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 26,
    studentId: 17,
    docType: DOCUMENT_TYPES.DOMICILE,
    extractedOcr: {
      candidateName: 'Zubair Tariq', // Mismatched name
      city: 'Mirpur',
    },
    connection: mockDb,
  });

  assert.equal(decision.status, 'ESCALATED_MANUAL_REVIEW');
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.NEEDS_MANUAL_REVIEW);
  assert.ok(decision.discrepancyReason.includes('does not match marksheet name'));
});

test('AdmissionIntakeService.createCandidateFromLead: mints token and dispatches WhatsApp notice for all 4 mandatory documents', async () => {
  const executedQueries = [];
  const outboxJobs = [];

  const mockConnection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students WHERE')) {
        return [[]]; // New candidate
      }
      if (query.includes('INSERT INTO adm_students')) {
        return [{ insertId: 77 }];
      }
      if (query.includes('UPDATE adm_students')) {
        return [{ affectedRows: 1 }];
      }
      if (query.includes('INSERT INTO adm_intake_tokens')) {
        return [{ insertId: 101 }];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({ query, params });
        return [{ insertId: 501 }];
      }
      return [[], undefined];
    },
  };

  const mockDb = {
    async getConnection() {
      return mockConnection;
    },
  };

  const leadPayload = {
    leadId: 12,
    fullName: 'Ali Raza',
    fatherName: 'Muhammad Raza',
    cnic: '82203-1234567-1',
    phoneNormalized: '923001234567',
    email: 'ali@example.com',
    city: 'Muzaffarabad',
    priorDegree: 'Pre-Engineering',
    fscMarks: 950,
  };

  const res = await AdmissionIntakeService.createCandidateFromLead(leadPayload, mockDb);
  assert.equal(res.studentId, 77);
  assert.equal(res.tokenId, 101);

  // Check intake token was minted for all 4 mandatory documents
  const tokenInsert = executedQueries.find((q) => q.query.includes('INSERT INTO adm_intake_tokens'));
  assert.ok(tokenInsert, 'Token was inserted');
  const allowedDocTypes = JSON.parse(tokenInsert.params[2]);
  assert.deepEqual(allowedDocTypes, [
    DOCUMENT_TYPES.FSC_MARKSHEET,
    DOCUMENT_TYPES.MATRIC_MARKSHEET,
    DOCUMENT_TYPES.CNIC_FRONT,
    DOCUMENT_TYPES.DOMICILE,
  ]);

  // Check WhatsApp outreach job was queued with all 4 documents listed
  assert.equal(outboxJobs.length, 1);
  const jobPayload = JSON.parse(outboxJobs[0].params[2]);
  assert.equal(jobPayload.recipientPhone, '923001234567');
  assert.ok(jobPayload.messageText.includes('FSc / HSSC Intermediate Marksheet'));
  assert.ok(jobPayload.messageText.includes('Matric / SSC Marksheet'));
  assert.ok(jobPayload.messageText.includes('CNIC / B-Form (Front Side)'));
  assert.ok(jobPayload.messageText.includes('State Domicile Certificate'));
  assert.ok(jobPayload.messageText.includes('Admissions Document Upload Request'));
});

test('AdmissionIntakeService.autoDispatchMissingDocumentLinks: batch request missing sends token and notice strictly for missing documents', async () => {
  const executedQueries = [];
  const outboxJobs = [];

  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[
          { id: 101, full_name: 'Zahra Bibi', phone_normalized: '923009876543', overall_status: 'UNDER_REVIEW' },
        ]];
      }
      if (query.includes('INSERT INTO adm_intake_tokens')) {
        return [{ insertId: 301 }];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({ query, params });
        return [{ insertId: 701 }];
      }
      return [[], undefined];
    },
    async query(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_student_documents')) {
        // Candidate 101 has uploaded FSC, Matric, and CNIC Front, but NOT Domicile!
        return [[
          { student_id: 101, doc_type: 'FSC_MARKSHEET', verification_status: 'MATCHED' },
          { student_id: 101, doc_type: 'MATRIC_MARKSHEET', verification_status: 'PORTAL_VERIFIED' },
          { student_id: 101, doc_type: 'CNIC_FRONT', verification_status: 'MATCHED' },
        ]];
      }
      return [[], undefined];
    },
  };

  const dispatchResult = await AdmissionIntakeService.autoDispatchMissingDocumentLinks(
    { actorId: 'admin-1', expiresInHours: 48 },
    mockDb
  );

  assert.equal(dispatchResult.dispatched, 1);
  assert.equal(dispatchResult.details.length, 1);
  assert.equal(dispatchResult.details[0].studentId, 101);
  // Specifically ONLY Domicile should be requested!
  assert.deepEqual(dispatchResult.details[0].missingDocs, [DOCUMENT_TYPES.DOMICILE]);

  // Check token was minted ONLY for DOMICILE
  const tokenInsert = executedQueries.find((q) => q.query.includes('INSERT INTO adm_intake_tokens'));
  assert.ok(tokenInsert, 'Token insert executed');
  const tokenAllowedDocs = JSON.parse(tokenInsert.params[2]);
  assert.deepEqual(tokenAllowedDocs, [DOCUMENT_TYPES.DOMICILE]);

  // Check WhatsApp outreach message requests strictly the missing State Domicile Certificate
  assert.equal(outboxJobs.length, 1);
  const outboxPayload = JSON.parse(outboxJobs[0].params[2]);
  assert.equal(outboxPayload.recipientPhone, '923009876543');
  assert.ok(outboxPayload.messageText.includes('State Domicile Certificate'));
  assert.ok(!outboxPayload.messageText.includes('FSc / HSSC Intermediate Marksheet'));
  assert.ok(!outboxPayload.messageText.includes('Matric / SSC Marksheet'));
  assert.ok(outboxPayload.messageText.includes('Missing Document Upload Request'));
});

test('AdmissionIntakeService.autoDispatchMissingDocumentLinks: skips candidates with all 4 mandatory documents verified', async () => {
  const executedQueries = [];
  const outboxJobs = [];

  const mockDb = {
    async execute(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_students s')) {
        return [[
          { id: 202, full_name: 'Hamza Tariq', phone_normalized: '923005556677', overall_status: 'UNDER_REVIEW' },
        ]];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({ query, params });
        return [{ insertId: 702 }];
      }
      return [[], undefined];
    },
    async query(query, params) {
      executedQueries.push({ query, params });
      if (query.includes('FROM adm_student_documents')) {
        // Candidate 202 has all 4 mandatory documents verified!
        return [[
          { student_id: 202, doc_type: 'FSC_MARKSHEET', verification_status: 'MATCHED' },
          { student_id: 202, doc_type: 'MATRIC_MARKSHEET', verification_status: 'PORTAL_VERIFIED' },
          { student_id: 202, doc_type: 'CNIC_FRONT', verification_status: 'MATCHED' },
          { student_id: 202, doc_type: 'DOMICILE', verification_status: 'MATCHED' },
        ]];
      }
      return [[], undefined];
    },
  };

  const dispatchResult = await AdmissionIntakeService.autoDispatchMissingDocumentLinks(
    { actorId: 'admin-1', expiresInHours: 48 },
    mockDb
  );

  assert.equal(dispatchResult.dispatched, 0);
  assert.equal(dispatchResult.details[0].status, 'SKIPPED_ALREADY_VERIFIED');
  assert.equal(outboxJobs.length, 0, 'No WhatsApp message dispatched for fully verified candidate');
});

test('AdmissionIntakeService.autoDispatchMissingDocumentLinks: includes rejected documents in missing documents batch request', async () => {
  const outboxJobs = [];

  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) {
        return [[
          { id: 303, full_name: 'Khadija Bibi', phone_normalized: '923008889900', overall_status: 'NEEDS_MANUAL_REVIEW' },
        ]];
      }
      if (query.includes('INSERT INTO adm_intake_tokens')) {
        return [{ insertId: 401 }];
      }
      if (query.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({ query, params });
        return [{ insertId: 703 }];
      }
      return [[], undefined];
    },
    async query(query) {
      if (query.includes('FROM adm_student_documents')) {
        // Candidate 303 has 3 verified, but CNIC Front was REJECTED by staff!
        return [[
          { student_id: 303, doc_type: 'FSC_MARKSHEET', verification_status: 'MATCHED' },
          { student_id: 303, doc_type: 'MATRIC_MARKSHEET', verification_status: 'PORTAL_VERIFIED' },
          { student_id: 303, doc_type: 'DOMICILE', verification_status: 'MATCHED' },
          { student_id: 303, doc_type: 'CNIC_FRONT', verification_status: 'REJECTED' },
        ]];
      }
      return [[], undefined];
    },
  };

  const dispatchResult = await AdmissionIntakeService.autoDispatchMissingDocumentLinks(
    { actorId: 'admin-1', expiresInHours: 48 },
    mockDb
  );

  assert.equal(dispatchResult.dispatched, 1);
  assert.deepEqual(dispatchResult.details[0].missingDocs, [DOCUMENT_TYPES.CNIC_FRONT]);
  assert.equal(outboxJobs.length, 1);
  const outboxPayload = JSON.parse(outboxJobs[0].params[2]);
  assert.ok(outboxPayload.messageText.includes('CNIC / B-Form (Front Side)'));
  assert.ok(!outboxPayload.messageText.includes('Domicile'));
});

test('AdmissionIntakeService.triggerAutoSeetLookup: dispatches CANDIDATE_VERIFIED outbox job when candidate is VERIFIED', async () => {
  const outboxJobs = [];
  const mockDb = {
    async execute(query, params) {
      if (query.includes('INSERT INTO outbox_jobs')) {
        outboxJobs.push({ query, params });
      }
      return [{ affectedRows: 1, insertId: 101 }];
    },
  };

  AdmissionIntakeService.triggerAutoSeetLookup(7080, mockDb);

  // Wait for the setImmediate microtask
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(outboxJobs.length, 1, 'Should dispatch one outbox job');
  assert.equal(outboxJobs[0].params[0], 'merit_processing');
  assert.equal(outboxJobs[0].params[1], 'CANDIDATE_VERIFIED');
  const payload = JSON.parse(outboxJobs[0].params[2]);
  assert.equal(payload.studentId, 7080);
});

test('resolveBestVerifiedNames: selects proper legal names and father names with CNIC priority and title casing', () => {
  const verifiedDocs = [
    {
      doc_type: 'DOMICILE',
      extracted_data: JSON.stringify({ candidateName: 'Usman', fatherName: 'Tariq' }),
    },
    {
      doc_type: 'MATRIC_MARKSHEET',
      extracted_data: JSON.stringify({ candidateName: 'Muhammad Usman', fatherName: 'Muhammad Tariq' }),
    },
    {
      doc_type: 'CNIC_FRONT',
      extracted_data: JSON.stringify({
        candidateName: 'MUHAMMAD USMAN TARIQ',
        fatherName: 'MUHAMMAD TARIQ KHAN',
      }),
    },
  ];

  const result = resolveBestVerifiedNames({ verifiedDocs });
  assert.equal(result.fullName, 'Muhammad Usman Tariq', 'Must extract full legal name in proper title case');
  assert.equal(result.fatherName, 'Muhammad Tariq Khan', 'Must extract father full legal name in proper title case');
});

test('VerificationDecisionService.syncVerifiedStudentNames: updates student and lead full_name and father_name to full legal names', async () => {
  const executedUpdates = [];
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_student_documents')) {
        return [[
          {
            doc_type: 'CNIC_FRONT',
            extracted_data: JSON.stringify({
              candidateName: 'HAMZA TARIQ KHAN',
              fatherName: 'TARIQ MAHMOOD KHAN',
            }),
            portal_verification_data: null,
          },
          {
            doc_type: 'FSC_MARKSHEET',
            extracted_data: JSON.stringify({
              candidateName: 'Hamza Tariq',
              fatherName: 'Tariq Mahmood',
            }),
            portal_verification_data: null,
          },
        ]];
      }
      if (query.includes('UPDATE adm_students')) {
        executedUpdates.push({ query, params });
        return [{ affectedRows: 1 }];
      }
      if (query.includes('UPDATE mkt_leads')) {
        executedUpdates.push({ query, params });
        return [{ affectedRows: 1 }];
      }
      return [[], undefined];
    },
  };

  const result = await VerificationDecisionService.syncVerifiedStudentNames({
    studentId: 99,
    connection: mockDb,
  });

  assert.equal(result.fullName, 'Hamza Tariq Khan');
  assert.equal(result.fatherName, 'Tariq Mahmood Khan');

  const studentUpdate = executedUpdates.find((u) => u.query.includes('UPDATE adm_students'));
  assert.ok(studentUpdate, 'Should execute UPDATE on adm_students');
  assert.equal(studentUpdate.params[0], 'Hamza Tariq Khan');
  assert.equal(studentUpdate.params[1], 'Tariq Mahmood Khan');
  assert.equal(studentUpdate.params[2], 99);

  const leadUpdate = executedUpdates.find((u) => u.query.includes('UPDATE mkt_leads'));
  assert.ok(leadUpdate, 'Should execute UPDATE on mkt_leads');
  assert.equal(leadUpdate.params[0], 'Hamza Tariq Khan');
  assert.equal(leadUpdate.params[1], 'Tariq Mahmood Khan');
  assert.equal(leadUpdate.params[2], 99);
});

test('VerificationDecisionService: evaluateDocumentVerification on verified CNIC updates student name and father name', async () => {
  const executedUpdates = [];
  const mockDb = {
    async execute(query, params) {
      if (query.includes('FROM adm_students s')) {
        return [[{
          id: 77,
          cnic: '82203-0585551-5',
          lead_cnic: '82203-0585551-5',
          full_name: 'haseeb',
          lead_name: 'haseeb',
          overall_status: 'UNDER_REVIEW',
          attempt_count: 1,
        }]];
      }
      if (query.includes('FROM adm_student_documents WHERE student_id = ? AND doc_type IN')) {
        return [[]];
      }
      if (query.includes('verification_status NOT IN')) {
        return [[]]; // All documents verified
      }
      if (query.includes('verification_status IN')) {
        return [[
          {
            doc_type: 'CNIC_FRONT',
            extracted_data: JSON.stringify({
              candidateName: 'Sheikh Haseeb Ur Rehman',
              fatherName: 'Sheikh Abdul Hafeez',
            }),
          },
          { doc_type: 'FSC_MARKSHEET' },
          { doc_type: 'MATRIC_MARKSHEET' },
          { doc_type: 'DOMICILE' },
        ]];
      }
      if (query.includes('FROM adm_student_documents WHERE id = ?')) {
        return [[{ storage_key: 'uploads/cnic.jpg', original_filename: 'cnic.jpg', file_mime: 'image/jpeg' }]];
      }
      if (query.includes('UPDATE adm_students') || query.includes('UPDATE mkt_leads')) {
        executedUpdates.push({ query, params });
        return [{ affectedRows: 1 }];
      }
      return [[], undefined];
    },
  };

  const decision = await VerificationDecisionService.evaluateDocumentVerification({
    documentId: 101,
    studentId: 77,
    docType: DOCUMENT_TYPES.CNIC_FRONT,
    extractedOcr: {
      candidateName: 'SHEIKH HASEEB UR REHMAN',
      fatherName: 'SHEIKH ABDUL HAFEEZ',
      cnic: '8220305855515',
    },
    connection: mockDb,
  });

  assert.equal(decision.status, DOCUMENT_VERIFICATION_STATUS.MATCHED);
  assert.equal(decision.overallStatus, STUDENT_OVERALL_STATUS.VERIFIED);

  const nameSync = executedUpdates.find((u) => u.query.includes('full_name = COALESCE(?, full_name)'));
  assert.ok(nameSync, 'Should update student full_name and father_name on verification');
  assert.equal(nameSync.params[0], 'Sheikh Haseeb Ur Rehman', 'Updated full_name must be official full name from document');
  assert.equal(nameSync.params[1], 'Sheikh Abdul Hafeez', 'Updated father_name must be official full name from document');
});

test('AdmissionIntakeService.syncExtractedDataToStudent: upgrades father_name to longer legal father name', async () => {
  const executedUpdates = [];
  const mockDb = {
    async execute(query, params) {
      executedUpdates.push({ query, params });
      return [{ affectedRows: 1 }];
    },
  };

  await AdmissionIntakeService.syncExtractedDataToStudent({
    studentId: 55,
    docType: DOCUMENT_TYPES.CNIC_FRONT,
    extracted: {
      candidateName: 'Muhammad Hamza Tariq',
      fatherName: 'Tariq Mahmood Khan',
      cnic: '3740512345671',
    },
    connection: mockDb,
  });

  const studentUpdate = executedUpdates.find((u) => u.query.includes('UPDATE adm_students'));
  assert.ok(studentUpdate, 'Should update adm_students');
  assert.ok(studentUpdate.query.includes('father_name = CASE'), 'Should conditionally upgrade father_name');
  assert.equal(studentUpdate.params[4], 'Tariq Mahmood Khan');
  assert.equal(studentUpdate.params[5], 'Tariq Mahmood Khan');
  assert.equal(studentUpdate.params[6], 'Tariq Mahmood Khan');
});

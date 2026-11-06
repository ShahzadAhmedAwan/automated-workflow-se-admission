import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const enabled = process.env.VERIFICATION_INTEGRATION === '1';

test('Verification MySQL lifecycle: review, queue paging, source gazette, and protected file handler', {
  skip: enabled ? false : 'Set VERIFICATION_INTEGRATION=1 and dedicated VERIFICATION_TEST_DB_* settings.',
  timeout: 60_000,
}, async () => {
  const required = [
    'VERIFICATION_TEST_DB_HOST',
    'VERIFICATION_TEST_DB_NAME',
    'VERIFICATION_TEST_DB_USER',
    'VERIFICATION_TEST_DB_PASSWORD',
    'VERIFICATION_TEST_STAFF_ID',
  ];
  const missing = required.filter((name) => !process.env[name]);
  assert.deepEqual(missing, [], `Missing integration settings: ${missing.join(', ')}`);
  assert.match(process.env.VERIFICATION_TEST_DB_NAME, /_test$/i, 'Refusing to run unless the database name ends with _test.');

  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:5173',
    DB_HOST: process.env.VERIFICATION_TEST_DB_HOST,
    DB_PORT: process.env.VERIFICATION_TEST_DB_PORT || '3306',
    DB_NAME: process.env.VERIFICATION_TEST_DB_NAME,
    DB_USER: process.env.VERIFICATION_TEST_DB_USER,
    DB_PASSWORD: process.env.VERIFICATION_TEST_DB_PASSWORD,
    DB_CONNECTION_LIMIT: '4',
    DB_SSL: process.env.VERIFICATION_TEST_DB_SSL || 'false',
    JWT_SECRET: randomBytes(48).toString('base64url'),
    R2_ACCOUNT_ID: '',
    R2_ACCESS_KEY_ID: '',
    R2_SECRET_ACCESS_KEY: '',
    R2_BUCKET_NAME: '',
  });

  const [{ pool }, { AdmissionIntakeService }, { BoardSourceService }, { StorageService }, { StaffVerificationController }] = await Promise.all([
    import('../src/core/db/pool.js'),
    import('../src/modules/verification/services/admission-intake.service.js'),
    import('../src/modules/verification/services/board-source.service.js'),
    import('../src/modules/verification/services/storage/storage.service.js'),
    import('../src/modules/verification/controllers/staff-verification.controller.js'),
  ]);

  const staffId = process.env.VERIFICATION_TEST_STAFF_ID;
  const tag = `VERIFY-TEST-${randomBytes(6).toString('hex')}`;
  const studentIds = [];
  const storageKeys = [];
  let boardSourceId = null;
  let boardStorageKey = null;

  try {
    const [staffRows] = await pool.execute(
      `SELECT u.id FROM sys_users u
         JOIN sys_user_roles ur ON ur.user_id = u.id
         JOIN sys_roles r ON r.id = ur.role_id
         JOIN sys_role_permissions rp ON rp.role_id = r.id
         JOIN sys_permissions p ON p.id = rp.permission_id
        WHERE u.id = ? AND u.is_active = TRUE AND p.name = 'verification.documents.review'`,
      [staffId]
    );
    assert.equal(staffRows.length, 1, 'Configured staff user must be active and have verification review permission.');

    const [staffSources] = await pool.execute(
      `SELECT p.name FROM sys_user_roles ur
         JOIN sys_roles r ON r.id = ur.role_id
         JOIN sys_role_permissions rp ON rp.role_id = r.id
         JOIN sys_permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?`,
      [staffId]
    );
    assert.ok(staffSources.some((row) => row.name === 'users.manage'), 'Test staff must be an administrator to configure a board source.');

    const [student] = await pool.execute(
      `INSERT INTO adm_students (application_no, full_name, phone_normalized, overall_status)
       VALUES (?, 'Verification Integration Candidate', '923001234567', 'UNDER_REVIEW')`,
      [`${tag}-REVIEW`]
    );
    const studentId = Number(student.insertId);
    studentIds.push(studentId);

    const pdf = Buffer.from('%PDF-1.4\nverification integration fixture\n%%EOF');
    const uploaded = await StorageService.uploadFile({
      buffer: pdf,
      originalFilename: 'verification-fixture.pdf',
      mimeType: 'application/pdf',
      studentId,
      docType: 'FSC_MARKSHEET',
    });
    storageKeys.push([uploaded.storageKey, uploaded.storageProvider]);
    const [document] = await pool.execute(
      `INSERT INTO adm_student_documents
         (student_id, doc_type, original_filename, file_mime, file_size, storage_provider, storage_key, verification_status)
       VALUES (?, 'FSC_MARKSHEET', 'verification-fixture.pdf', 'application/pdf', ?, ?, ?, 'MANUAL_REVIEW')`,
      [studentId, pdf.length, uploaded.storageProvider, uploaded.storageKey]
    );
    const documentId = Number(document.insertId);

    const response = {
      headers: null,
      body: null,
      set(headers) { this.headers = headers; return this; },
      send(body) { this.body = body; return this; },
    };
    let fileError;
    await StaffVerificationController.viewStudentDocument(
      { params: { studentId: String(studentId), documentId: String(documentId) } },
      response,
      (error) => { fileError = error; }
    );
    assert.equal(fileError, undefined);
    assert.equal(response.headers['Content-Type'], 'application/pdf');
    assert.deepEqual(response.body, pdf);

    const review = await AdmissionIntakeService.executeManualReviewAction({
      studentId,
      documentId,
      action: 'APPROVE',
      reviewMethod: 'STAFF_DOCUMENT',
      notes: 'Compared the original document.',
      actorId: staffId,
    });
    assert.equal(review.overall_status, 'VERIFIED');
    assert.equal(review.verified_by, staffId);

    const [[reviewRows]] = await Promise.all([
      pool.execute(`SELECT reviewed_by, review_method, review_notes FROM adm_student_documents WHERE id = ?`, [documentId]),
    ]);
    assert.equal(reviewRows[0].reviewed_by, staffId);
    assert.equal(reviewRows[0].review_method, 'STAFF_DOCUMENT');
    assert.equal(reviewRows[0].review_notes, 'Compared the original document.');

    const [archiveJobs] = await pool.execute(
      `SELECT id FROM outbox_jobs WHERE job_type = 'MIGRATE_GDRIVE'
         AND CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.documentId')) AS UNSIGNED) = ?`,
      [documentId]
    );
    assert.equal(archiveJobs.length, 1, 'Manual approval must enqueue document archival.');

    for (let index = 0; index < 26; index += 1) {
      const [queued] = await pool.execute(
        `INSERT INTO adm_students (application_no, full_name, phone_normalized, overall_status)
         VALUES (?, ?, ?, 'UNDER_REVIEW')`,
        [`${tag}-QUEUE-${index}`, `Queue Candidate ${index}`, `9230012${String(index).padStart(5, '0')}`]
      );
      studentIds.push(Number(queued.insertId));
    }
    const page = await AdmissionIntakeService.listManualReviewQueue({ status: 'UNDER_REVIEW', limit: 5, offset: 5 });
    assert.equal(page.items.length, 5);
    assert.ok(page.total >= 26);
    assert.equal(page.offset, 5);
    assert.equal(page.summary.VERIFIED >= 1, true);

    const boardName = `${tag} Board`;
    await BoardSourceService.save({
      boardName,
      boardAliases: [`${tag} Alias`],
      academicYear: '2099',
      sourceType: 'GAZETTE',
      file: { mimetype: 'application/pdf', originalname: `${tag}.pdf`, buffer: pdf },
      actorId: staffId,
    });
    const [sourceRows] = await pool.execute(
      `SELECT id, storage_provider, storage_key FROM adm_board_sources WHERE board_name = ? AND academic_year = '2099'`,
      [boardName]
    );
    assert.equal(sourceRows.length, 1);
    boardSourceId = Number(sourceRows[0].id);
    boardStorageKey = [sourceRows[0].storage_key, sourceRows[0].storage_provider];
    assert.equal((await BoardSourceService.findForBoard(`${tag} Alias`, '2099')).id, boardSourceId);

    const gazetteResponse = { headers: null, body: null, set(headers) { this.headers = headers; return this; }, send(body) { this.body = body; return this; } };
    let gazetteError;
    await StaffVerificationController.downloadBoardGazette(
      { params: { sourceId: String(boardSourceId) } },
      gazetteResponse,
      (error) => { gazetteError = error; }
    );
    assert.equal(gazetteError, undefined);
    assert.equal(gazetteResponse.headers['Content-Type'], 'application/pdf');
    assert.deepEqual(gazetteResponse.body, pdf);
  } finally {
    if (boardSourceId) await pool.execute(`DELETE FROM adm_board_sources WHERE id = ?`, [boardSourceId]);
    if (studentIds.length) {
      await pool.execute(
        `DELETE FROM outbox_jobs WHERE job_type = 'MIGRATE_GDRIVE'
          AND CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.studentId')) AS UNSIGNED) IN (${studentIds.map(() => '?').join(',')})`,
        studentIds
      );
      await pool.execute(
        `DELETE FROM sys_audit_logs WHERE entity_table = 'adm_students' AND entity_id IN (${studentIds.map(() => '?').join(',')})`,
        studentIds.map(String)
      );
      await pool.execute(`DELETE FROM adm_students WHERE id IN (${studentIds.map(() => '?').join(',')})`, studentIds);
    }
    for (const [key, provider] of [...storageKeys, ...(boardStorageKey ? [boardStorageKey] : [])]) {
      await StorageService.deleteFile(key, provider).catch(() => {});
    }
    await pool.end();
  }
});

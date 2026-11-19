import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_ORIGIN: 'http://localhost:5173',
  API_BASE_PATH: '/api/v1',
  TRUST_PROXY_HOPS: '0',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'se_admissions_test',
  DB_USER: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_CONNECTION_LIMIT: '2',
  DB_SSL: 'false',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  JWT_ISSUER: 'se-admissions-test',
  JWT_AUDIENCE: 'se-admissions-test-client',
  ACCESS_TOKEN_TTL_SECONDS: '300',
  REFRESH_TOKEN_TTL_DAYS: '1',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'strict',
});

const { parseAndPreviewLeads } = await import('../src/modules/marketing/services/csv-parser.service.js');
const { updateLeadSchema, listLeadsQuerySchema } = await import('../src/modules/marketing/marketing.schemas.js');
const { AdmissionIntakeService } = await import('../src/modules/verification/services/admission-intake.service.js');

test('Extended CSV Parser: parses all student profile fields including fatherName, cnic, email, marks, maths, program', async () => {
  const csvBuffer = Buffer.from(
    `fullName,phone,fatherName,cnic,email,city,priorDegree,fscMarks,hasMaths,eligibleFor\n` +
    `Muhammad Ali,03001234567,Tariq Mahmood,82101-1234567-1,ali.tariq@gmail.com,Mirpur,Pre-Engineering,850,Yes,Software Engineering\n` +
    `Ayesha Khan,03129876543,Muhammad Khan,82203-7654321-2,ayesha.k@yahoo.com,Islamabad,ICS,790,true,Software Engineering\n`
  );

  const mockDb = {
    async query() {
      return [[]];
    },
  };

  const preview = await parseAndPreviewLeads(csvBuffer, { dbConnection: mockDb });

  assert.equal(preview.totalRows, 2);
  assert.equal(preview.validCount, 2);
  assert.equal(preview.invalidPhoneCount, 0);

  const lead1 = preview.validLeads[0];
  assert.equal(lead1.fullName, 'Muhammad Ali');
  assert.equal(lead1.fatherName, 'Tariq Mahmood');
  assert.equal(lead1.phoneNormalized, '923001234567');
  assert.equal(lead1.cnic, '82101-1234567-1');
  assert.equal(lead1.email, 'ali.tariq@gmail.com');
  assert.equal(lead1.city, 'Mirpur');
  assert.equal(lead1.priorDegree, 'Pre-Engineering');
  assert.equal(lead1.fscMarks, 850);
  assert.equal(lead1.hasMaths, true);
  assert.equal(lead1.eligibleFor, 'Software Engineering');

  const lead2 = preview.validLeads[1];
  assert.equal(lead2.fullName, 'Ayesha Khan');
  assert.equal(lead2.hasMaths, true);
  assert.equal(lead2.fscMarks, 790);
});

test('Lead Schemas: updateLeadSchema & listLeadsQuerySchema strictly validate input', () => {
  const validUpdate = updateLeadSchema.parse({
    fullName: 'Ali Tariq Updated',
    fatherName: 'Tariq Mahmood',
    phone: '03001234567',
    cnic: '82101-1234567-1',
    email: 'ali.updated@gmail.com',
    city: 'Mirpur',
    fscMarks: 860,
    hasMaths: true,
    eligibleFor: 'Software Engineering',
    eligibilityStatus: 'ELIGIBLE',
    conversationState: 'QUALIFIED',
  });
  assert.equal(validUpdate.fullName, 'Ali Tariq Updated');
  assert.equal(validUpdate.eligibilityStatus, 'ELIGIBLE');

  const validQuery = listLeadsQuerySchema.parse({
    campaignId: '2',
    status: 'ELIGIBLE',
    search: 'Ali',
    limit: '25',
    offset: '0',
  });
  assert.equal(validQuery.campaignId, 2);
  assert.equal(validQuery.status, 'ELIGIBLE');
  assert.equal(validQuery.limit, 25);
});

test('Verification Queue: supports PROBLEMS_ONLY filter and detects candidate problem indicators', async () => {
  let capturedQuery = '';
  const mockDb = {
    async query(sql) {
      capturedQuery += '\n' + sql;
      if (sql.includes('SELECT s.id AS student_id')) {
        return [[
          {
            student_id: 101,
            lead_id: 202,
            application_no: 'APP-101',
            cnic: '82101-1111111-1',
            full_name: 'Test Problem Candidate',
            father_name: 'Father Name',
            phone_normalized: '923001112233',
            email: 'test@student.pk',
            city: 'Mirpur',
            prior_degree: 'ICS',
            eligible_for: 'SE',
            fsc_obtained_marks: 680,
            fsc_total_marks: 1100,
            matric_obtained_marks: 850,
            matric_total_marks: 1100,
            overall_status: 'NEEDS_MANUAL_REVIEW',
            discrepancy_notes: 'Marksheet marks do not match board record',
            created_at: new Date(),
            updated_at: new Date(),
            document_count: 3,
          },
        ]];
      }
      if (sql.includes('COUNT(*) AS total FROM adm_students s WHERE s.overall_status = \'NEEDS_MANUAL_REVIEW\'')) {
        return [[{ total: 1 }]];
      }
      if (sql.includes('COUNT(*) AS total FROM adm_students')) {
        return [[{ total: 1 }]];
      }
      if (sql.includes('GROUP BY overall_status')) {
        return [[{ overall_status: 'NEEDS_MANUAL_REVIEW', total: 1 }]];
      }
      if (sql.includes('SELECT student_id, doc_type, verification_status')) {
        return [[
          { student_id: 101, doc_type: 'FSC_MARKSHEET', verification_status: 'DISCREPANCY', review_notes: 'Mismatch' },
          { student_id: 101, doc_type: 'CNIC_FRONT', verification_status: 'MATCHED', review_notes: null },
        ]];
      }
      return [[]];
    },
  };

  const queue = await AdmissionIntakeService.listManualReviewQueue(
    { status: 'PROBLEMS_ONLY', limit: 25, offset: 0 },
    mockDb
  );

  assert.equal(queue.items.length, 1);
  const candidate = queue.items[0];
  assert.equal(candidate.studentId, 101);
  assert.equal(candidate.hasProblem, true);
  assert.equal(candidate.problemDocs.length, 1);
  assert.equal(candidate.problemDocs[0].type, 'FSC_MARKSHEET');
  assert.equal(queue.summary.PROBLEMS_ONLY, 1);
  assert.ok(capturedQuery.includes('s.overall_status = \'NEEDS_MANUAL_REVIEW\''));
});

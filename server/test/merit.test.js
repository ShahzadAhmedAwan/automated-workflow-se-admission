import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import './setup-test-env.js';

import { MeritPolicyService } from '../src/modules/merit/services/merit-policy.service.js';
import { MeritEngineService } from '../src/modules/merit/services/merit-engine.service.js';
import { MeritSnapshotService } from '../src/modules/merit/services/merit-snapshot.service.js';
import { SeetScraperService } from '../src/modules/merit/services/seet-scraper.service.js';
import { GazetteStreamParserService } from '../src/modules/merit/services/gazette-stream-parser.service.js';
import { DECISION_STATUS, TIE_BREAKER_TIER } from '../src/modules/merit/merit.constants.js';

test('MeritPolicyService: validates weights, enforces 100% total, and formats policy', async () => {
  const mockDb = {
    async query() {
      return [[
        {
          id: 1,
          name: 'B.Sc. Software Engineering - Fall 2026',
          version: '1.0',
          is_active: 1,
          program_code: 'SE',
          matric_weightage: 10.00,
          fsc_weightage: 40.00,
          entry_test_weightage: 50.00,
          tie_breaker_rules: JSON.stringify(['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE']),
          quota_definitions: JSON.stringify([
            { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
            { code: 'AJK_REGIONAL', title: 'AJK District Quota', seats: 15 },
          ]),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]];
    },
    async execute() {
      return [{ insertId: 2, affectedRows: 1 }];
    },
    async getConnection() {
      return {
        async query() { return [[]]; },
        async execute() { return [{ insertId: 2 }]; },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  const activePolicy = await MeritPolicyService.getActivePolicy('SE', mockDb);
  assert.equal(activePolicy.id, 1);
  assert.equal(activePolicy.matricWeightage, 10);
  assert.equal(activePolicy.fscWeightage, 40);
  assert.equal(activePolicy.entryTestWeightage, 50);
  assert.equal(activePolicy.matricWeightage + activePolicy.fscWeightage + activePolicy.entryTestWeightage, 100);
  assert.equal(activePolicy.quotaDefinitions.length, 2);

  // Rejection when weights don't sum to 100%
  await assert.rejects(
    async () => {
      await MeritPolicyService.updatePolicy(1, { matricWeightage: 20, fscWeightage: 40, entryTestWeightage: 50 }, null, mockDb);
    },
    { message: /The sum of weights must equal 100%/ }
  );
});

test('SeetScraperService: CNIC normalization and Cheerio HTML extraction', async () => {
  // 1. CNIC normalization
  const normalized = SeetScraperService.normalizeCnic('82101-1234567-1');
  assert.equal(normalized.digits, '8210112345671');
  assert.equal(normalized.formatted, '82101-1234567-1');

  const rawDigits = SeetScraperService.normalizeCnic('8210112345671');
  assert.equal(rawDigits.formatted, '82101-1234567-1');

  // 2. HTML parsing from SEET portal table format
  const samplePortalHtml = `
    <html>
      <body>
        <h2>State Engineering Entry Test (SEET) Results</h2>
        <table border="1">
          <tr>
            <th>Roll No</th>
            <th>Candidate Name</th>
            <th>Father Name</th>
            <th>CNIC</th>
            <th>Marks</th>
            <th>Status</th>
          </tr>
          <tr>
            <td>40921</td>
            <td>Sheikh Haseeb Ur Rehman</td>
            <td>Abdul Rehman</td>
            <td>82101-1234567-1</td>
            <td>78</td>
            <td>PASS</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const parsed = SeetScraperService.parseResultHtml(samplePortalHtml, '82101-1234567-1');
  assert.ok(parsed);
  assert.equal(parsed.rollNo, '40921');
  assert.equal(parsed.candidateName, 'Sheikh Haseeb Ur Rehman');
  assert.equal(parsed.marksObtained, 78);
  assert.equal(parsed.totalMarks, 100);
  assert.equal(parsed.percentage, 78);
  assert.equal(parsed.status, 'PASS');

  // 3. Multi-row table: ensures obtained marks is not overwritten by total marks (100)
  // and row CNIC must match target CNIC
  const sampleMustWalkinHtml = `
    <html>
      <body>
        <table class="table table-bordered table-stripped text-center walkintbl">
          <tr>
            <th>Sno.</th>
            <th>CNIC</th>
            <th>Roll No</th>
            <th>Applicant Name</th>
            <th>Applicant Father</th>
            <th>Obtained Marks</th>
            <th>Total Marks</th>
            <th>Status</th>
          </tr>
          <tr>
            <td>1</td>
            <td>8220341450169</td>
            <td>SEET26-P2-UAJK-19</td>
            <td>Muhammad Osaid Mir</td>
            <td>Fayyaz Ahmed Mir</td>
            <td>46</td>
            <td>100</td>
            <td>NoRec</td>
          </tr>
          <tr>
            <td>2</td>
            <td>8130209076722</td>
            <td>SEET26-P2-MUST-</td>
            <td>Amna Mahrukh</td>
            <td>Mirza Atif Ashiq</td>
            <td>43</td>
            <td>100</td>
            <td>NoRec</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  // Must extract true obtained marks (46), NOT total marks (100)
  const osaidParsed = SeetScraperService.parseResultHtml(sampleMustWalkinHtml, '82203-4145016-9');
  assert.ok(osaidParsed, 'Candidate should be found');
  assert.equal(osaidParsed.candidateName, 'Muhammad Osaid Mir');
  assert.equal(osaidParsed.marksObtained, 46, 'Marks obtained must be 46, NOT overwritten by 100');
  assert.equal(osaidParsed.totalMarks, 100);
  assert.equal(osaidParsed.rollNo, 'SEET26-P2-UAJK-19');
  assert.equal(osaidParsed.fatherName, 'Fayyaz Ahmed Mir');

  // Must NOT match a candidate who is not in the table
  const unrecordedParsed = SeetScraperService.parseResultHtml(sampleMustWalkinHtml, '82203-7924817-7');
  assert.equal(unrecordedParsed, null, 'Unmatched CNIC must return null, never another student');

  // 4. Vertical Key-Value Table Card format (as returned by SEET portal single search)
  const sampleVerticalCardHtml = `
    <table class="table table-bordered table-stripped walkintbl">
      <tr><th>Roll No</th><td>SEET26-P2-UAJK-19</td></tr>
      <tr><th>Applicant Name</th><td>Muhammad Osaid Mir</td></tr>
      <tr><th>Applicant Father</th><td>Fayyaz Ahmed Mir</td></tr>
      <tr><th>CNIC</th><td>8220341450169</td></tr>
      <tr><th>Obtained Marks</th><td>46</td></tr>
      <tr><th>Total Marks</th><td>100</td></tr>
      <tr><th>Status</th><td>NoRec</td></tr>
    </table>
  `;
  const verticalParsed = SeetScraperService.parseResultHtml(sampleVerticalCardHtml, '82203-4145016-9');
  assert.ok(verticalParsed);
  assert.equal(verticalParsed.marksObtained, 46);
  assert.equal(verticalParsed.totalMarks, 100);
  assert.equal(verticalParsed.candidateName, 'Muhammad Osaid Mir');

  // 5. Graceful offline fallback
  const offlineResult = await SeetScraperService.lookupByCnic('82101-1234567-1', {
    targetUrl: 'http://invalid-unreachable-seet-subdomain.local/test.php',
  });
  assert.equal(offlineResult.found, false);
  assert.ok(offlineResult.message.includes('Could not connect to SEET portal'));
});

test('SeetScraperService.saveResultAndBackfill: saves official result and links verified student', async () => {
  const executedStatements = [];
  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM adm_students')) {
        return [[{ id: 45, full_name: 'Sheikh Haseeb Ur Rehman', cnic: '82101-1234567-1', overall_status: 'VERIFIED' }]];
      }
      return [[]];
    },
    async execute(sql, params) {
      executedStatements.push({ sql, params });
      return [{ insertId: 78, affectedRows: 1 }];
    },
    async getConnection() {
      return {
        query: this.query,
        execute: this.execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  const saveRes = await SeetScraperService.saveResultAndBackfill(
    {
      cnic: '82101-1234567-1',
      rollNo: '40921',
      candidateName: 'Sheikh Haseeb Ur Rehman',
      marksObtained: 85,
      totalMarks: 100,
    },
    mockDb
  );

  assert.equal(saveRes.id, 78);
  assert.equal(saveRes.marksObtained, 85);
  assert.ok(saveRes.backfilledStudent);
  assert.equal(saveRes.backfilledStudent.id, 45);

  const studentUpdate = executedStatements.find((s) => s.sql.includes('UPDATE adm_students'));
  assert.ok(studentUpdate, 'Must update adm_students with test score');
  assert.equal(studentUpdate.params[0], 85);
});

test('GazetteStreamParserService: parses official gazette text records', () => {
  const sampleGazetteText = `
    BOARD OF INTERMEDIATE & SECONDARY EDUCATION MIRPUR (AJK)
    HSSC PART-II ANNUAL EXAMINATION 2026
    
    540101  MUHAMMAD USMAN     TARIQ AZIZ       920   PASS
    540102  82101-7654321-3    ZAINAB BIBI      875   PASS
    540103  HAMZA ALI          490   FAIL
  `;

  const records = GazetteStreamParserService.parseGazetteText(sampleGazetteText);
  assert.equal(records.length, 3);
  assert.equal(records[0].rollNo, '540101');
  assert.equal(records[0].candidateName, 'MUHAMMAD USMAN');
  assert.equal(records[0].marksObtained, 920);
  assert.equal(records[0].status, 'PASS');

  assert.equal(records[1].rollNo, '540102');
  assert.equal(records[1].cnic, '82101-7654321-3');
  assert.equal(records[1].candidateName, 'ZAINAB BIBI');
  assert.equal(records[1].marksObtained, 875);

  assert.equal(records[2].rollNo, '540103');
  assert.equal(records[2].status, 'FAIL');
});

test('MeritEngineService: calculates exact weighted aggregate formula', () => {
  const policy = {
    matricWeightage: 10,
    fscWeightage: 40,
    entryTestWeightage: 50,
  };

  const student = {
    id: 1,
    application_no: 'APP-2026-001',
    full_name: 'Ali Raza',
    matric_obtained_marks: 950,
    matric_total_marks: 1100,
    fsc_obtained_marks: 880,
    fsc_total_marks: 1100,
    entry_test_marks: 75,
    entry_test_total: 100,
    dob: '2005-04-12',
    quota_category: 'OPEN_MERIT',
  };

  // Expected:
  // Matric: (950 / 1100) * 10 = 8.63636
  // FSc: (880 / 1100) * 40 = 32.00000
  // Test: (75 / 100) * 50 = 37.50000
  // Total = 78.136%
  const result = MeritEngineService.calculateStudentAggregate(student, policy);
  assert.equal(result.aggregateScore, 78.136);
  assert.equal(result.studentId, 1);
});

test('MeritEngineService: Deterministic 4-Tier Tie-Breaking Protocol', () => {
  const policy = {
    matricWeightage: 10,
    fscWeightage: 40,
    entryTestWeightage: 50,
    quotaDefinitions: [{ code: 'OPEN_MERIT', seats: 5 }],
  };

  // Case 1: Identical Aggregate, but Candidate A has higher Entry Test score (Tier 1)
  const candidateA = {
    id: 101,
    full_name: 'Candidate A',
    matric_obtained_marks: 800, matric_total_marks: 1100,
    fsc_obtained_marks: 800, fsc_total_marks: 1100,
    entry_test_marks: 80, entry_test_total: 100,
    dob: '2005-01-01',
    quota_category: 'OPEN_MERIT',
    overall_status: 'VERIFIED',
  };
  const candidateB = {
    id: 102,
    full_name: 'Candidate B',
    matric_obtained_marks: 910, matric_total_marks: 1100,
    fsc_obtained_marks: 800, fsc_total_marks: 1100,
    entry_test_marks: 78, entry_test_total: 100,
    dob: '2004-01-01',
    quota_category: 'OPEN_MERIT',
    overall_status: 'VERIFIED',
  };

  const aggA = MeritEngineService.calculateStudentAggregate(candidateA, policy);
  const aggB = MeritEngineService.calculateStudentAggregate(candidateB, policy);

  // Force exact identical aggregate for tie-break testing
  aggA.aggregateScore = 80.000;
  aggB.aggregateScore = 80.000;
  aggA.entryTestScoreUsed = 85;
  aggB.entryTestScoreUsed = 80;

  const listTier1 = [aggB, aggA].sort(MeritEngineService.compareCandidates);
  assert.equal(listTier1[0].studentId, 101, 'Higher entry test must win');
  assert.equal(listTier1[0]._tieBreakLevel, TIE_BREAKER_TIER.ENTRY_TEST);

  // Case 2: Identical Aggregate & Test score, but Candidate C has higher FSc score (Tier 2)
  const aggC = { ...aggA, studentId: 103, entryTestScoreUsed: 80, fscScoreUsed: 920, _tieBreakLevel: null };
  const aggD = { ...aggB, studentId: 104, entryTestScoreUsed: 80, fscScoreUsed: 880, _tieBreakLevel: null };
  const listTier2 = [aggD, aggC].sort(MeritEngineService.compareCandidates);
  assert.equal(listTier2[0].studentId, 103, 'Higher FSc must win when test scores tie');
  assert.equal(listTier2[0]._tieBreakLevel, TIE_BREAKER_TIER.FSC);

  // Case 3: Identical Aggregate, Test & FSc, but Candidate E has higher Matric score (Tier 3)
  const aggE = { ...aggC, studentId: 105, fscScoreUsed: 900, matricScoreUsed: 950, _tieBreakLevel: null };
  const aggF = { ...aggD, studentId: 106, fscScoreUsed: 900, matricScoreUsed: 900, _tieBreakLevel: null };
  const listTier3 = [aggF, aggE].sort(MeritEngineService.compareCandidates);
  assert.equal(listTier3[0].studentId, 105, 'Higher Matric must win when FSc scores tie');
  assert.equal(listTier3[0]._tieBreakLevel, TIE_BREAKER_TIER.MATRIC);

  // Case 4: Identical Aggregate, Test, FSc & Matric, but Candidate G is older (Tier 4)
  const aggG = { ...aggE, studentId: 107, matricScoreUsed: 900, dob: new Date('2003-05-15'), _tieBreakLevel: null };
  const aggH = { ...aggF, studentId: 108, matricScoreUsed: 900, dob: new Date('2005-09-20'), _tieBreakLevel: null };
  const listTier4 = [aggH, aggG].sort(MeritEngineService.compareCandidates);
  assert.equal(listTier4[0].studentId, 107, 'Older candidate (earlier birth date) must win');
  assert.equal(listTier4[0]._tieBreakLevel, TIE_BREAKER_TIER.AGE);
});

test('MeritEngineService: Strict Gatekeeping (only VERIFIED candidates calculated)', async () => {
  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM mrt_policies')) {
        return [[{
          id: 1,
          name: 'SE Fall 2026',
          version: '1.0',
          is_active: 1,
          program_code: 'SE',
          matric_weightage: 10,
          fsc_weightage: 40,
          entry_test_weightage: 50,
          quota_definitions: JSON.stringify([{ code: 'OPEN_MERIT', seats: 10 }]),
        }]];
      }
      // Mock db strictly enforces WHERE overall_status = 'VERIFIED'
      assert.ok(sql.includes("overall_status = 'VERIFIED'"));
      return [[
        {
          id: 1,
          application_no: 'APP-01',
          full_name: 'Verified Student',
          matric_obtained_marks: 900, matric_total_marks: 1100,
          fsc_obtained_marks: 850, fsc_total_marks: 1100,
          entry_test_marks: 70, entry_test_total: 100,
          overall_status: 'VERIFIED',
        },
      ]];
    },
  };

  const calc = await MeritEngineService.runCalculation({ policyId: 1 }, mockDb);
  assert.equal(calc.totalCandidates, 1);
  assert.equal(calc.entries[0].fullName, 'Verified Student');
  assert.equal(calc.entries[0].decisionStatus, DECISION_STATUS.SELECTED);
});

test('MeritEngineService: candidate without SEET test or below 40% cutoff remains WAITLISTED', async () => {
  const pendingTestStudent = {
    id: 5,
    application_no: 'APP-05',
    full_name: 'Sheikh Haseeb Ur Rehman',
    matric_obtained_marks: 616,
    matric_total_marks: 1100,
    fsc_obtained_marks: 740,
    fsc_total_marks: 1100,
    entry_test_marks: 0,
    entry_test_total: 100,
    overall_status: 'VERIFIED',
  };

  const mockDbPending = {
    async query(sql) {
      if (sql.includes('FROM mrt_policies')) {
        return [[
          {
            id: 1,
            name: 'B.Sc. Software Engineering - Fall 2026',
            version: '1.0',
            is_active: 1,
            program_code: 'SE',
            matric_weightage: 10.00,
            fsc_weightage: 40.00,
            entry_test_weightage: 50.00,
            tie_breaker_rules: JSON.stringify(['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE']),
            quota_definitions: JSON.stringify([
              { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
            ]),
          },
        ]];
      }
      return [[pendingTestStudent]];
    },
  };

  const calcPending = await MeritEngineService.runCalculation({ policyId: 1 }, mockDbPending);
  assert.equal(calcPending.totalCandidates, 1);
  assert.equal(calcPending.selectedCount, 0);
  assert.equal(calcPending.waitlistedCount, 1);
  assert.equal(calcPending.entries[0].decisionStatus, DECISION_STATUS.WAITLISTED);
  assert.equal(calcPending.entries[0].ineligibilityReason, 'SEET entry test score pending / unrecorded');

  // Once SEET score is scraped (e.g. 65 / 100)
  const scrapedStudent = {
    ...pendingTestStudent,
    entry_test_marks: 65,
  };
  const mockDbScraped = {
    async query(sql) {
      if (sql.includes('FROM mrt_policies')) {
        return [[
          {
            id: 1,
            name: 'B.Sc. Software Engineering - Fall 2026',
            version: '1.0',
            is_active: 1,
            program_code: 'SE',
            matric_weightage: 10.00,
            fsc_weightage: 40.00,
            entry_test_weightage: 50.00,
            tie_breaker_rules: JSON.stringify(['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE']),
            quota_definitions: JSON.stringify([
              { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
            ]),
          },
        ]];
      }
      return [[scrapedStudent]];
    },
  };

  const calcScraped = await MeritEngineService.runCalculation({ policyId: 1 }, mockDbScraped);
  assert.equal(calcScraped.selectedCount, 1);
  assert.equal(calcScraped.waitlistedCount, 0);
  assert.equal(calcScraped.entries[0].decisionStatus, DECISION_STATUS.SELECTED);
  assert.ok(calcScraped.entries[0].aggregateScore >= 40.0);
});

test('MeritSnapshotService: generates snapshot, enforces Super Admin lock, and exports CSV', async () => {
  const mockEntries = [
    {
      studentId: 1,
      meritPosition: 1,
      applicationNo: 'APP-001',
      fullName: 'Ahmad Khan',
      fatherName: 'Tariq Khan',
      cnic: '82101-1111111-1',
      phoneNormalized: '923001111111',
      matricScoreUsed: 950, matricTotalUsed: 1100,
      fscScoreUsed: 920, fscTotalUsed: 1100,
      entryTestScoreUsed: 85, entryTestTotalUsed: 100,
      aggregateScore: 84.500,
      quotaCategory: 'OPEN_MERIT',
      decisionStatus: DECISION_STATUS.SELECTED,
      tieBreakLevel: 0,
      notificationSent: false,
    },
    {
      studentId: 2,
      meritPosition: 2,
      applicationNo: 'APP-002',
      fullName: 'Bilal Ahmed',
      fatherName: 'Mushtaq Ahmed',
      cnic: '82101-2222222-2',
      phoneNormalized: '923002222222',
      matricScoreUsed: 890, matricTotalUsed: 1100,
      fscScoreUsed: 870, fscTotalUsed: 1100,
      entryTestScoreUsed: 75, entryTestTotalUsed: 100,
      aggregateScore: 77.200,
      quotaCategory: 'OPEN_MERIT',
      decisionStatus: DECISION_STATUS.WAITLISTED,
      tieBreakLevel: 0,
      notificationSent: false,
    },
  ];

  let snapshotLocked = false;
  const dispatchedOutbox = [];

  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM mrt_snapshots')) {
        return [[
          {
            id: 10,
            policy_id: 1,
            snapshot_title: '1st Merit List - Fall 2026',
            iteration_number: 1,
            is_locked: snapshotLocked ? 1 : 0,
            total_candidates: 2,
            selected_count: 1,
            waitlisted_count: 1,
            policy_name: 'SE Policy',
            program_code: 'SE',
            matric_weightage: 10,
            fsc_weightage: 40,
            entry_test_weightage: 50,
          },
        ]];
      }
      if (sql.includes('FROM mrt_entries e')) {
        return [mockEntries.map((e) => ({
          ...e,
          id: e.studentId,
          snapshot_id: 10,
          student_id: e.studentId,
          merit_position: e.meritPosition,
          application_no: e.applicationNo,
          full_name: e.fullName,
          father_name: e.fatherName,
          phone_normalized: e.phoneNormalized,
          matric_score_used: e.matricScoreUsed,
          matric_total_used: e.matricTotalUsed,
          fsc_score_used: e.fscScoreUsed,
          fsc_total_used: e.fscTotalUsed,
          entry_test_score_used: e.entryTestScoreUsed,
          entry_test_total_used: e.entryTestTotalUsed,
          aggregate_score: e.aggregateScore,
          quota_category: e.quotaCategory,
          decision_status: e.decisionStatus,
          tie_break_level: e.tieBreakLevel,
          notification_sent: e.notificationSent ? 1 : 0,
        }))];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mrt_snapshots') && sql.includes('is_locked = TRUE')) {
        snapshotLocked = true;
      }
      if (sql.includes('UPDATE mrt_entries') && sql.includes('notification_sent = TRUE')) {
        mockEntries[0].notificationSent = true;
      }
      if (sql.includes('INSERT INTO outbox_jobs')) {
        dispatchedOutbox.push({
          type: params[1],
          payload: JSON.parse(params[2]),
        });
      }
      return [{ insertId: 10, affectedRows: 1 }];
    },
    async getConnection() {
      return {
        query: this.query,
        execute: this.execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  // 1. Get snapshot details
  const details = await MeritSnapshotService.getSnapshotDetails(10, mockDb);
  assert.equal(details.snapshot.id, 10);
  assert.equal(details.entries.length, 2);
  assert.equal(details.entries[0].meritPosition, 1);
  assert.equal(details.entries[0].decisionStatus, 'SELECTED');

  // 2. Lock Snapshot
  const lockRes = await MeritSnapshotService.lockSnapshot(10, 'super-admin-uuid', mockDb);
  assert.equal(lockRes.isLocked, true);
  assert.equal(snapshotLocked, true);

  // 3. Export CSV
  const csvExport = await MeritSnapshotService.exportSnapshotToCsv(10, mockDb);
  assert.ok(csvExport.filename.endsWith('.csv'));
  assert.ok(csvExport.csvContent.includes('Merit Position,Application No,Candidate Name'));
  assert.ok(csvExport.csvContent.includes('Ahmad Khan'));
  assert.ok(csvExport.csvContent.includes('84.500'));

  // 4. Dispatch WhatsApp Selection Notices
  const notifyRes = await MeritSnapshotService.dispatchSelectedNotifications(10, {}, mockDb);
  assert.equal(notifyRes.notifiedCount, 1);
  assert.equal(dispatchedOutbox.length, 1);
  assert.equal(dispatchedOutbox[0].payload.recipientPhone, '923001111111');
  assert.ok(dispatchedOutbox[0].payload.messageText.includes('Ahmad Khan'));
  assert.ok(dispatchedOutbox[0].payload.messageText.includes('Merit Position: *#1*'));
  assert.ok(dispatchedOutbox[0].payload.messageText.includes('84.500%'));
  // Ensure no emojis in the selection notice
  assert.doesNotMatch(dispatchedOutbox[0].payload.messageText, /[\u{1F300}-\u{1F6FF}]/u);

  // 5. Subsequent dispatch without forceResend reports no un-notified candidates
  const repeatRes = await MeritSnapshotService.dispatchSelectedNotifications(10, {}, mockDb);
  assert.equal(repeatRes.notifiedCount, 0);
  assert.ok(repeatRes.message.includes('No un-notified selected candidates'));

  // 6. Re-dispatch with forceResend: true successfully enqueues notice again
  const forceRes = await MeritSnapshotService.dispatchSelectedNotifications(10, { forceResend: true }, mockDb);
  assert.equal(forceRes.notifiedCount, 1);
  assert.equal(dispatchedOutbox.length, 2);

  // 7. Single student dispatch with studentId: 1
  const singleRes = await MeritSnapshotService.dispatchSelectedNotifications(10, { studentId: 1, forceResend: true }, mockDb);
  assert.equal(singleRes.notifiedCount, 1);
  assert.equal(dispatchedOutbox.length, 3);
});

test('GazetteStreamParserService: parses SEET entrance test gazette format with alphanumeric roll and CNIC', () => {
  const seetGazetteText = `
    UNIVERSITY OF AZAD JAMMU & KASHMIR
    FACULTY OF ENGINEERING & TECHNOLOGY
    STATE ENGINEERING ENTRY TEST (SEET 2026) OFFICIAL GAZETTE
    
    1. SEET26-P2-UAJK-19  82203-4145016-9  MUHAMMAD OSAID MIR  FAYYAZ AHMED MIR  46  PASS
    2. SEET26-P2-UAJK-20  82101-1234567-1  SHEIKH HASEEB UR REHMAN  ABDUL REHMAN  85  PASS
    3. 40921  82101-7654321-3  ZAINAB BIBI  68  PASS
    4. 40922  82101-9999999-9  HAMZA TARIQ  32  FAIL
  `;

  const records = GazetteStreamParserService.parseGazetteText(seetGazetteText);
  assert.equal(records.length, 4);

  // Alphanumeric SEET roll
  assert.equal(records[0].rollNo, 'SEET26-P2-UAJK-19');
  assert.equal(records[0].cnic, '82203-4145016-9');
  assert.equal(records[0].candidateName, 'MUHAMMAD OSAID MIR');
  assert.equal(records[0].fatherName, 'FAYYAZ AHMED MIR');
  assert.equal(records[0].marksObtained, 46);
  assert.equal(records[0].totalMarks, 100);
  assert.equal(records[0].status, 'PASS');

  // Second SEET candidate
  assert.equal(records[1].rollNo, 'SEET26-P2-UAJK-20');
  assert.equal(records[1].cnic, '82101-1234567-1');
  assert.equal(records[1].marksObtained, 85);
  assert.equal(records[1].totalMarks, 100);
  assert.equal(records[1].status, 'PASS');

  // Numeric roll
  assert.equal(records[2].rollNo, '40921');
  assert.equal(records[2].marksObtained, 68);
  assert.equal(records[2].totalMarks, 100);
  assert.equal(records[2].status, 'PASS');

  // Candidate below 40% threshold
  assert.equal(records[3].rollNo, '40922');
  assert.equal(records[3].marksObtained, 32);
  assert.equal(records[3].totalMarks, 100);
  assert.equal(records[3].status, 'FAIL');
});

test('GazetteStreamParserService.processGazetteBuffer: searches and backfills students with pending SEET scores', async () => {
  // Construct a realistic PDF buffer in memory containing SEET test gazette lines
  const gazetteContent = [
    'BT /F1 12 Tf (UNIVERSITY OF AZAD JAMMU & KASHMIR - SEET 2026 GAZETTE) Tj ET',
    'BT /F1 10 Tf (SEET26-P2-UAJK-19) Tj ( 82203-4145016-9 ) Tj (MUHAMMAD OSAID MIR) Tj ( 46 ) Tj (PASS) Tj ET',
    'BT /F1 10 Tf (SEET26-P2-UAJK-20) Tj ( 82101-1234567-1 ) Tj (SHEIKH HASEEB UR REHMAN) Tj ( 85 ) Tj (PASS) Tj ET',
  ].join('\n');

  const compressedStream = zlib.deflateSync(Buffer.from(gazetteContent, 'latin1'));
  const testPdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page /Length ' + compressedStream.length + ' /Filter /FlateDecode >>\nstream\n'),
    compressedStream,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);

  const pendingStudentsList = [
    {
      id: 101,
      application_no: 'APP-2026-101',
      full_name: 'Muhammad Osaid Mir',
      father_name: 'Fayyaz Ahmed Mir',
      cnic: '82203-4145016-9',
      fsc_roll_no: '540101',
      entry_test_roll_no: 'SEET26-P2-UAJK-19',
      entry_test_marks: null, // PENDING
      overall_status: 'VERIFIED',
    },
    {
      id: 102,
      application_no: 'APP-2026-102',
      full_name: 'Sheikh Haseeb Ur Rehman',
      father_name: 'Abdul Rehman',
      cnic: '82101-1234567-1',
      fsc_roll_no: '540102',
      entry_test_roll_no: null,
      entry_test_marks: 0, // PENDING
      overall_status: 'VERIFIED',
    },
    {
      id: 103,
      application_no: 'APP-2026-103',
      full_name: 'Kashif Ali',
      father_name: 'Muhammad Ali',
      cnic: '82301-5555555-5',
      fsc_roll_no: '540103',
      entry_test_roll_no: null,
      entry_test_marks: null, // PENDING - NOT in this gazette
      overall_status: 'VERIFIED',
    },
  ];

  const executedUpdates = [];
  const insertedOfficial = [];

  const mockDb = {
    async query(sql) {
      if (sql.includes('remainingCount')) {
        return [[{ remainingCount: 1 }]];
      }
      if (sql.includes('FROM adm_students')) {
        return [pendingStudentsList];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('INSERT INTO mrt_official_results')) {
        insertedOfficial.push(params);
        return [{ insertId: insertedOfficial.length }];
      }
      if (sql.includes('UPDATE adm_students')) {
        executedUpdates.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      return [[]];
    },
    async getConnection() {
      return {
        query: mockDb.query,
        execute: mockDb.execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  const result = await GazetteStreamParserService.processGazetteBuffer(
    testPdf,
    { boardOrTestName: 'UAJK_SEET_TEST', academicYear: '2026' },
    mockDb
  );

  assert.equal(result.totalExtracted, 2);
  assert.equal(result.matchedStudents, 2);
  assert.equal(result.matchedPendingStudents, 2);
  assert.equal(result.remainingPending, 1);
  assert.equal(result.matchedDetails.length, 2);

  // Student 101 update assertions
  const update101 = executedUpdates.find((u) => u.params[2] === 101);
  assert.ok(update101, 'Student 101 should be updated');
  assert.equal(update101.params[0], 46); // entry_test_marks
  assert.equal(update101.params[1], 'SEET26-P2-UAJK-19'); // entry_test_roll_no

  // Student 102 update assertions
  const update102 = executedUpdates.find((u) => u.params[2] === 102);
  assert.ok(update102, 'Student 102 should be updated');
  assert.equal(update102.params[0], 85); // entry_test_marks
  assert.equal(update102.params[1], 'SEET26-P2-UAJK-20'); // entry_test_roll_no

  // Student 103 was not in the gazette and must NOT be updated
  const update103 = executedUpdates.find((u) => u.params[2] === 103);
  assert.equal(update103, undefined, 'Student 103 was not in gazette and must remain pending');
});

test('SeetScraperService: checks multiple phases (SEET26-P1, SEET26-P2) and leaves unfound students without fabricating marks', async () => {
  const updatedStudents = [];
  const insertedResults = [];

  const mockDb = {
    async query(sql) {
      if (sql.includes('FROM adm_students')) {
        return [[{ id: 99, full_name: 'Unregistered Candidate', cnic: '82203-9999999-9', entry_test_marks: null }]];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE adm_students')) {
        updatedStudents.push(params);
      }
      if (sql.includes('INSERT INTO mrt_official_results')) {
        insertedResults.push(params);
      }
      return [{ insertId: 1, affectedRows: 1 }];
    },
  };

  const originalLookup = SeetScraperService.lookupByCnic;
  const queriedPhases = [];
  SeetScraperService.lookupByCnic = async (cnic, opts) => {
    queriedPhases.push(...(opts.phases || [{ id: '11', label: 'SEET26-P2' }, { id: '10', label: 'SEET26-P1' }]));
    return {
      found: false,
      source: 'LIVE_PORTAL',
      message: 'No SEET test record found across SEET26-P1 and SEET26-P2',
      cnic,
    };
  };

  try {
    const syncRes = await SeetScraperService.syncVerifiedCandidates({}, mockDb);
    assert.equal(syncRes.totalCandidates, 1);
    assert.equal(syncRes.matched, 0);
    assert.equal(syncRes.unmatched, 1);
    // CRITICAL: Ensure NO score was fabricated or written to adm_students or mrt_official_results!
    assert.equal(updatedStudents.length, 0, 'Must NOT write any score to adm_students for unfound student');
    assert.equal(insertedResults.length, 0, 'Must NOT write any official result for unfound student');
  } finally {
    SeetScraperService.lookupByCnic = originalLookup;
  }
});

test('SeetScraperService: dynamic phase auto-discovery strictly enforces 2 phases (P1 and P2) for current year and rejects P3 or expired years', async () => {
  // Test 1: DOM parsing from live university portal HTML format (with unquoted value= and trailing dashes)
  // Rejects SEET26-P3 and keeps strictly the 2 active test phases: SEET26-P2 and SEET26-P1
  const portalHtml = `
    <div class="col-md-4">
      <select style='width:120px !important;padding:0px;' class="form-control" name="jadmid" title='Select Admission Phase here'>
        <option value=-1 Selected>Select Phase</option>
        <option value=12>SEET26-P3-</option>
        <option value=11>SEET26-P2-</option>
        <option value=10>SEET26-P1-</option>
      </select>
    </div>
  `;
  const discovered = SeetScraperService.extractPhasesFromHtml(portalHtml);
  assert.equal(discovered.length, 2, 'Must strictly return exactly 2 phases (P1 and P2), filtering out P3');
  assert.deepEqual(discovered[0], { id: '11', label: 'SEET26-P2' });
  assert.deepEqual(discovered[1], { id: '10', label: 'SEET26-P1' });

  // Test 2: DOM parsing with future academic year phases (e.g., SEET27 for next year)
  // Rejects P3, excludes previous expired year (SEET26), and keeps active year (SEET27-P2, SEET27-P1)
  const futureHtml = `
    <select name="jadmid">
      <option value="-1">Choose Admission Phase</option>
      <option value="15">SEET27-P3</option>
      <option value="14">SEET27-P2</option>
      <option value="13">SEET27-P1</option>
      <option value="11">SEET26-P2</option>
      <option value="10">SEET26-P1</option>
    </select>
  `;
  const futurePhases = SeetScraperService.extractPhasesFromHtml(futureHtml);
  assert.equal(futurePhases.length, 2, 'Must strictly extract the 2 active phases for next year 2027');
  assert.deepEqual(futurePhases[0], { id: '14', label: 'SEET27-P2' });
  assert.deepEqual(futurePhases[1], { id: '13', label: 'SEET27-P1' });

  // Test 3: Invalid or empty HTML returns empty array gracefully
  assert.deepEqual(SeetScraperService.extractPhasesFromHtml(''), []);
  assert.deepEqual(SeetScraperService.extractPhasesFromHtml('<div>No select here</div>'), []);

  // Test 4: Dynamic academic year fallback calculation for next year (2027) strictly returns 2 phases
  const calculated2027 = await SeetScraperService.getOrDiscoverPhases({
    useSimulation: true,
    academicYear: 2027,
    forceRefresh: true,
  });
  assert.equal(calculated2027.length, 2);
  assert.deepEqual(calculated2027, [
    { id: '11', label: 'SEET27-P2' },
    { id: '10', label: 'SEET27-P1' },
  ]);

  // Test 5: Custom environment variable override
  const prevEnv = process.env.SEET_PORTAL_PHASES;
  try {
    process.env.SEET_PORTAL_PHASES = 'SEET27-P1:13,SEET27-P2:14';
    const envPhases = await SeetScraperService.getOrDiscoverPhases({
      useSimulation: true,
      forceRefresh: true,
    });
    assert.deepEqual(envPhases, [
      { id: '13', label: 'SEET27-P1' },
      { id: '14', label: 'SEET27-P2' },
    ]);
  } finally {
    if (prevEnv !== undefined) {
      process.env.SEET_PORTAL_PHASES = prevEnv;
    } else {
      delete process.env.SEET_PORTAL_PHASES;
    }
  }

  // Test 6: Result HTML parsing extracts true candidate name, roll number, and true phase (SEET26-P2)
  const resultTableHtml = `
    <table class="table table-bordered table-stripped">
      <thead>
        <tr>
          <th>Admission Phase</th>
          <th>Applicant#</th>
          <th>Application#</th>
          <th>RollNo</th>
          <th>Name</th>
          <th>Father Name</th>
          <th>CNIC </th>
          <th>Total Marks</th>
          <th>Obtained Marks</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>SEET 2026 P2</td>
          <td>7080</td>
          <td>6850</td>
          <td>SEET26-P2-UAJK-12</td>
          <td>Ibtisam Azam</td>
          <td>Raja Muhammad Azam</td>
          <td>8270103594165</td>
          <td>100</td>
          <td>55</td>
          <td>Pass</td>
        </tr>
      </tbody>
    </table>
  `;
  const parsedCandidate = SeetScraperService.parseResultHtml(resultTableHtml, '82701-0359416-5');
  assert.ok(parsedCandidate, 'Should parse candidate record');
  assert.equal(parsedCandidate.candidateName, 'Ibtisam Azam', 'Must extract actual Name, NOT Applicant#');
  assert.equal(parsedCandidate.fatherName, 'Raja Muhammad Azam');
  assert.equal(parsedCandidate.rollNo, 'SEET26-P2-UAJK-12');
  assert.equal(parsedCandidate.phase, 'SEET26-P2', 'Must extract exact phase from table/rollNo');
  assert.equal(parsedCandidate.marksObtained, 55);
  assert.equal(parsedCandidate.totalMarks, 100);
  assert.equal(parsedCandidate.status, 'PASS');
});

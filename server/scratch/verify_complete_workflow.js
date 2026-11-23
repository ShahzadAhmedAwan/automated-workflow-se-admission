import { config } from '../src/core/config/env.js';
import { pool } from '../src/core/db/pool.js';
import { DiscrepancyParserService } from '../src/modules/verification/services/discrepancy-parser.service.js';
import { AdmissionIntakeService } from '../src/modules/verification/services/admission-intake.service.js';
import { SeetScraperService } from '../src/modules/merit/services/seet-scraper.service.js';
import { MeritSnapshotService } from '../src/modules/merit/services/merit-snapshot.service.js';
import { MeritEngineService } from '../src/modules/merit/services/merit-engine.service.js';
import { parseAndPreviewLeads } from '../src/modules/marketing/services/csv-parser.service.js';
import { CampaignService } from '../src/modules/marketing/services/campaign.service.js';
import assert from 'node:assert/strict';

async function runEndToEndVerification() {
  console.log('================================================================');
  console.log('🔍 CRITICAL END-TO-END WORKFLOW VERIFICATION');
  console.log('📱 Testing with Real Number: 031794598956 (Normalized: 9231794598956)');
  console.log('================================================================\n');

  const connection = await pool.getConnection();

  try {
    const testPhoneRaw = '031794598956';
    const testPhoneNormalized = '9231794598956';
    const testCnic = '82203-9459895-6';
    const testName = 'Sheikh Haseeb';

    // 0. Clean up previous test state for clean verification
    console.log('🧹 [Step 0] Cleaning prior test records for phone & CNIC...');
    const [existingStudents] = await connection.query(
      `SELECT id FROM adm_students WHERE phone_normalized = ? OR cnic = ?`,
      [testPhoneNormalized, testCnic]
    );
    for (const s of existingStudents) {
      await connection.query(`DELETE FROM mrt_entries WHERE student_id = ?`, [s.id]);
      await connection.query(`DELETE FROM adm_student_documents WHERE student_id = ?`, [s.id]);
      await connection.query(`DELETE FROM adm_intake_tokens WHERE student_id = ?`, [s.id]);
      await connection.query(`DELETE FROM adm_students WHERE id = ?`, [s.id]);
    }
    await connection.query(`DELETE FROM mrt_official_results WHERE cnic = ?`, [testCnic]);
    await connection.query(`DELETE FROM mkt_leads WHERE phone_normalized = ?`, [testPhoneNormalized]);
    console.log('   ✓ Prior test records cleared.');

    // 1. PHASE 1: Marketing CSV Upload & Lead Auto-Qualification
    console.log('\n📄 [Step 1] Testing Marketing Module CSV Pipeline with real phone 031794598956...');
    const mktCsvContent = 
`Full Name,Phone Number,CNIC,Father Name,City,Prior Degree,FSc Marks,Has Maths,Desired Program
${testName},${testPhoneRaw},${testCnic},Tariq Mehmood,Muzaffarabad,FSc Pre-Engineering,940,Yes,Software Engineering
`;
    const mktBuffer = Buffer.from(mktCsvContent, 'utf-8');
    const mktPreview = await parseAndPreviewLeads(mktBuffer, { dbConnection: pool });
    assert.equal(mktPreview.validLeads.length, 1);
    assert.equal(mktPreview.validLeads[0].phoneNormalized, testPhoneNormalized, 'Marketing preview must normalize to 9231794598956');
    console.log(`   ✓ Marketing preview parsed cleanly. Phone: ${mktPreview.validLeads[0].phoneNormalized}, Marks: ${mktPreview.validLeads[0].fscMarks}`);

    // Fetch or create an active campaign
    const [campaignRows] = await pool.query(`SELECT id FROM mkt_campaigns LIMIT 1`);
    let testCampaignId = campaignRows.length ? campaignRows[0].id : null;
    if (!testCampaignId) {
      const [newCamp] = await pool.query(`INSERT INTO mkt_campaigns (name, status) VALUES ('Fall 2026 Test Campaign', 'ACTIVE')`);
      testCampaignId = newCamp.insertId;
    }
    const importRes = await CampaignService.importLeads(testCampaignId, mktPreview.validLeads, pool);
    console.log(`   ✓ Marketing import completed. Inserted: ${importRes.insertedCount} lead(s) into campaign #${testCampaignId}`);

    const [leadRows] = await pool.query(`SELECT id, full_name, phone_normalized, conversation_state FROM mkt_leads WHERE phone_normalized = ?`, [testPhoneNormalized]);
    assert.ok(leadRows.length >= 1);
    assert.equal(leadRows[0].conversation_state, 'QUALIFIED', 'Eligible lead in CSV must be marked QUALIFIED');
    console.log(`   ✓ Marketing lead #${leadRows[0].id} auto-qualified based on CSV academic data`);

    // Verify auto-provisioned candidate in adm_students (Phase 2 entry)
    const [provisioned] = await pool.query(`SELECT id, overall_status FROM adm_students WHERE phone_normalized = ?`, [testPhoneNormalized]);
    assert.ok(provisioned.length >= 1, 'Importing eligible CSV lead must auto-provision student in adm_students');
    console.log(`   ✓ Candidate auto-provisioned into Admissions (Phase 2) with status: ${provisioned[0].overall_status}`);

    // 1b. PHASE 1b: Verification Discrepancy CSV Ingestion & Token Minting
    console.log('\n📄 [Step 1b] Testing Verification Discrepancy CSV Upload Pipeline...');
    const csvContent = 
`Application No,Full Name,Father Name,Phone Number,CNIC,Email,FSc Marks,Matric Marks,Issues,Program
APP-2026-98956,Sheikh Haseeb,Tariq Mehmood,${testPhoneRaw},${testCnic},haseeb@example.com,940,980,FSC_MARKSHEET;MATRIC_MARKSHEET,Software Engineering
`;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');

    // Parse Discrepancy CSV
    const parsedRecords = DiscrepancyParserService.parseDiscrepancyCsv(csvBuffer);
    assert.equal(parsedRecords.length, 1, 'CSV must yield exactly 1 record');
    assert.equal(parsedRecords[0].phoneNormalized, testPhoneNormalized, 'Phone must normalize to 9231794598956 without leading zero');
    console.log(`   ✓ Discrepancy CSV parsed successfully. Normalized phone: ${parsedRecords[0].phoneNormalized}`);

    // Ingest into Database
    const ingestResult = await DiscrepancyParserService.ingestDiscrepancies(parsedRecords, pool);
    console.log(`   ✓ Ingested discrepancy CSV: ${JSON.stringify(ingestResult)}`);
    assert.equal(ingestResult.total, 1);
    assert.equal(ingestResult.errors.length, 0);

    // Verify candidate created/updated in adm_students
    const [students] = await pool.query(
      `SELECT id, full_name, phone_normalized, cnic, fsc_obtained_marks, matric_obtained_marks, overall_status
       FROM adm_students WHERE phone_normalized = ?`,
      [testPhoneNormalized]
    );
    assert.equal(students.length, 1, 'Candidate must exist in adm_students');
    const student = students[0];
    assert.equal(student.overall_status, 'DOCS_REQUESTED', 'Candidate must enter Verification phase with DOCS_REQUESTED');
    assert.equal(student.fsc_obtained_marks, 940);
    assert.equal(student.matric_obtained_marks, 980);
    console.log(`   ✓ Student #${student.id} ("${student.full_name}") updated in adm_students with status: ${student.overall_status}`);

    // Verify intake token minted & WhatsApp upload message enqueued
    const [tokens] = await pool.query(
      `SELECT id, token_hash, allowed_doc_types, is_revoked, expires_at FROM adm_intake_tokens WHERE student_id = ?`,
      [student.id]
    );
    assert.ok(tokens.length >= 1, 'Intake token must be minted');
    console.log(`   ✓ Intake token created for student #${student.id}. Allowed docs: ${JSON.stringify(tokens[0].allowed_doc_types)}`);

    const [outboxJobs] = await pool.query(
      `SELECT id, job_type, payload, status FROM outbox_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.recipientPhone')) = ? ORDER BY id DESC LIMIT 1`,
      [testPhoneNormalized]
    );
    assert.ok(outboxJobs.length >= 1, 'WhatsApp notification job must be queued in outbox_jobs');
    const outboxPayload = typeof outboxJobs[0].payload === 'string' ? JSON.parse(outboxJobs[0].payload) : outboxJobs[0].payload;
    assert.equal(outboxPayload.recipientPhone, testPhoneNormalized);
    assert.match(outboxPayload.messageText, /\/u\//, 'Message must contain secure /u/ upload link');
    console.log(`   ✓ Transactional WhatsApp message queued in outbox for ${outboxPayload.recipientPhone}`);

    // 2. PHASE 2: Document Verification Transition
    console.log('\n✅ [Step 2] Testing Candidate Verification Action...');
    // Fetch staff user
    const [staffUsers] = await pool.query(`SELECT id FROM sys_users WHERE is_active = 1 LIMIT 1`);
    const staffId = staffUsers.length ? staffUsers[0].id : null;

    // Staff approves candidate in manual review
    const reviewResult = await AdmissionIntakeService.executeManualReviewAction({
      studentId: student.id,
      action: 'APPROVE',
      fscObtainedMarks: 940,
      matricObtainedMarks: 980,
      reviewMethod: 'BOARD_PORTAL',
      notes: 'Verified against official educational board records.',
      actorId: staffId,
      actorType: 'STAFF',
    });
    assert.equal(reviewResult.overall_status, 'VERIFIED', 'Candidate overall_status must become VERIFIED');
    console.log(`   ✓ Candidate #${student.id} verified! Overall status: ${reviewResult.overall_status}`);

    // 3. PHASE 3: Automated SEET Test Scraping & Backfill
    console.log('\n🎓 [Step 3] Verifying Automated SEET Entrance Test Scraping & Backfill...');
    // Give async setImmediate trigger 3 seconds to complete lookup & merit calculation
    console.log('   ⏳ Waiting 3 seconds for automated async SEET scraping & merit engine trigger...');
    await new Promise((r) => setTimeout(r, 3000));

    // Verify entry test marks backfilled in adm_students
    const [verifiedStudents] = await pool.query(
      `SELECT id, full_name, cnic, entry_test_marks, entry_test_total, entry_test_roll_no, overall_status
       FROM adm_students WHERE id = ?`,
      [student.id]
    );
    const updatedStudent = verifiedStudents[0];
    console.log(`   Student #${updatedStudent.id} Record:`, {
      name: updatedStudent.full_name,
      cnic: updatedStudent.cnic,
      entryTestMarks: updatedStudent.entry_test_marks,
      entryTestTotal: updatedStudent.entry_test_total,
      entryTestRollNo: updatedStudent.entry_test_roll_no,
      overallStatus: updatedStudent.overall_status,
    });
    assert.ok(updatedStudent.entry_test_marks !== null && Number(updatedStudent.entry_test_marks) > 0, 'Entry test marks must be automatically backfilled');
    console.log(`   ✓ SEET Entry Test marks automatically backfilled: ${updatedStudent.entry_test_marks} / ${updatedStudent.entry_test_total} (Roll #${updatedStudent.entry_test_roll_no})`);

    // Verify official test result saved in mrt_official_results
    const [officialResults] = await pool.query(
      `SELECT id, board_or_test_name, cnic, marks_obtained, total_marks, percentage, status
       FROM mrt_official_results WHERE cnic = ? ORDER BY id DESC LIMIT 1`,
      [testCnic]
    );
    assert.ok(officialResults.length >= 1, 'Result must exist in mrt_official_results');
    console.log(`   ✓ SEET test recorded in mrt_official_results (Score: ${officialResults[0].marks_obtained}/${officialResults[0].total_marks}, Status: ${officialResults[0].status})`);

    // 4. PHASE 4: Automated Merit Calculation & Rankings
    console.log('\n📊 [Step 4] Verifying Automated Merit Calculation & Official Snapshot...');
    // Verify snapshot created in mrt_snapshots
    const [snapshots] = await pool.query(
      `SELECT id, snapshot_title, iteration_number, total_candidates, selected_count, waitlisted_count, is_locked
       FROM mrt_snapshots ORDER BY id DESC LIMIT 1`
    );
    assert.ok(snapshots.length >= 1, 'Official merit snapshot must be generated');
    const snapshot = snapshots[0];
    console.log(`   ✓ Active Merit Snapshot #${snapshot.id}: "${snapshot.snapshot_title}" (Total: ${snapshot.total_candidates}, Selected: ${snapshot.selected_count})`);

    // Verify candidate entry in mrt_entries
    const [meritEntries] = await pool.query(
      `SELECT e.id, e.merit_position, e.quota_category, e.aggregate_score, e.decision_status,
              e.matric_score_used, e.fsc_score_used, e.entry_test_score_used,
              s.full_name, s.phone_normalized
       FROM mrt_entries e
       JOIN adm_students s ON s.id = e.student_id
       WHERE e.snapshot_id = ? AND e.student_id = ?`,
      [snapshot.id, student.id]
    );
    assert.ok(meritEntries.length >= 1, 'Student must appear in the ranked merit list entries');
    const entry = meritEntries[0];

    // Compute expected aggregate:
    // Matric (10%): (980 / 1100) * 10 = 8.909
    // FSc (40%): (940 / 1100) * 40 = 34.182
    // SEET (50%): (entry_test_marks / 100) * 50
    const expectedMatric = (980 / 1100) * 10;
    const expectedFsc = (940 / 1100) * 40;
    const expectedTest = (Number(updatedStudent.entry_test_marks) / 100) * 50;
    const expectedAggregate = Number((expectedMatric + expectedFsc + expectedTest).toFixed(3));

    console.log(`   Candidate Merit Details:`);
    console.log(`     - Merit Position: #${entry.merit_position}`);
    console.log(`     - Quota Category: ${entry.quota_category}`);
    console.log(`     - Decision Status: ${entry.decision_status}`);
    console.log(`     - Aggregate Score: ${entry.aggregate_score}% (Expected: ${expectedAggregate}%)`);
    assert.equal(entry.aggregate_score, expectedAggregate, 'Calculated aggregate score must match weighted formula');
    assert.equal(entry.decision_status, 'SELECTED', 'Candidate must be selected on merit');
    console.log(`   ✓ Exact aggregate formula and quota allocation verified perfectly!`);

    // 5. PHASE 5: Congratulations Notification to Selected Candidate
    console.log('\n📲 [Step 5] Testing Selected Candidate WhatsApp Notification Broadcast...');
    const notifyResult = await MeritSnapshotService.dispatchSelectedNotifications(snapshot.id, {
      duePaymentDate: '2026-09-15',
    });
    console.log(`   ✓ Selected notification dispatch result:`, notifyResult);

    const [congratsJobs] = await pool.query(
      `SELECT id, payload, status FROM outbox_jobs
       WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.recipientPhone')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.messageType')) = 'MERIT_SELECTION'
       ORDER BY id DESC LIMIT 1`,
      [testPhoneNormalized]
    );
    assert.ok(congratsJobs.length >= 1, 'MERIT_SELECTION job must be queued for candidate');
    const congratsPayload = typeof congratsJobs[0].payload === 'string' ? JSON.parse(congratsJobs[0].payload) : congratsJobs[0].payload;
    assert.match(congratsPayload.messageText, /Congratulations/i, 'Notification must contain official congratulations text');
    assert.match(congratsPayload.messageText, /Merit Position/i, 'Notification must mention candidate merit rank');
    console.log(`   ✓ Official WhatsApp congratulations notification enqueued for ${congratsPayload.recipientPhone}:`);
    console.log(`   ------------------------------------------------------------`);
    console.log(`   ${congratsPayload.messageText.replace(/\n+/g, ' ')}`);
    console.log(`   ------------------------------------------------------------`);

    console.log('\n================================================================');
    console.log('🎉 ALL WORKFLOW PHASES PASSED WITH ZERO ERRORS!');
    console.log('   1. Marketing CSV Ingest & Auto-Qualify: PASSED');
    console.log('   2. Verification CSV Discrepancy & Intake Token: PASSED');
    console.log('   3. Candidate Verification (Status -> VERIFIED): PASSED');
    console.log('   4. Automated SEET Scraper & Backfill: PASSED');
    console.log('   5. Automated Merit Ranking & Snapshot Generation: PASSED');
    console.log('   6. WhatsApp Admission Selection Alert: PASSED');
    console.log('   All tests executed using target number: 031794598956 (9231794598956)');
    console.log('================================================================\n');

  } finally {
    connection.release();
    await pool.end();
  }
}

runEndToEndVerification().catch((err) => {
  console.error('\n❌ E2E Verification failed:', err);
  process.exit(1);
});

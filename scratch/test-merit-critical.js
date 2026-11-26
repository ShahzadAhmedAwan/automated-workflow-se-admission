import { pool } from '../server/src/core/db/pool.js';
import { MeritPolicyService } from '../server/src/modules/merit/services/merit-policy.service.js';
import { MeritEngineService } from '../server/src/modules/merit/services/merit-engine.service.js';
import { MeritSnapshotService } from '../server/src/modules/merit/services/merit-snapshot.service.js';
import { STUDENT_OVERALL_STATUS } from '../server/src/modules/verification/verification.constants.js';

async function run() {
  console.log('--- STARTING CRITICAL MERIT CALCULATION & SNAPSHOT TESTS ---');

  // Pre-clean any leftover test records from previous runs
  await pool.query('DELETE FROM mrt_entries WHERE snapshot_id IN (SELECT id FROM mrt_snapshots WHERE iteration_number = 99)');
  await pool.query('DELETE FROM mrt_snapshots WHERE iteration_number = 99');
  await pool.query('DELETE FROM adm_students WHERE cnic IN (?, ?, ?)', [
    '82203-1122334-2',
    '82203-2233445-1',
    '82203-3344556-1',
  ]);

  const [users] = await pool.query('SELECT id FROM sys_users LIMIT 1');
  const validUserId = users.length ? users[0].id : null;

  // 1. Retrieve Active Policy
  const activePolicy = await MeritPolicyService.getActivePolicy('SE');
  if (!activePolicy) {
    throw new Error('FAIL: No active merit policy found for program SE!');
  }
  console.log(`[PASS] Retrieved Active Policy: "${activePolicy.name}" (Version ${activePolicy.version})`);
  console.log(`       Weights: FSc=${activePolicy.fscWeightage}%, Matric=${activePolicy.matricWeightage}%, EntryTest=${activePolicy.entryTestWeightage}%`);

  const totalWeight = Number(activePolicy.fscWeightage) + Number(activePolicy.matricWeightage) + Number(activePolicy.entryTestWeightage);
  if (Math.abs(totalWeight - 100) > 0.01) {
    throw new Error(`FAIL: Policy weights do not total 100%! Sum=${totalWeight}`);
  }
  console.log(`[PASS] Weights mathematically validated to exactly 100%.`);

  // 2. Create 3 Pakistani verified student candidates with diverse scores
  const candidates = [
    {
      name: 'Zainab Bibi',
      father: 'Muhammad Ramzan',
      phone: '923011122334',
      cnic: '82203-1122334-2',
      fsc: 1010,
      matric: 1020,
      test: 90,
      dob: '2005-03-15',
    },
    {
      name: 'Hamza Farooq',
      father: 'Farooq Ahmed',
      phone: '923022233445',
      cnic: '82203-2233445-1',
      fsc: 920,
      matric: 950,
      test: 82,
      dob: '2005-08-20',
    },
    {
      name: 'Bilal Mustafa',
      father: 'Mustafa Kamal',
      phone: '923033344556',
      cnic: '82203-3344556-1',
      fsc: 810,
      matric: 840,
      test: 70,
      dob: '2004-11-10',
    },
  ];

  const studentIds = [];
  for (const c of candidates) {
    const [ins] = await pool.execute(
      `INSERT INTO adm_students (
         full_name, father_name, phone_normalized, cnic, email, city,
         fsc_obtained_marks, fsc_total_marks, matric_obtained_marks, matric_total_marks,
         entry_test_marks, entry_test_total, dob, overall_status, eligible_for
       ) VALUES (?, ?, ?, ?, ?, 'Mirpur', ?, 1100, ?, 1100, ?, 100, ?, ?, 'SE')`,
      [
        c.name,
        c.father,
        c.phone,
        c.cnic,
        `${c.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        c.fsc,
        c.matric,
        c.test,
        c.dob,
        STUDENT_OVERALL_STATUS.VERIFIED,
      ]
    );
    studentIds.push(ins.insertId);
  }
  console.log(`[PASS] Inserted 3 verified candidates: IDs = [${studentIds.join(', ')}]`);

  // 3. Test Aggregate Calculation Math for Candidate 1 (Zainab Bibi)
  // Expected: (1020/1100 * 10) + (1010/1100 * 50) + (90/100 * 40)
  // = 9.2727 + 45.9090 + 36.0000 = 91.182
  const student1Row = {
    id: studentIds[0],
    full_name: candidates[0].name,
    matric_obtained_marks: 1020,
    matric_total_marks: 1100,
    fsc_obtained_marks: 1010,
    fsc_total_marks: 1100,
    entry_test_marks: 90,
    entry_test_total: 100,
  };
  const computedAgg = MeritEngineService.calculateStudentAggregate(student1Row, activePolicy);
  console.log(`[PASS] Computed Aggregate for ${candidates[0].name}: ${computedAgg.aggregateScore}%`);
  if (computedAgg.aggregateScore < 85 || computedAgg.aggregateScore > 95) {
    throw new Error(`FAIL: Computed aggregate score out of expected range: ${computedAgg.aggregateScore}`);
  }

  // 4. Test Dry Run Merit Calculation
  const dryRun = await MeritSnapshotService.calculateAndSaveSnapshot({
    policyId: activePolicy.id,
    isDryRun: true,
  });
  console.log(`[PASS] Dry run merit calculation executed: totalCandidates=${dryRun.totalCandidates}, selectedCount=${dryRun.selectedCount}`);
  if (dryRun.totalCandidates < 3) {
    throw new Error(`FAIL: Dry run expected at least 3 candidates, got ${dryRun.totalCandidates}`);
  }

  // 5. Test Generating Official Snapshot (Iteration 99 for isolated testing)
  const testIteration = 99;
  const snapshotRes = await MeritSnapshotService.calculateAndSaveSnapshot({
    policyId: activePolicy.id,
    snapshotTitle: 'Test Automated Merit List - Iteration 99',
    iterationNumber: testIteration,
    isDryRun: false,
    userId: validUserId,
  });
  const snapshotId = snapshotRes.id;
  console.log(`[PASS] Generated official merit snapshot ID=${snapshotId} (Iteration ${testIteration})`);
  console.log(`       Ranked candidates: ${snapshotRes.totalCandidates}, Selected: ${snapshotRes.selectedCount}`);

  // 6. Test Retrieving Snapshot Details & Ordering
  const details = await MeritSnapshotService.getSnapshotDetails(snapshotId);
  if (!details.snapshot || details.entries.length < 3) {
    throw new Error(`FAIL: Snapshot details missing entries! Count=${details.entries?.length}`);
  }

  // Verify Zainab Bibi is ranked higher than Bilal Mustafa
  const zainabEntry = details.entries.find((e) => e.studentId === studentIds[0]);
  const bilalEntry = details.entries.find((e) => e.studentId === studentIds[2]);
  if (!zainabEntry || !bilalEntry) {
    throw new Error('FAIL: Candidates missing from snapshot entries!');
  }
  if (zainabEntry.meritPosition >= bilalEntry.meritPosition) {
    throw new Error(`FAIL: Higher scoring candidate ranked lower! Zainab pos=${zainabEntry.meritPosition}, Bilal pos=${bilalEntry.meritPosition}`);
  }
  console.log(`[PASS] Merit ranking confirmed: Zainab #${zainabEntry.meritPosition} (${zainabEntry.aggregateScore}%) > Bilal #${bilalEntry.meritPosition} (${bilalEntry.aggregateScore}%)`);

  // 7. Test Exporting Snapshot to CSV
  const csvExport = await MeritSnapshotService.exportSnapshotToCsv(snapshotId);
  if (!csvExport.filename.endsWith('.csv') || !csvExport.csvContent.includes('Merit Position')) {
    throw new Error('FAIL: Invalid CSV export output!');
  }
  if (!csvExport.csvContent.includes('Zainab Bibi') || !csvExport.csvContent.includes('82203-1122334-2')) {
    throw new Error('FAIL: CSV export missing student data or CNIC!');
  }
  console.log(`[PASS] Exported Snapshot to CSV: filename="${csvExport.filename}", content bytes=${csvExport.csvContent.length}`);

  // 8. Test Snapshot Locking (The "Lock Snapshot" button in UI)
  const lockRes = await MeritSnapshotService.lockSnapshot(snapshotId, validUserId);
  if (!lockRes.isLocked) {
    throw new Error('FAIL: Snapshot did not lock successfully!');
  }
  console.log(`[PASS] Snapshot locked successfully (isLocked: true).`);

  // Verify that an attempt to overwrite a locked snapshot throws SNAPSHOT_LOCKED (409)
  let lockedErrorCaught = false;
  try {
    await MeritSnapshotService.calculateAndSaveSnapshot({
      policyId: activePolicy.id,
      iterationNumber: testIteration,
      isDryRun: false,
      userId: validUserId,
    });
  } catch (err) {
    if (err.statusCode === 409 || err.code === 'SNAPSHOT_LOCKED') {
      lockedErrorCaught = true;
    }
  }
  if (!lockedErrorCaught) {
    throw new Error('FAIL: Overwriting locked snapshot did not throw expected 409 SNAPSHOT_LOCKED error!');
  }
  console.log(`[PASS] Immutability verified: Re-calculating against locked snapshot rejected with 409 SNAPSHOT_LOCKED.`);

  // 9. Cleanup test records
  await pool.query('DELETE FROM mrt_entries WHERE snapshot_id = ?', [snapshotId]);
  await pool.query('DELETE FROM mrt_snapshots WHERE id = ?', [snapshotId]);
  await pool.query('DELETE FROM adm_students WHERE id IN (?, ?, ?)', studentIds);
  console.log(`[PASS] Cleaned up temporary test snapshot #${snapshotId} and 3 student records.`);

  console.log('--- ALL MERIT TESTS PASSED SUCCESSFULLY ---');
  await pool.end();
}

run().catch((err) => {
  console.error('ERROR in merit test:', err);
  process.exit(1);
});

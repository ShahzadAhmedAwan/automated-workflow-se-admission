import { pool } from '../server/src/core/db/pool.js';
import { AdmissionIntakeService } from '../server/src/modules/verification/services/admission-intake.service.js';
import { DOCUMENT_TYPES, DOCUMENT_VERIFICATION_STATUS, STUDENT_OVERALL_STATUS } from '../server/src/modules/verification/verification.constants.js';

async function run() {
  console.log('--- STARTING CRITICAL VERIFICATION FLOW TEST ---');

  // 1. Create candidate
  const [insertStudent] = await pool.execute(
    `INSERT INTO adm_students (
       full_name, father_name, phone_normalized, cnic, email, city, prior_degree,
       eligible_for, fsc_obtained_marks, fsc_total_marks, matric_obtained_marks, matric_total_marks, overall_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Usman Ghani',
      'Abdul Ghani',
      '923331122334',
      '82203-5566778-1',
      'usman.ghani@example.com',
      'Muzaffarabad',
      'Pre-Engineering',
      'SE, SET, CET',
      820,
      1100,
      910,
      1100,
      STUDENT_OVERALL_STATUS.UNDER_REVIEW,
    ]
  );
  const studentId = insertStudent.insertId;
  console.log(`[PASS] Created test candidate id=${studentId} (Usman Ghani)`);

  // 2. Add 4 mandatory documents (CNIC_FRONT, FSC_MARKSHEET, MATRIC_MARKSHEET, DOMICILE)
  const docs = [
    { type: DOCUMENT_TYPES.CNIC_FRONT, filename: 'cnic_front.jpg', extracted: { cnic: '82203-5566778-1', candidateName: 'Usman Ghani' } },
    { type: DOCUMENT_TYPES.FSC_MARKSHEET, filename: 'fsc_marksheet.jpg', extracted: { obtainedMarks: 820, totalMarks: 1100, candidateName: 'Usman Ghani', rollNumber: '512034' } },
    { type: DOCUMENT_TYPES.MATRIC_MARKSHEET, filename: 'matric_marksheet.jpg', extracted: { obtainedMarks: 910, totalMarks: 1100, candidateName: 'Usman Ghani', rollNumber: '110294' } },
    { type: DOCUMENT_TYPES.DOMICILE, filename: 'domicile.jpg', extracted: { candidateName: 'Usman Ghani', district: 'Muzaffarabad' } },
  ];

  const docIds = {};
  for (const d of docs) {
    const [ins] = await pool.execute(
      `INSERT INTO adm_student_documents (
         student_id, doc_type, original_filename, file_mime, storage_provider, storage_key, verification_status, extracted_data
       ) VALUES (?, ?, ?, 'image/jpeg', 'LOCAL', ?, ?, ?)`,
      [studentId, d.type, d.filename, `test-storage/${d.filename}`, DOCUMENT_VERIFICATION_STATUS.PENDING, JSON.stringify(d.extracted)]
    );
    docIds[d.type] = ins.insertId;
  }
  console.log(`[PASS] Inserted mandatory documents: CNIC=#${docIds[DOCUMENT_TYPES.CNIC_FRONT]}, FSc=#${docIds[DOCUMENT_TYPES.FSC_MARKSHEET]}, Matric=#${docIds[DOCUMENT_TYPES.MATRIC_MARKSHEET]}, Domicile=#${docIds[DOCUMENT_TYPES.DOMICILE]}`);

  // 3. Test queue retrieval and filters
  const queueBefore = await AdmissionIntakeService.listManualReviewQueue({ search: 'Usman Ghani' });
  if (!queueBefore.items.find((c) => c.studentId === studentId)) {
    throw new Error('FAIL: Candidate not found in search query!');
  }
  console.log(`[PASS] Search found candidate in verification queue.`);

  const verifiedBefore = await AdmissionIntakeService.listManualReviewQueue({ status: 'VERIFIED' });
  if (verifiedBefore.items.some((c) => c.studentId === studentId)) {
    throw new Error('FAIL: Unverified candidate appeared in VERIFIED filter prematurely!');
  }
  console.log(`[PASS] Unverified candidate is correctly absent from VERIFIED filter.`);

  // 4. Test full student review dossier retrieval
  const dossier = await AdmissionIntakeService.getStudentReviewDossier(studentId);
  if (!dossier.student || dossier.documents.length !== 4) {
    throw new Error(`FAIL: Dossier missing student or documents. Count=${dossier.documents.length}`);
  }
  console.log(`[PASS] Dossier loaded successfully with ${dossier.documents.length} documents.`);

  // 5. Test step-by-step document approval
  // Approve Doc 1: CNIC_FRONT
  const approve1 = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.CNIC_FRONT],
    action: 'APPROVE',
    reviewMethod: 'STAFF_DOCUMENT',
    notes: 'Verified original CNIC front scan.',
  });
  console.log(`[PASS] Approved CNIC_FRONT. Candidate overall_status: ${approve1.overall_status}`);

  // Approve Doc 2: FSC_MARKSHEET
  const approve2 = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.FSC_MARKSHEET],
    action: 'APPROVE',
    reviewMethod: 'STAFF_DOCUMENT',
    notes: 'Verified FSc transcript matches declared 820 marks.',
  });
  console.log(`[PASS] Approved FSC_MARKSHEET. Candidate overall_status: ${approve2.overall_status}`);

  // Approve Doc 3: MATRIC_MARKSHEET
  const approve3 = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.MATRIC_MARKSHEET],
    action: 'APPROVE',
    reviewMethod: 'STAFF_DOCUMENT',
    notes: 'Verified Matric certificate.',
  });
  console.log(`[PASS] Approved MATRIC_MARKSHEET. Candidate overall_status: ${approve3.overall_status}`);

  // Approve Doc 4: DOMICILE -> Triggers full VERIFIED status!
  const approve4 = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.DOMICILE],
    action: 'APPROVE',
    reviewMethod: 'STAFF_DOCUMENT',
    notes: 'Verified state domicile certificate.',
  });
  console.log(`[PASS] Approved DOMICILE. Candidate overall_status: ${approve4.overall_status}`);
  if (approve4.overall_status !== 'VERIFIED') {
    throw new Error(`FAIL: Expected overall_status to be VERIFIED, got ${approve4.overall_status}`);
  }

  // 6. Test Verified Filter Retrieval
  const verifiedAfter = await AdmissionIntakeService.listManualReviewQueue({ status: 'VERIFIED' });
  const verifiedFound = verifiedAfter.items.find((c) => c.studentId === studentId);
  if (!verifiedFound) {
    throw new Error('FAIL: Candidate does not appear in VERIFIED filter after approval!');
  }
  console.log(`[PASS] Candidate #${studentId} immediately appears in VERIFIED filter!`);

  // 7. Test Override Marks Action
  const overrideRes = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.FSC_MARKSHEET],
    action: 'OVERRIDE_MARKS',
    fscObtainedMarks: 845,
    notes: 'Direct marks correction to 845 / 1100.',
  });
  const [updatedStudent] = await pool.query('SELECT fsc_obtained_marks FROM adm_students WHERE id = ?', [studentId]);
  console.log(`[PASS] Override Marks updated FSc score to: ${updatedStudent[0].fsc_obtained_marks} (expected 845)`);
  if (Number(updatedStudent[0].fsc_obtained_marks) !== 845) {
    throw new Error('FAIL: Override marks did not persist in database!');
  }

  // 8. Test Mark Discrepancy
  const discRes = await AdmissionIntakeService.executeManualReviewAction({
    studentId,
    documentId: docIds[DOCUMENT_TYPES.MATRIC_MARKSHEET],
    action: 'MARK_DISCREPANCY',
    discrepancyReason: 'Name spelling mismatch between CNIC and Matric certificate.',
  });
  console.log(`[PASS] Mark discrepancy result: overall_status=${discRes.overall_status}`);
  if (discRes.overall_status !== 'NEEDS_MANUAL_REVIEW') {
    throw new Error('FAIL: Mark discrepancy did not set status to NEEDS_MANUAL_REVIEW');
  }

  // 9. Clean up test data
  await pool.query('DELETE FROM adm_student_documents WHERE student_id = ?', [studentId]);
  await pool.query('DELETE FROM adm_intake_tokens WHERE student_id = ?', [studentId]);
  await pool.query('DELETE FROM adm_students WHERE id = ?', [studentId]);
  console.log(`[PASS] Test student #${studentId} cleanly removed.`);

  console.log('--- VERIFICATION CRITICAL FLOW COMPLETED SUCCESSFULLY ---');
  await pool.end();
}

run().catch((err) => {
  console.error('ERROR in verification test:', err);
  process.exit(1);
});

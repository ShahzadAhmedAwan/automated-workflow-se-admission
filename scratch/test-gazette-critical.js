import { pool } from '../server/src/core/db/pool.js';
import { BoardSourceService } from '../server/src/modules/verification/services/board-source.service.js';
import { GazetteSearchService } from '../server/src/modules/verification/services/gazette-search.service.js';

async function run() {
  console.log('--- STARTING CRITICAL GAZETTE & BOARD SOURCE TESTS ---');

  // 0. Get a valid user from sys_users
  const [users] = await pool.query('SELECT id FROM sys_users LIMIT 1');
  const validUserId = users.length ? users[0].id : null;
  console.log(`[PASS] Using actorId=${validUserId} for test operations.`);

  // 1. List existing sources
  const existingSources = await BoardSourceService.list();
  console.log(`[PASS] BoardSourceService.list() retrieved ${existingSources.length} existing sources.`);

  // 2. Test Registering a Web Portal Source (AUTO_FORM)
  const portalPayload = {
    boardName: 'BISE Rawalpindi Board - Annual 2024',
    boardAliases: 'BISE RWP, Rawalpindi Board, BISE Rawalpindi',
    academicYear: '2024',
    examLevel: 'HSSC',
    examSession: 'ANNUAL',
    examPart: 'ALL',
    sourceType: 'PORTAL_URL',
    portalAdapter: 'AUTO_FORM',
    resultUrl: 'https://results.biserawalpindi.edu.pk/hssc-annual-2024',
    actorId: validUserId,
  };

  await BoardSourceService.save(portalPayload);
  console.log(`[PASS] Registered Portal Source (${portalPayload.boardName})`);

  // Verify it exists in list
  const listAfterPortal = await BoardSourceService.list();
  const foundPortal = listAfterPortal.find((s) => s.board_name === portalPayload.boardName);
  if (!foundPortal || !foundPortal.is_active) {
    throw new Error('FAIL: Newly registered portal not found or inactive!');
  }
  console.log(`[PASS] Portal source confirmed active in registry (ID=${foundPortal.id}).`);

  // 3. Test Deactivating Source (The "Turn off" button in UI)
  const deactivateRes = await BoardSourceService.deactivate(foundPortal.id, validUserId);
  if (!deactivateRes.success) {
    throw new Error('FAIL: deactivate call failed!');
  }
  const [deactCheck] = await pool.query('SELECT is_active FROM adm_board_sources WHERE id = ?', [foundPortal.id]);
  if (deactCheck[0].is_active !== 0 && deactCheck[0].is_active !== false) {
    throw new Error('FAIL: Source was not marked inactive in database on deactivate!');
  }
  console.log(`[PASS] Successfully deactivated portal source (Turn off button verified).`);

  // 4. Test Registering / Uploading a PDF Gazette Source
  // Create a minimal valid PDF containing realistic Pakistani student roll number & marks
  const samplePdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 210 >>
stream
BT
/F1 12 Tf
72 720 Td
(BOARD OF INTERMEDIATE AND SECONDARY EDUCATION) Tj
0 -20 Td
(ANNUAL EXAMINATION 2024 - RESULT GAZETTE) Tj
0 -25 Td
(ROLL NO: 654321    NAME: HAMZA TARIQ    MARKS: 985 / 1100    PASS) Tj
0 -20 Td
(ROLL NO: 654322    NAME: BILAL AHMED    MARKS: 840 / 1100    PASS) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000506 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
577
%%EOF`;

  const pdfBuffer = Buffer.from(samplePdfContent, 'utf-8');
  const mockFile = {
    buffer: pdfBuffer,
    mimetype: 'application/pdf',
    originalname: 'BISE_RWP_HSSC_2024_Gazette.pdf',
    size: pdfBuffer.length,
  };

  const gazettePayload = {
    boardName: 'BISE Rawalpindi HSSC Gazette 2024',
    boardAliases: 'BISE RWP, Rawalpindi Board',
    academicYear: '2024',
    examLevel: 'HSSC',
    examSession: 'ANNUAL',
    examPart: 'ALL',
    sourceType: 'GAZETTE',
    file: mockFile,
    actorId: validUserId,
  };

  await BoardSourceService.save(gazettePayload);
  const listAfterGazette = await BoardSourceService.list();
  const foundGazette = listAfterGazette.find((s) => s.board_name === gazettePayload.boardName);
  if (!foundGazette) throw new Error('FAIL: Uploaded gazette source not found in database!');
  console.log(`[PASS] Registered & Uploaded PDF Gazette ID=${foundGazette.id} (${foundGazette.gazette_filename})`);

  // Query raw storage fields from database
  const [gazetteRows] = await pool.query('SELECT storage_key, storage_provider FROM adm_board_sources WHERE id = ?', [foundGazette.id]);
  const storageInfo = gazetteRows[0];

  // 5. Test Live Roll Verification in Gazette (The "Test Roll" button in UI)
  console.log('Testing Roll Number 654321 in Gazette via GazetteSearchService...');
  const searchResult = await GazetteSearchService.searchGazette({
    storageKey: storageInfo.storage_key,
    storageProvider: storageInfo.storage_provider,
    rollNumber: '654321',
    candidateName: 'HAMZA TARIQ',
    examYear: '2024',
    boardName: 'BISE Rawalpindi',
  });

  console.log('Gazette Search Result:', JSON.stringify(searchResult));
  if (!searchResult || !searchResult.found) {
    throw new Error('FAIL: Expected roll number 654321 to be found in gazette PDF!');
  }
  if (Number(searchResult.obtainedMarks) !== 985) {
    throw new Error(`FAIL: Expected obtained marks 985, got ${searchResult.obtainedMarks}`);
  }
  console.log(`[PASS] Test Roll verified in gazette! Name: ${searchResult.candidateName || 'HAMZA TARIQ'}, Marks: ${searchResult.obtainedMarks}/${searchResult.totalMarks}`);

  // Test Non-existent Roll Number
  const notFoundResult = await GazetteSearchService.searchGazette({
    storageKey: storageInfo.storage_key,
    storageProvider: storageInfo.storage_provider,
    rollNumber: '999999',
    candidateName: 'NON EXISTENT',
    examYear: '2024',
    boardName: 'BISE Rawalpindi',
  });
  if (notFoundResult && notFoundResult.found) {
    throw new Error('FAIL: Non-existent roll number was falsely marked as found!');
  }
  console.log(`[PASS] Non-existent roll number correctly reported as not found.`);

  // 6. Cleanup test records
  await pool.query('DELETE FROM adm_board_sources WHERE id IN (?, ?)', [foundPortal.id, foundGazette.id]);
  console.log(`[PASS] Cleaned up temporary test board sources.`);

  console.log('--- ALL GAZETTE & BOARD SOURCE TESTS PASSED SUCCESSFULLY ---');
  await pool.end();
}

run().catch((err) => {
  console.error('ERROR in gazette test:', err);
  process.exit(1);
});

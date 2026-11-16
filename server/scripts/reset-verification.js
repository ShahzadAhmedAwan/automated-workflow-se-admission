import { pool } from '../src/core/db/pool.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resets the document verification stage while preserving the student/lead data
 * collected during Phase 1 (WhatsApp Bot qualification, declared marks, CNIC, etc.)
 */
async function resetVerificationPhaseOnly() {
  const target = process.argv[2];

  if (!target) {
    console.log(`
Usage:
  npm --prefix server run verification:reset <phone_or_studentId>
  npm --prefix server run verification:reset all

Examples:
  npm --prefix server run verification:reset 03179459856
  npm --prefix server run verification:reset 1
  npm --prefix server run verification:reset all
`);
    process.exit(1);
  }

  const connection = await pool.getConnection();

  try {
    let studentRows = [];

    if (target.toLowerCase() === 'all') {
      console.log('Fetching all students to reset verification documents for...');
      const [rows] = await connection.execute('SELECT id, full_name, phone_normalized FROM adm_students');
      studentRows = rows;
    } else {
      const cleanDigits = target.replace(/\D/g, '');
      const searchSuffix = cleanDigits.length >= 9 ? cleanDigits.slice(-9) : cleanDigits;
      const isId = /^\d+$/.test(target) && Number(target) < 100000 && target.length <= 4;

      const query = isId
        ? 'SELECT id, full_name, phone_normalized FROM adm_students WHERE id = ? OR phone_normalized LIKE ?'
        : 'SELECT id, full_name, phone_normalized FROM adm_students WHERE phone_normalized LIKE ? OR full_name LIKE ?';
      const params = isId ? [Number(target), `%${searchSuffix}%`] : [`%${searchSuffix}%`, `%${target.trim()}%`];

      const [rows] = await connection.execute(query, params);
      studentRows = rows;
    }

    if (!studentRows.length) {
      console.log(`No candidate found in adm_students matching "${target}".`);
      return;
    }

    for (const student of studentRows) {
      console.log(`\n=== Resetting Verification for Candidate #${student.id} (${student.full_name || 'N/A'}, ${student.phone_normalized}) ===`);

      // 1. Find and remove all uploaded document files from disk
      const [docRows] = await connection.execute(
        'SELECT id, storage_key FROM adm_student_documents WHERE student_id = ?',
        [student.id]
      );

      for (const doc of docRows) {
        if (doc.storage_key) {
          const possiblePaths = [
            path.resolve(process.cwd(), 'data', 'uploads', doc.storage_key),
            path.resolve(process.cwd(), 'server', 'data', 'uploads', doc.storage_key),
            path.resolve(process.cwd(), 'server', doc.storage_key),
            path.resolve(process.cwd(), doc.storage_key),
          ];

          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              try {
                fs.unlinkSync(p);
                console.log(`  ✓ Removed file: ${p}`);
              } catch (e) {
                console.warn(`  ! Could not remove file: ${e.message}`);
              }
            }
          }
        }
      }

      // 2. Delete document records from adm_student_documents
      const [docDelete] = await connection.execute(
        'DELETE FROM adm_student_documents WHERE student_id = ?',
        [student.id]
      );
      console.log(`  ✓ Cleared ${docDelete.affectedRows} document record(s).`);

      // 3. Delete old intake tokens so a fresh link can be issued
      const [tokenDelete] = await connection.execute(
        'DELETE FROM adm_intake_tokens WHERE student_id = ?',
        [student.id]
      );
      console.log(`  ✓ Cleared ${tokenDelete.affectedRows} intake token(s).`);

      // 4. Cancel pending/failed OCR or migration jobs in outbox_jobs
      const [outboxResult] = await connection.execute(
        `DELETE FROM outbox_jobs WHERE payload LIKE ?`,
        [`%"studentId":${student.id}%`]
      );
      console.log(`  ✓ Cleared ${outboxResult.affectedRows} background job(s).`);

      // 5. Reset candidate verification status back to DOCS_REQUESTED (preserving lead data, declared marks, CNIC, etc.)
      await connection.execute(
        `UPDATE adm_students
            SET overall_status = 'DOCS_REQUESTED',
                verified_at = NULL,
                verified_by = NULL,
                discrepancy_notes = NULL,
                gdrive_folder_id = NULL
          WHERE id = ?`,
        [student.id]
      );
      console.log(`  ✓ Reset candidate status back to "DOCS_REQUESTED".`);
      console.log(`  ✓ Preserved Phase 1 profile (Full Name, Phone, CNIC, Father Name, Declared Marks intact).`);
    }

    console.log(`\n[SUCCESS] Candidate is ready for a fresh document verification run! You can now reissue the upload link from the portal.`);
  } catch (err) {
    console.error('Error resetting verification phase:', err);
  } finally {
    connection.release();
    await pool.end();
  }
}

resetVerificationPhaseOnly();

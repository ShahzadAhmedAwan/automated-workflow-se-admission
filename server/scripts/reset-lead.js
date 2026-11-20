import { pool } from '../src/core/db/pool.js';
import fs from 'node:fs';
import path from 'node:path';

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      console.log(`  ✓ Removed disk file: ${filePath}`);
    } catch (e) {
      console.warn(`  ! Could not remove disk file: ${e.message}`);
    }
  }
}

function removeDirIfEmpty(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      const files = fs.readdirSync(dirPath);
      if (files.length === 0) {
        fs.rmdirSync(dirPath);
      }
    } catch {
      // ignore
    }
  }
}

async function resetLead() {
  const targetPhone = process.argv[2];

  if (!targetPhone) {
    console.log(`
Usage:
  npm run lead:reset <phone_number>
  npm run lead:reset all

Examples:
  npm run lead:reset 03001234567
  npm run lead:reset 923001234567
  npm run lead:reset all
`);
    process.exit(1);
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    if (targetPhone.toLowerCase() === 'all') {
      console.log('Resetting all applicant leads, student records, and campaigns...');

      // 1. Clean disk files for all documents
      const [allDocs] = await connection.execute('SELECT storage_key FROM adm_student_documents');
      for (const doc of allDocs) {
        if (doc.storage_key) {
          const possiblePaths = [
            path.resolve(process.cwd(), 'data', 'uploads', doc.storage_key),
            path.resolve(process.cwd(), 'data', doc.storage_key),
            path.resolve(process.cwd(), 'server', 'data', 'uploads', doc.storage_key),
            path.resolve(process.cwd(), doc.storage_key),
          ];
          possiblePaths.forEach(removeFileIfExists);
        }
      }

      const [resOutbox] = await connection.execute("DELETE FROM outbox_jobs WHERE job_type IN ('WHATSAPP_MESSAGE', 'LEAD_QUALIFIED', 'PROCESS_OCR_DOCUMENT')");
      const [resDocs] = await connection.execute('DELETE FROM adm_student_documents');
      const [resTokens] = await connection.execute('DELETE FROM adm_intake_tokens');
      const [resStudents] = await connection.execute('DELETE FROM adm_students');
      const [resLeads] = await connection.execute('DELETE FROM mkt_leads');
      const [resCampaigns] = await connection.execute('DELETE FROM mkt_campaigns');

      await connection.commit();
      console.log(`✓ Cleared ${resLeads.affectedRows} marketing lead(s).`);
      console.log(`✓ Cleared ${resCampaigns.affectedRows} marketing campaign(s).`);
      console.log(`✓ Cleared ${resStudents.affectedRows} candidate student record(s).`);
      console.log(`✓ Cleared ${resTokens.affectedRows} intake token(s).`);
      console.log(`✓ Cleared ${resDocs.affectedRows} uploaded document record(s).`);
      console.log(`✓ Cancelled ${resOutbox.affectedRows} pending outbox job(s).`);
    } else {
      const cleanDigits = targetPhone.replace(/\D/g, '');
      const searchSuffix = cleanDigits.length >= 9 ? cleanDigits.slice(-9) : cleanDigits;

      console.log(`Cleaning data for phone matching: "${cleanDigits}" (suffix: "${searchSuffix}")...`);

      // 0. Find campaign IDs associated with matching leads before deletion
      const [leadCampaigns] = await connection.execute(
        `SELECT DISTINCT campaign_id FROM mkt_leads 
         WHERE (phone_normalized LIKE ? OR phone_raw LIKE ?) AND campaign_id IS NOT NULL`,
        [`%${searchSuffix}%`, `%${searchSuffix}%`]
      );
      const campaignIds = leadCampaigns.map((r) => r.campaign_id).filter(Boolean);

      // 1. Find matching student IDs
      const [students] = await connection.execute(
        `SELECT id FROM adm_students 
         WHERE phone_normalized LIKE ? 
            OR lead_id IN (SELECT id FROM mkt_leads WHERE phone_normalized LIKE ? OR phone_raw LIKE ?)`,
        [`%${searchSuffix}%`, `%${searchSuffix}%`, `%${searchSuffix}%`]
      );
      const studentIds = students.map((s) => s.id);

      // 2. Remove any uploaded document files on disk for these candidates
      if (studentIds.length > 0) {
        const placeholders = studentIds.map(() => '?').join(',');
        const [docRows] = await connection.execute(
          `SELECT storage_key FROM adm_student_documents WHERE student_id IN (${placeholders})`,
          studentIds
        );

        for (const doc of docRows) {
          if (doc.storage_key) {
            const possiblePaths = [
              path.resolve(process.cwd(), 'data', 'uploads', doc.storage_key),
              path.resolve(process.cwd(), 'data', doc.storage_key),
              path.resolve(process.cwd(), 'server', 'data', 'uploads', doc.storage_key),
              path.resolve(process.cwd(), doc.storage_key),
            ];
            possiblePaths.forEach(removeFileIfExists);
          }
        }

        for (const sId of studentIds) {
          const possibleDirs = [
            path.resolve(process.cwd(), 'data', 'uploads', 'uploads', `student_${sId}`),
            path.resolve(process.cwd(), 'data', 'uploads', `student_${sId}`),
          ];
          possibleDirs.forEach(removeDirIfEmpty);
        }
      }

      // 3. Delete students (cascades to tokens, documents, and merit entries)
      let clearedStudents = 0;
      if (studentIds.length > 0) {
        const placeholders = studentIds.map(() => '?').join(',');
        const [resStudents] = await connection.execute(
          `DELETE FROM adm_students WHERE id IN (${placeholders})`,
          studentIds
        );
        clearedStudents = resStudents.affectedRows;
      }

      // 4. Delete marketing leads
      const [resLeads] = await connection.execute(
        'DELETE FROM mkt_leads WHERE phone_normalized LIKE ? OR phone_raw LIKE ?',
        [`%${searchSuffix}%`, `%${searchSuffix}%`]
      );

      // 5. Clear any pending WhatsApp messages or qualification jobs for this phone
      let cancelledJobs = 0;
      const [resOutboxPhone] = await connection.execute(
        `DELETE FROM outbox_jobs WHERE payload LIKE ?`,
        [`%${searchSuffix}%`]
      );
      cancelledJobs += resOutboxPhone.affectedRows;

      for (const sId of studentIds) {
        const [resOutboxStudent] = await connection.execute(
          `DELETE FROM outbox_jobs WHERE payload LIKE ?`,
          [`%"studentId":${sId}%`]
        );
        cancelledJobs += resOutboxStudent.affectedRows;
      }

      // 6. Check associated campaigns and clean up any empty campaigns
      let deletedCampaigns = 0;
      for (const cId of campaignIds) {
        const [leadCount] = await connection.execute(
          'SELECT COUNT(*) AS cnt FROM mkt_leads WHERE campaign_id = ?',
          [cId]
        );
        if (leadCount[0].cnt === 0) {
          await connection.execute('DELETE FROM mkt_campaigns WHERE id = ?', [cId]);
          deletedCampaigns++;
        }
      }

      // Also clean up any other orphaned empty campaigns (campaigns with 0 remaining leads)
      const [allEmpty] = await connection.execute(
        `SELECT id, name FROM mkt_campaigns 
         WHERE id NOT IN (SELECT DISTINCT campaign_id FROM mkt_leads WHERE campaign_id IS NOT NULL)`
      );
      for (const ec of allEmpty) {
        await connection.execute('DELETE FROM mkt_campaigns WHERE id = ?', [ec.id]);
        deletedCampaigns++;
      }

      await connection.commit();
      console.log(`✓ Cleared ${resLeads.affectedRows} marketing lead record(s).`);
      console.log(`✓ Cleared ${clearedStudents} admitted candidate record(s) and documents.`);
      console.log(`✓ Cancelled ${cancelledJobs} pending outbox job(s).`);
      if (deletedCampaigns > 0) {
        console.log(`✓ Deleted ${deletedCampaigns} empty test campaign(s).`);
      }
    }

    console.log('\n[SUCCESS] Candidate data completely reset! You can now re-import the CSV or message the bot again.');
  } catch (err) {
    await connection.rollback();
    console.error('Error resetting lead:', err);
    process.exit(1);
  } finally {
    connection.release();
    await pool.end();
  }
}

resetLead().catch((err) => {
  console.error('Fatal reset error:', err);
  process.exit(1);
});

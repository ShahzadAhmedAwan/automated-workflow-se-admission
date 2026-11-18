import { pool } from '../src/core/db/pool.js';

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
      console.log('Resetting all applicant leads and student records...');
      const [resOutbox] = await connection.execute("DELETE FROM outbox_jobs WHERE job_type IN ('WHATSAPP_MESSAGE', 'LEAD_QUALIFIED', 'PROCESS_OCR_DOCUMENT')");
      const [resDocs] = await connection.execute('DELETE FROM adm_student_documents');
      const [resTokens] = await connection.execute('DELETE FROM adm_intake_tokens');
      const [resStudents] = await connection.execute('DELETE FROM adm_students');
      const [resLeads] = await connection.execute('DELETE FROM mkt_leads');

      await connection.commit();
      console.log(`✓ Cleared ${resLeads.affectedRows} marketing lead(s).`);
      console.log(`✓ Cleared ${resStudents.affectedRows} candidate student record(s).`);
      console.log(`✓ Cleared ${resTokens.affectedRows} intake token(s).`);
      console.log(`✓ Cleared ${resDocs.affectedRows} uploaded document record(s).`);
      console.log(`✓ Cleared ${resOutbox.affectedRows} pending outbox job(s).`);
    } else {
      const cleanDigits = targetPhone.replace(/\D/g, '');
      const searchSuffix = cleanDigits.length >= 9 ? cleanDigits.slice(-9) : cleanDigits;

      console.log(`Cleaning data for phone matching: "${cleanDigits}" (suffix: "${searchSuffix}")...`);

      // 1. Delete associated students (cascades to tokens and documents)
      const [resStudents] = await connection.execute(
        'DELETE FROM adm_students WHERE phone_normalized LIKE ?',
        [`%${searchSuffix}%`]
      );

      // 2. Delete marketing leads
      const [resLeads] = await connection.execute(
        'DELETE FROM mkt_leads WHERE phone_normalized LIKE ? OR phone_raw LIKE ?',
        [`%${searchSuffix}%`, `%${searchSuffix}%`]
      );

      // 3. Clear any pending WhatsApp messages or qualification jobs for this phone
      const [resOutbox] = await connection.execute(
        `DELETE FROM outbox_jobs WHERE payload LIKE ?`,
        [`%${searchSuffix}%`]
      );

      await connection.commit();
      console.log(`✓ Cleared ${resLeads.affectedRows} marketing lead record(s).`);
      console.log(`✓ Cleared ${resStudents.affectedRows} admitted candidate record(s) and documents.`);
      console.log(`✓ Cancelled ${resOutbox.affectedRows} pending outbox job(s).`);
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


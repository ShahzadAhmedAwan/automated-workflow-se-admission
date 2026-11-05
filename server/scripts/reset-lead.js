import { pool } from '../src/core/db/pool.js';

async function resetLead() {
  const targetPhone = process.argv[2];

  if (!targetPhone) {
    // If no specific phone given, show all leads and clear the test ones
    console.log('Resetting all test applicant conversations in mkt_leads...');
    const [result] = await pool.execute('DELETE FROM mkt_leads');
    console.log(`Cleared ${result.affectedRows} lead(s) from database.`);
  } else {
    const cleanDigits = targetPhone.replace(/\D/g, '');
    console.log(`Resetting conversation for phone: ${cleanDigits}...`);
    const [result] = await pool.execute(
      'DELETE FROM mkt_leads WHERE phone_normalized LIKE ? OR phone_raw LIKE ?',
      [`%${cleanDigits}%`, `%${cleanDigits}%`]
    );
    console.log(`Cleared ${result.affectedRows} record(s) matching ${cleanDigits}.`);
  }

  console.log('Done! You can now send a fresh message (e.g. "Hello" or "Yes") to your bot to test again.');
  await pool.end();
}

resetLead().catch((err) => {
  console.error('Error resetting lead:', err);
  process.exit(1);
});

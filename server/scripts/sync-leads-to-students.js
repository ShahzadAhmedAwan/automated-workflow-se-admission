import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' });

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'admissions_db'
  });

  try {
    const [cols] = await conn.execute('SHOW COLUMNS FROM adm_students');
    const colNames = cols.map((c) => c.Field);
    if (!colNames.includes('eligible_for')) {
      await conn.execute('ALTER TABLE adm_students ADD COLUMN eligible_for VARCHAR(100) NULL AFTER prior_degree');
      console.log('Added column eligible_for to adm_students');
    }

    const [lead14] = await conn.execute('SELECT id, full_name, eligible_for, eligibility_status FROM mkt_leads WHERE id = 14');
    console.log('mkt_leads row 14:', lead14);

    const [res] = await conn.execute(`
      UPDATE adm_students s
        JOIN mkt_leads l ON s.lead_id = l.id
         SET s.email = COALESCE(s.email, l.email),
             s.city = COALESCE(s.city, l.city),
             s.eligible_for = COALESCE(s.eligible_for, l.eligible_for),
             s.application_no = COALESCE(s.application_no, CONCAT('APP-2026-', LPAD(s.id, 4, '0')))
    `);
    console.log('Update result affectedRows:', res.affectedRows, 'changedRows:', res.changedRows);

    const [students] = await conn.execute(
      `SELECT id, lead_id, application_no, cnic, full_name, father_name, phone_normalized, email, city, prior_degree, eligible_for FROM adm_students`
    );
    console.log('adm_students rows:', JSON.stringify(students, null, 2));
  } finally {
    await conn.end();
  }
}

run().catch(console.error);

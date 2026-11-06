import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/core/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'database', 'schema.sql');
const source = await readFile(schemaPath, 'utf8');
const statements = source.split(';').map((sql) => sql.trim()).filter(Boolean);
const connection = await pool.getConnection();

try {
  console.info(`Applying ${statements.length} statements from database/schema.sql`);
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      throw new Error(`Schema statement ${index + 1} failed: ${error.message}`, { cause: error });
    }
  }
  console.info('Canonical database schema is ready.');

  // Run idempotent migrations for mkt_leads columns if table was created previously
  try {
    const [cols] = await connection.query(`SHOW COLUMNS FROM mkt_leads`);
    const colNames = cols.map((c) => c.Field.toLowerCase());

    if (!colNames.includes('father_name')) {
      await connection.query(`ALTER TABLE mkt_leads ADD COLUMN father_name VARCHAR(200) NULL AFTER full_name`);
      console.info('Added father_name column to mkt_leads');
    }
    if (!colNames.includes('cnic')) {
      await connection.query(`ALTER TABLE mkt_leads ADD COLUMN cnic VARCHAR(30) NULL AFTER phone_normalized`);
      console.info('Added cnic column to mkt_leads');
    }
    if (!colNames.includes('email')) {
      await connection.query(`ALTER TABLE mkt_leads ADD COLUMN email VARCHAR(254) NULL AFTER cnic`);
      console.info('Added email column to mkt_leads');
    }
    if (!colNames.includes('eligible_for')) {
      await connection.query(`ALTER TABLE mkt_leads ADD COLUMN eligible_for VARCHAR(100) NULL AFTER has_maths`);
      console.info('Added eligible_for column to mkt_leads');
    }

    // Update conversation_state ENUM to support all states
    await connection.query(`
      ALTER TABLE mkt_leads MODIFY COLUMN conversation_state ENUM(
        'IDLE',
        'GREETING_SENT',
        'AWAITING_INTEREST',
        'AWAITING_NAME',
        'AWAITING_FATHER_NAME',
        'AWAITING_MARKS',
        'AWAITING_MATHS',
        'AWAITING_CNIC',
        'AWAITING_EMAIL',
        'QUALIFIED',
        'NOT_INTERESTED',
        'GENERAL_INQUIRY'
      ) NOT NULL DEFAULT 'IDLE'
    `);
    console.info('Updated mkt_leads conversation_state enum to latest definition.');
  } catch (mErr) {
    console.warn('Migration note:', mErr.message);
  }

  // Idempotent migration for adm_intake_tokens
  try {
    const [tokenCols] = await connection.query(`SHOW COLUMNS FROM adm_intake_tokens`);
    const colNames = tokenCols.map((c) => c.Field.toLowerCase());
    if (!colNames.includes('raw_token')) {
      await connection.query(`ALTER TABLE adm_intake_tokens ADD COLUMN raw_token VARCHAR(128) NULL AFTER token_hash`);
      console.info('Added raw_token column to adm_intake_tokens');
    }
  } catch (tErr) {
    // If table doesn't exist yet, it was created by schema.sql
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}

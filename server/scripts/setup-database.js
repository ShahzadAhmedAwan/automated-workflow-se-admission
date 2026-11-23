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
  // Upgrade existing verification source tables before canonical seed statements reference new columns.
  const [sourceTable] = await connection.query(`SHOW TABLES LIKE 'adm_board_sources'`);
  if (sourceTable.length) {
    const [sourceColumns] = await connection.query(`SHOW COLUMNS FROM adm_board_sources`);
    const sourceColumnNames = new Set(sourceColumns.map((column) => column.Field));
    const additions = [
      ['exam_level', 'VARCHAR(32) NULL AFTER academic_year'],
      ['exam_session', 'VARCHAR(32) NULL AFTER exam_level'],
      ['exam_part', 'VARCHAR(32) NULL AFTER exam_session'],
      ['portal_adapter', 'VARCHAR(40) NULL AFTER source_type'],
    ];
    for (const [name, definition] of additions) {
      if (!sourceColumnNames.has(name)) {
        await connection.query(`ALTER TABLE adm_board_sources ADD COLUMN ${name} ${definition}`);
        console.info(`Added ${name} to adm_board_sources`);
      }
    }
    const [indexes] = await connection.query(`SHOW INDEX FROM adm_board_sources`);
    if (indexes.some((index) => index.Key_name === 'uq_adm_board_source_year')) {
      await connection.query(`ALTER TABLE adm_board_sources DROP INDEX uq_adm_board_source_year`);
      console.info('Enabled multiple verification sources per board and year.');
    }
    const sourceIndex = indexes.filter((index) => index.Key_name === 'ix_adm_board_source_active');
    if (!sourceIndex.some((index) => index.Column_name === 'exam_part')) {
      if (sourceIndex.length) await connection.query(`ALTER TABLE adm_board_sources DROP INDEX ix_adm_board_source_active`);
      await connection.query(`ALTER TABLE adm_board_sources ADD KEY ix_adm_board_source_active (is_active, board_name, academic_year, exam_level, exam_session, exam_part)`);
    }
    await connection.query(
      `UPDATE adm_board_sources
          SET academic_year = '2026', exam_level = 'HSSC', exam_session = 'ANNUAL', exam_part = 'PART_II',
              portal_adapter = 'AJKBISE', result_url = 'https://hsscresult.ajkbise.net/HSSC-II/'
        WHERE board_name = 'AJK BISE Mirpur' AND source_type = 'PORTAL_URL'
          AND result_url = 'https://ajkbise.net/results.php'`
    );
    await connection.query(
      `UPDATE adm_board_sources SET portal_adapter = 'FBISE'
        WHERE board_name = 'Federal Board (FBISE)' AND source_type = 'PORTAL_URL'
          AND result_url = 'https://portal.fbise.edu.pk/fbise-conduct/result/'`
    );
    await connection.query(
      `UPDATE adm_board_sources SET exam_level = 'UNKNOWN', exam_session = 'UNKNOWN'
        WHERE source_type = 'GAZETTE' AND (exam_level IS NULL OR exam_session IS NULL)`
    );
    await connection.query(
      `UPDATE adm_board_sources SET exam_level = COALESCE(exam_level, 'ALL'),
              exam_session = COALESCE(exam_session, 'ALL'), exam_part = COALESCE(exam_part, 'ALL')
        WHERE source_type = 'PORTAL_URL' AND (exam_level IS NULL OR exam_session IS NULL OR exam_part IS NULL)`
    );
  }

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

    try {
      const [admCols] = await connection.query(`SHOW COLUMNS FROM adm_students`);
      const admColNames = admCols.map((c) => c.Field);
      if (!admColNames.includes('eligible_for')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN eligible_for VARCHAR(100) NULL AFTER prior_degree`);
        console.info('Added eligible_for column to adm_students');
      }
      if (!admColNames.includes('entry_test_marks')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN entry_test_marks DECIMAL(7,2) NULL AFTER matric_total_marks`);
        console.info('Added entry_test_marks column to adm_students');
      }
      if (!admColNames.includes('entry_test_total')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN entry_test_total DECIMAL(7,2) NOT NULL DEFAULT 100.00 AFTER entry_test_marks`);
        console.info('Added entry_test_total column to adm_students');
      }
      if (!admColNames.includes('entry_test_roll_no')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN entry_test_roll_no VARCHAR(50) NULL AFTER entry_test_total`);
        console.info('Added entry_test_roll_no column to adm_students');
      }
      if (!admColNames.includes('dob')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN dob DATE NULL AFTER entry_test_roll_no`);
        console.info('Added dob column to adm_students');
      }
      if (!admColNames.includes('quota_category')) {
        await connection.query(`ALTER TABLE adm_students ADD COLUMN quota_category VARCHAR(80) NOT NULL DEFAULT 'OPEN_MERIT' AFTER dob`);
        console.info('Added quota_category column to adm_students');
      }

      const [tokenCols] = await connection.query(`SHOW COLUMNS FROM adm_intake_tokens`);
      const tokenColNames = tokenCols.map((c) => c.Field.toLowerCase());
      if (!tokenColNames.includes('raw_token')) {
        await connection.query(`ALTER TABLE adm_intake_tokens ADD COLUMN raw_token VARCHAR(512) NULL AFTER token_hash`);
        console.info('Added raw_token column to adm_intake_tokens');
      } else {
        await connection.query(`ALTER TABLE adm_intake_tokens MODIFY COLUMN raw_token VARCHAR(512) NULL`);
      }
      if (!tokenColNames.includes('reminder_sent_at')) {
        await connection.query(`ALTER TABLE adm_intake_tokens ADD COLUMN reminder_sent_at DATETIME(3) NULL AFTER expires_at`);
        console.info('Added reminder_sent_at column to adm_intake_tokens');
      }
    } catch {
      // Table might not exist yet if fresh install
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

} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}

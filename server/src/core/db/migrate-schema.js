import { pool } from './pool.js';

/**
 * Idempotent runtime migration helper that ensures missing database columns
 * are automatically created on startup, preventing ER_BAD_FIELD_ERROR crashes.
 */
export async function ensureDatabaseMigrations(db = pool) {
  let connection;
  try {
    connection = await db.getConnection();

    // 1. Check and patch adm_board_sources
    try {
      const [sourceTable] = await connection.query(`SHOW TABLES LIKE 'adm_board_sources'`);
      if (sourceTable.length) {
        const [columns] = await connection.query(`SHOW COLUMNS FROM adm_board_sources`);
        const existingCols = new Set(columns.map((c) => c.Field.toLowerCase()));

        const boardAdditions = [
          ['exam_level', 'VARCHAR(32) NULL AFTER academic_year'],
          ['exam_session', 'VARCHAR(32) NULL AFTER exam_level'],
          ['exam_part', 'VARCHAR(32) NULL AFTER exam_session'],
          ['portal_adapter', 'VARCHAR(40) NULL AFTER source_type'],
        ];

        for (const [colName, colDef] of boardAdditions) {
          if (!existingCols.has(colName.toLowerCase())) {
            await connection.query(`ALTER TABLE adm_board_sources ADD COLUMN ${colName} ${colDef}`);
            console.info(`[Auto-Migration] Added column ${colName} to adm_board_sources`);
          }
        }
      }
    } catch (err) {
      console.warn('[Auto-Migration] Note on adm_board_sources check:', err.message);
    }

    // 2. Check and patch adm_students
    try {
      const [studentTable] = await connection.query(`SHOW TABLES LIKE 'adm_students'`);
      if (studentTable.length) {
        const [columns] = await connection.query(`SHOW COLUMNS FROM adm_students`);
        const existingCols = new Set(columns.map((c) => c.Field.toLowerCase()));

        const studentAdditions = [
          ['eligible_for', 'VARCHAR(100) NULL AFTER prior_degree'],
          ['entry_test_marks', 'DECIMAL(7,2) NULL AFTER matric_total_marks'],
          ['entry_test_total', 'DECIMAL(7,2) NOT NULL DEFAULT 100.00 AFTER entry_test_marks'],
          ['entry_test_roll_no', 'VARCHAR(50) NULL AFTER entry_test_total'],
          ['dob', 'DATE NULL AFTER entry_test_roll_no'],
          ['quota_category', "VARCHAR(80) NOT NULL DEFAULT 'OPEN_MERIT' AFTER dob"],
        ];

        for (const [colName, colDef] of studentAdditions) {
          if (!existingCols.has(colName.toLowerCase())) {
            await connection.query(`ALTER TABLE adm_students ADD COLUMN ${colName} ${colDef}`);
            console.info(`[Auto-Migration] Added column ${colName} to adm_students`);
          }
        }
      }
    } catch (err) {
      console.warn('[Auto-Migration] Note on adm_students check:', err.message);
    }

    // 3. Check and patch mkt_leads
    try {
      const [leadsTable] = await connection.query(`SHOW TABLES LIKE 'mkt_leads'`);
      if (leadsTable.length) {
        const [columns] = await connection.query(`SHOW COLUMNS FROM mkt_leads`);
        const existingCols = new Set(columns.map((c) => c.Field.toLowerCase()));

        const leadAdditions = [
          ['father_name', 'VARCHAR(200) NULL AFTER full_name'],
          ['cnic', 'VARCHAR(30) NULL AFTER phone_normalized'],
          ['email', 'VARCHAR(254) NULL AFTER cnic'],
          ['eligible_for', 'VARCHAR(100) NULL AFTER has_maths'],
        ];

        for (const [colName, colDef] of leadAdditions) {
          if (!existingCols.has(colName.toLowerCase())) {
            await connection.query(`ALTER TABLE mkt_leads ADD COLUMN ${colName} ${colDef}`);
            console.info(`[Auto-Migration] Added column ${colName} to mkt_leads`);
          }
        }
      }
    } catch (err) {
      console.warn('[Auto-Migration] Note on mkt_leads check:', err.message);
    }

    // 4. Check and patch adm_intake_tokens
    try {
      const [tokenTable] = await connection.query(`SHOW TABLES LIKE 'adm_intake_tokens'`);
      if (tokenTable.length) {
        const [columns] = await connection.query(`SHOW COLUMNS FROM adm_intake_tokens`);
        const existingCols = new Set(columns.map((c) => c.Field.toLowerCase()));

        if (!existingCols.has('raw_token')) {
          await connection.query(`ALTER TABLE adm_intake_tokens ADD COLUMN raw_token VARCHAR(512) NULL AFTER token_hash`);
          console.info('[Auto-Migration] Added column raw_token to adm_intake_tokens');
        }
        if (!existingCols.has('reminder_sent_at')) {
          await connection.query(`ALTER TABLE adm_intake_tokens ADD COLUMN reminder_sent_at DATETIME(3) NULL AFTER expires_at`);
          console.info('[Auto-Migration] Added column reminder_sent_at to adm_intake_tokens');
        }
      }
    } catch (err) {
      console.warn('[Auto-Migration] Note on adm_intake_tokens check:', err.message);
    }

    // 5. Enforce single SUPER_ADMIN role architecture
    try {
      const [superRole] = await connection.query(`SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN'`);
      if (superRole.length) {
        const superAdminId = superRole[0].id;
        await connection.query(
          `UPDATE sys_user_roles SET role_id = ? WHERE role_id != ?`,
          [superAdminId, superAdminId]
        );
        await connection.query(
          `DELETE FROM sys_role_permissions WHERE role_id != ?`,
          [superAdminId]
        );
        await connection.query(
          `DELETE FROM sys_roles WHERE name != 'SUPER_ADMIN'`
        );
      }
    } catch (err) {
      console.warn('[Auto-Migration] Note on single SUPER_ADMIN role sync:', err.message);
    }
  } catch (error) {
    // If database connection is not available yet (e.g. in test env), don't crash
    console.warn('[Auto-Migration] Database auto-migration deferred:', error.message);
  } finally {
    if (connection) {
      try {
        connection.release();
      } catch {
        // ignore
      }
    }
  }
}

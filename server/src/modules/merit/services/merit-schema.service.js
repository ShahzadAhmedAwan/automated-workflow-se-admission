import { pool } from '../../../core/db/pool.js';

let schemaPromise = null;

/**
 * Idempotently ensures all Module 4 tables and adm_students columns exist.
 */
export async function ensureMeritSchema(db = pool) {
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    try {
      // 1. Ensure Module 4 tables exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS mrt_official_results (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          source_type ENUM('SEET_PORTAL', 'BOARD_GAZETTE', 'BOARD_PORTAL', 'MANUAL_ENTRY') NOT NULL,
          board_or_test_name VARCHAR(160) NOT NULL,
          cnic VARCHAR(30) NULL,
          roll_no VARCHAR(50) NULL,
          candidate_name VARCHAR(200) NULL,
          father_name VARCHAR(200) NULL,
          marks_obtained DECIMAL(7,2) NOT NULL,
          total_marks DECIMAL(7,2) NOT NULL DEFAULT 100.00,
          percentage DECIMAL(5,2) NULL,
          test_date VARCHAR(40) NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'PASS',
          raw_payload JSON NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY ix_mrt_results_cnic (cnic),
          KEY ix_mrt_results_roll (roll_no),
          KEY ix_mrt_results_source (source_type, board_or_test_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS mrt_policies (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          name VARCHAR(150) NOT NULL,
          version VARCHAR(30) NOT NULL DEFAULT '1.0',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          program_code VARCHAR(40) NOT NULL DEFAULT 'SE',
          matric_weightage DECIMAL(5,2) NOT NULL DEFAULT 10.00,
          fsc_weightage DECIMAL(5,2) NOT NULL DEFAULT 40.00,
          entry_test_weightage DECIMAL(5,2) NOT NULL DEFAULT 50.00,
          tie_breaker_rules JSON NULL,
          quota_definitions JSON NULL,
          created_by CHAR(36) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY ix_mrt_policies_active (is_active, program_code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS mrt_snapshots (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          policy_id BIGINT UNSIGNED NOT NULL,
          snapshot_title VARCHAR(200) NOT NULL,
          iteration_number INT UNSIGNED NOT NULL DEFAULT 1,
          is_locked BOOLEAN NOT NULL DEFAULT FALSE,
          total_candidates INT UNSIGNED NOT NULL DEFAULT 0,
          selected_count INT UNSIGNED NOT NULL DEFAULT 0,
          waitlisted_count INT UNSIGNED NOT NULL DEFAULT 0,
          created_by CHAR(36) NULL,
          locked_by CHAR(36) NULL,
          locked_at DATETIME(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY ix_mrt_snapshots_policy (policy_id, iteration_number),
          KEY ix_mrt_snapshots_locked (is_locked)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS mrt_entries (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          snapshot_id BIGINT UNSIGNED NOT NULL,
          student_id BIGINT UNSIGNED NOT NULL,
          merit_position INT UNSIGNED NOT NULL,
          quota_category VARCHAR(80) NOT NULL DEFAULT 'OPEN_MERIT',
          matric_score_used DECIMAL(7,2) NOT NULL,
          matric_total_used DECIMAL(7,2) NOT NULL DEFAULT 1100.00,
          fsc_score_used DECIMAL(7,2) NOT NULL,
          fsc_total_used DECIMAL(7,2) NOT NULL DEFAULT 1100.00,
          entry_test_score_used DECIMAL(7,2) NOT NULL,
          entry_test_total_used DECIMAL(7,2) NOT NULL DEFAULT 100.00,
          aggregate_score DECIMAL(6,3) NOT NULL,
          tie_break_level TINYINT UNSIGNED NOT NULL DEFAULT 0,
          decision_status ENUM('SELECTED', 'WAITLISTED', 'REJECTED') NOT NULL DEFAULT 'WAITLISTED',
          notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
          notification_sent_at DATETIME(3) NULL,
          created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id),
          KEY ix_mrt_entries_snapshot (snapshot_id, merit_position),
          KEY ix_mrt_entries_student (student_id),
          KEY ix_mrt_entries_status (snapshot_id, decision_status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 2. Ensure adm_students columns exist
      try {
        const [cols] = await db.query(`SHOW COLUMNS FROM adm_students`);
        const colNames = new Set(cols.map((c) => c.Field.toLowerCase()));

        if (!colNames.has('entry_test_marks')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN entry_test_marks DECIMAL(7,2) NULL AFTER matric_total_marks`);
        }
        if (!colNames.has('entry_test_total')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN entry_test_total DECIMAL(7,2) NOT NULL DEFAULT 100.00 AFTER entry_test_marks`);
        }
        if (!colNames.has('entry_test_roll_no')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN entry_test_roll_no VARCHAR(50) NULL AFTER entry_test_total`);
        }
        if (!colNames.has('dob')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN dob DATE NULL AFTER entry_test_roll_no`);
        }
        if (!colNames.has('quota_category')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN quota_category VARCHAR(80) NOT NULL DEFAULT 'OPEN_MERIT' AFTER dob`);
        }
        if (!colNames.has('eligible_for')) {
          await db.query(`ALTER TABLE adm_students ADD COLUMN eligible_for VARCHAR(100) NULL AFTER prior_degree`);
        }
      } catch {
        // Ignored if table doesn't exist yet or in unit tests
      }

      // 3. Ensure a default active policy exists in mrt_policies
      try {
        const [policies] = await db.query(`SELECT id FROM mrt_policies WHERE is_active = TRUE LIMIT 1`);
        if (!policies.length) {
          await db.query(`
            INSERT INTO mrt_policies (
              id, name, version, is_active, program_code, matric_weightage, fsc_weightage,
              entry_test_weightage, tie_breaker_rules, quota_definitions
            ) VALUES (
              1,
              'B.Sc. Software Engineering - Fall 2026 Policy',
              '1.0',
              TRUE,
              'SE',
              10.00,
              40.00,
              50.00,
              JSON_ARRAY('ENTRY_TEST', 'FSC', 'MATRIC', 'AGE'),
              JSON_ARRAY(
                JSON_OBJECT('code', 'OPEN_MERIT', 'title', 'Open Merit', 'seats', 70),
                JSON_OBJECT('code', 'AJK_REGIONAL', 'title', 'AJK District Quota', 'seats', 15),
                JSON_OBJECT('code', 'SPORTS', 'title', 'Sports Quota', 'seats', 5)
              )
            )
          `);
        }
      } catch {
        // Ignore
      }
    } catch (err) {
      console.warn('[Merit Schema Auto-Healer] Error ensuring schema:', err.message);
      schemaPromise = null; // Allow retry on failure
    }
  })();

  return schemaPromise;
}

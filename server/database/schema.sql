-- Canonical database schema for SE Admissions.
-- This is the maintained SQL source of truth. Apply it to an empty database with `npm run db:setup`.
CREATE TABLE IF NOT EXISTS sys_roles (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(40) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sys_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_permissions (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sys_permissions_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_role_permissions (
  role_id SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_sys_role_permissions_role FOREIGN KEY (role_id) REFERENCES sys_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_sys_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES sys_permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_users (
  id CHAR(36) NOT NULL,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  password_changed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_login_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sys_users_email (email),
  KEY ix_sys_users_active (is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_user_roles (
  user_id CHAR(36) NOT NULL,
  role_id SMALLINT UNSIGNED NOT NULL,
  assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  KEY ix_sys_user_roles_role (role_id),
  CONSTRAINT fk_sys_user_roles_user FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sys_user_roles_role FOREIGN KEY (role_id) REFERENCES sys_roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_auth_sessions (
  id CHAR(36) NOT NULL,
  family_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  raw_token VARCHAR(128) NULL,
  csrf_token_hash CHAR(64) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  last_used_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sys_auth_refresh_hash (refresh_token_hash),
  KEY ix_sys_auth_sessions_user (user_id, revoked_at, expires_at),
  KEY ix_sys_auth_sessions_family (family_id, revoked_at),
  CONSTRAINT fk_sys_auth_sessions_user FOREIGN KEY (user_id) REFERENCES sys_users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type VARCHAR(30) NOT NULL,
  actor_id CHAR(36) NULL,
  event_category VARCHAR(60) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_table VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NULL,
  payload_before JSON NULL,
  payload_after JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_sys_audit_actor_time (actor_id, created_at),
  KEY ix_sys_audit_entity_time (entity_table, entity_id, created_at),
  KEY ix_sys_audit_action_time (action, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_settings (
  setting_key VARCHAR(120) NOT NULL,
  setting_value JSON NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (setting_key),
  CONSTRAINT fk_sys_settings_user FOREIGN KEY (updated_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sys_baileys_auth (
  session_id VARCHAR(100) NOT NULL,
  data_key VARCHAR(191) NOT NULL,
  data_value LONGTEXT NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id, data_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS outbox_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  queue_name VARCHAR(80) NOT NULL,
  job_type VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  locked_at TIMESTAMP(3) NULL,
  lock_owner VARCHAR(100) NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_outbox_claim (status, available_at, id),
  KEY ix_outbox_queue_status (queue_name, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO sys_roles (name, description) VALUES
  ('SUPER_ADMIN', 'Full system access, user management, and protected merit snapshot actions.'),
  ('ADMISSION_OFFICER', 'Manages campaigns, admission policies, and merit runs.'),
  ('VERIFIER', 'Reviews candidate documents and reissues intake tokens.'),
  ('AUDITOR', 'Read-only access to audit records, merit lists, and candidate history.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO sys_permissions (name, description) VALUES
  ('users.manage', 'Create users and manage account roles and activation.'),
  ('settings.manage', 'Manage system configuration.'),
  ('marketing.campaigns.manage', 'Create and manage marketing campaigns.'),
  ('verification.documents.review', 'Review and update document verification decisions.'),
  ('verification.sources.manage', 'Manage official board result links and gazettes.'),
  ('verification.tokens.reissue', 'Reissue candidate intake tokens.'),
  ('merit.policies.manage', 'Create and update merit policies.'),
  ('merit.run', 'Run merit calculations and create snapshots.'),
  ('merit.snapshots.lock', 'Lock a merit snapshot.'),
  ('audit.read', 'Read administrative audit history.'),
  ('merit.read', 'Read merit lists and snapshots.'),
  ('candidates.read', 'Read candidate history and admission records.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r CROSS JOIN sys_permissions p WHERE r.name = 'SUPER_ADMIN';

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r JOIN sys_permissions p ON p.name IN (
  'marketing.campaigns.manage', 'verification.documents.review', 'merit.policies.manage', 'merit.run', 'merit.read', 'candidates.read'
) WHERE r.name = 'ADMISSION_OFFICER';

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r JOIN sys_permissions p ON p.name IN (
  'verification.documents.review', 'verification.tokens.reissue', 'candidates.read'
) WHERE r.name = 'VERIFIER';

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r JOIN sys_permissions p ON p.name IN (
  'audit.read', 'merit.read', 'candidates.read'
) WHERE r.name = 'AUDITOR';


-- ============================================================================
-- MODULE 2: Marketing & Lead Intake Slice
-- ============================================================================

CREATE TABLE IF NOT EXISTS mkt_campaigns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED') NOT NULL DEFAULT 'DRAFT',
  total_leads INT UNSIGNED NOT NULL DEFAULT 0,
  sent_count INT UNSIGNED NOT NULL DEFAULT 0,
  responded_count INT UNSIGNED NOT NULL DEFAULT 0,
  eligible_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_mkt_campaigns_status (status, created_at),
  KEY ix_mkt_campaigns_creator (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mkt_leads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id BIGINT UNSIGNED NULL,
  full_name VARCHAR(200) NOT NULL,
  father_name VARCHAR(200) NULL,
  phone_raw VARCHAR(40) NOT NULL,
  phone_normalized VARCHAR(20) NOT NULL,
  cnic VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  city VARCHAR(120) NULL,
  prior_degree VARCHAR(80) NULL,
  fsc_marks INT UNSIGNED NULL,
  has_maths BOOLEAN NULL,
  eligible_for VARCHAR(100) NULL,
  eligibility_status ENUM('PENDING', 'ELIGIBLE', 'INELIGIBLE') NOT NULL DEFAULT 'PENDING',
  ineligibility_reason VARCHAR(100) NULL,
  conversation_state ENUM(
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
  ) NOT NULL DEFAULT 'IDLE',
  chat_history JSON NULL,
  last_interaction_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_mkt_leads_campaign (campaign_id, eligibility_status),
  KEY ix_mkt_leads_phone (phone_normalized),
  KEY ix_mkt_leads_state (conversation_state),
  CONSTRAINT fk_mkt_leads_campaign FOREIGN KEY (campaign_id) REFERENCES mkt_campaigns(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- MODULE 3: Bulk Document Intake & AI Verification Slice
-- ============================================================================

CREATE TABLE IF NOT EXISTS adm_students (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id BIGINT UNSIGNED NULL,
  application_no VARCHAR(50) NULL,
  cnic VARCHAR(30) NULL,
  full_name VARCHAR(200) NOT NULL,
  father_name VARCHAR(200) NULL,
  phone_normalized VARCHAR(20) NOT NULL,
  email VARCHAR(254) NULL,
  city VARCHAR(120) NULL,
  prior_degree VARCHAR(80) NULL,
  eligible_for VARCHAR(100) NULL,
  fsc_roll_no VARCHAR(50) NULL,
  fsc_obtained_marks INT UNSIGNED NULL,
  fsc_total_marks INT UNSIGNED NOT NULL DEFAULT 1100,
  matric_obtained_marks INT UNSIGNED NULL,
  matric_total_marks INT UNSIGNED NOT NULL DEFAULT 1100,
  entry_test_roll_no VARCHAR(50) NULL,
  entry_test_marks DECIMAL(7,2) NULL,
  entry_test_total DECIMAL(7,2) NOT NULL DEFAULT 100.00,
  dob DATE NULL,
  quota_category VARCHAR(80) NOT NULL DEFAULT 'OPEN_MERIT',
  overall_status ENUM(
    'PENDING',
    'DOCS_REQUESTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'NEEDS_MANUAL_REVIEW'
  ) NOT NULL DEFAULT 'PENDING',
  verified_at DATETIME(3) NULL,
  verified_by CHAR(36) NULL,
  gdrive_folder_id VARCHAR(255) NULL,
  discrepancy_notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_adm_students_app_no (application_no),
  KEY ix_adm_students_lead (lead_id),
  KEY ix_adm_students_cnic (cnic),
  KEY ix_adm_students_phone (phone_normalized),
  KEY ix_adm_students_status (overall_status),
  CONSTRAINT fk_adm_students_lead FOREIGN KEY (lead_id) REFERENCES mkt_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_students_verified_by FOREIGN KEY (verified_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adm_intake_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  raw_token VARCHAR(512) NULL,
  allowed_doc_types JSON NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  used_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
  reminder_sent_at DATETIME(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_adm_intake_tokens_hash (token_hash),
  KEY ix_adm_intake_tokens_student (student_id),
  KEY ix_adm_intake_tokens_status (is_revoked, expires_at, used_at),
  CONSTRAINT fk_adm_intake_tokens_student FOREIGN KEY (student_id) REFERENCES adm_students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adm_student_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_id BIGINT UNSIGNED NOT NULL,
  token_id BIGINT UNSIGNED NULL,
  doc_type VARCHAR(60) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  file_mime VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  storage_provider ENUM('R2', 'LOCAL_MOCK', 'GDRIVE') NOT NULL DEFAULT 'R2',
  storage_key VARCHAR(1024) NOT NULL,
  gdrive_file_id VARCHAR(255) NULL,
  storage_state ENUM('ACTIVE_R2', 'ARCHIVED_GDRIVE', 'DELETED') NOT NULL DEFAULT 'ACTIVE_R2',
  ocr_raw_response JSON NULL,
  extracted_data JSON NULL,
  portal_verification_data JSON NULL,
  verification_status ENUM(
    'PENDING',
    'OCR_PROCESSING',
    'MATCHED',
    'DISCREPANCY',
    'PORTAL_VERIFIED',
    'MANUAL_REVIEW',
    'REJECTED'
  ) NOT NULL DEFAULT 'PENDING',
  verified_at DATETIME(3) NULL,
  reviewed_at DATETIME(3) NULL,
  reviewed_by CHAR(36) NULL,
  review_method ENUM('AUTOMATED', 'STAFF_PORTAL', 'STAFF_GAZETTE', 'STAFF_DOCUMENT') NULL,
  review_notes TEXT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_adm_docs_student (student_id, doc_type),
  KEY ix_adm_docs_token (token_id),
  KEY ix_adm_docs_status (verification_status),
  KEY ix_adm_docs_storage (storage_state),
  CONSTRAINT fk_adm_docs_student FOREIGN KEY (student_id) REFERENCES adm_students(id) ON DELETE CASCADE,
  CONSTRAINT fk_adm_docs_token FOREIGN KEY (token_id) REFERENCES adm_intake_tokens(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_docs_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adm_board_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  board_name VARCHAR(160) NOT NULL,
  board_aliases JSON NULL,
  academic_year VARCHAR(20) NOT NULL,
  exam_level VARCHAR(32) NULL,
  exam_session VARCHAR(32) NULL,
  exam_part VARCHAR(32) NULL,
  source_type ENUM('PORTAL_URL', 'GAZETTE') NOT NULL,
  portal_adapter VARCHAR(40) NULL,
  result_url VARCHAR(2048) NULL,
  gazette_filename VARCHAR(255) NULL,
  storage_provider ENUM('R2', 'LOCAL_MOCK') NULL,
  storage_key VARCHAR(1024) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_adm_board_source_active (is_active, board_name, academic_year, exam_level, exam_session, exam_part),
  CONSTRAINT fk_adm_board_source_created_by FOREIGN KEY (created_by) REFERENCES sys_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_board_source_updated_by FOREIGN KEY (updated_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO adm_board_sources (board_name, board_aliases, academic_year, exam_level, exam_session, exam_part, source_type, portal_adapter, result_url)
SELECT 'Federal Board (FBISE)', JSON_ARRAY('FBISE', 'FBISE Islamabad', 'Federal Board'), 'ALL', 'ALL', 'ALL', 'ALL', 'PORTAL_URL', 'FBISE', 'https://portal.fbise.edu.pk/fbise-conduct/result/'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM adm_board_sources WHERE board_name = 'Federal Board (FBISE)' AND source_type = 'PORTAL_URL');
INSERT INTO adm_board_sources (board_name, board_aliases, academic_year, exam_level, exam_session, exam_part, source_type, portal_adapter, result_url)
SELECT 'AJK BISE Mirpur', JSON_ARRAY('AJK BISE', 'BISE AJK', 'AJK Board', 'Mirpur Board'), '2026', 'HSSC', 'ANNUAL', 'PART_II', 'PORTAL_URL', 'AJKBISE', 'https://hsscresult.ajkbise.net/HSSC-II/'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM adm_board_sources WHERE board_name = 'AJK BISE Mirpur' AND source_type = 'PORTAL_URL' AND academic_year = '2026' AND exam_level = 'HSSC' AND exam_session = 'ANNUAL' AND exam_part = 'PART_II');
INSERT INTO adm_board_sources (board_name, board_aliases, academic_year, exam_level, exam_session, exam_part, source_type, portal_adapter, result_url)
SELECT 'State Engineering Entry Test (SEET)', JSON_ARRAY('SEET', 'MUST SEET', 'Entry Test'), '2026', 'ALL', 'ALL', 'ALL', 'PORTAL_URL', 'AUTO_FORM', 'https://seet.must.edu.pk/seet_result.php'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM adm_board_sources WHERE board_name = 'State Engineering Entry Test (SEET)' AND source_type = 'PORTAL_URL');

-- ============================================================================
-- MODULE 4: Merit Engine & Seat Verification Slice
-- ============================================================================

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY ix_mrt_policies_active (is_active, program_code),
  CONSTRAINT fk_mrt_policies_creator FOREIGN KEY (created_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY ix_mrt_snapshots_locked (is_locked),
  CONSTRAINT fk_mrt_snapshots_policy FOREIGN KEY (policy_id) REFERENCES mrt_policies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_mrt_snapshots_creator FOREIGN KEY (created_by) REFERENCES sys_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_mrt_snapshots_locker FOREIGN KEY (locked_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  KEY ix_mrt_entries_status (snapshot_id, decision_status),
  CONSTRAINT fk_mrt_entries_snapshot FOREIGN KEY (snapshot_id) REFERENCES mrt_snapshots(id) ON DELETE CASCADE,
  CONSTRAINT fk_mrt_entries_student FOREIGN KEY (student_id) REFERENCES adm_students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO mrt_policies (
  id, name, version, is_active, program_code, matric_weightage, fsc_weightage, entry_test_weightage, tie_breaker_rules, quota_definitions
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
);

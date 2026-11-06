-- Migration: 003_intake_and_verification.sql
-- Module 3: Bulk Document Intake & AI Verification Slice

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
  fsc_roll_no VARCHAR(50) NULL,
  fsc_obtained_marks INT UNSIGNED NULL,
  fsc_total_marks INT UNSIGNED NOT NULL DEFAULT 1100,
  matric_obtained_marks INT UNSIGNED NULL,
  matric_total_marks INT UNSIGNED NOT NULL DEFAULT 1100,
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
  allowed_doc_types JSON NOT NULL,
  attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  used_at DATETIME(3) NULL,
  expires_at DATETIME(3) NOT NULL,
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
  source_type ENUM('PORTAL_URL', 'GAZETTE') NOT NULL,
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
  UNIQUE KEY uq_adm_board_source_year (board_name, academic_year),
  KEY ix_adm_board_source_active (is_active, board_name, academic_year),
  CONSTRAINT fk_adm_board_source_created_by FOREIGN KEY (created_by) REFERENCES sys_users(id) ON DELETE SET NULL,
  CONSTRAINT fk_adm_board_source_updated_by FOREIGN KEY (updated_by) REFERENCES sys_users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO adm_board_sources (board_name, board_aliases, academic_year, source_type, result_url)
VALUES
  ('Federal Board (FBISE)', JSON_ARRAY('FBISE', 'FBISE Islamabad', 'Federal Board'), 'ALL', 'PORTAL_URL', 'https://portal.fbise.edu.pk/fbise-conduct/result/'),
  ('AJK BISE Mirpur', JSON_ARRAY('AJK BISE', 'BISE AJK', 'AJK Board', 'Mirpur Board'), 'ALL', 'PORTAL_URL', 'https://ajkbise.net/results.php');

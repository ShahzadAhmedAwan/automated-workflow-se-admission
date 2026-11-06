-- Apply once to existing installations before deploying the matching API.
ALTER TABLE adm_students
  ADD COLUMN verified_at DATETIME(3) NULL AFTER overall_status,
  ADD COLUMN verified_by CHAR(36) NULL AFTER verified_at,
  ADD CONSTRAINT fk_adm_students_verified_by FOREIGN KEY (verified_by) REFERENCES sys_users(id) ON DELETE SET NULL;

ALTER TABLE adm_student_documents
  ADD COLUMN reviewed_at DATETIME(3) NULL AFTER verified_at,
  ADD COLUMN reviewed_by CHAR(36) NULL AFTER reviewed_at,
  ADD COLUMN review_method ENUM('AUTOMATED', 'STAFF_PORTAL', 'STAFF_GAZETTE', 'STAFF_DOCUMENT') NULL AFTER reviewed_by,
  ADD COLUMN review_notes TEXT NULL AFTER review_method,
  ADD CONSTRAINT fk_adm_docs_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES sys_users(id) ON DELETE SET NULL;

CREATE TABLE adm_board_sources (
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

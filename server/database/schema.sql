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
  csrf_token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  revoked_at TIMESTAMP(3) NULL,
  last_used_at TIMESTAMP(3) NULL,
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
  'marketing.campaigns.manage', 'merit.policies.manage', 'merit.run', 'merit.read', 'candidates.read'
) WHERE r.name = 'ADMISSION_OFFICER';

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r JOIN sys_permissions p ON p.name IN (
  'verification.documents.review', 'verification.tokens.reissue', 'candidates.read'
) WHERE r.name = 'VERIFIER';

INSERT IGNORE INTO sys_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM sys_roles r JOIN sys_permissions p ON p.name IN (
  'audit.read', 'merit.read', 'candidates.read'
) WHERE r.name = 'AUDITOR';

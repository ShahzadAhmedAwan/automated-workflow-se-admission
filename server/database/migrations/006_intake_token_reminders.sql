-- Migration 006: Track automated expiration reminder dispatches
ALTER TABLE adm_intake_tokens
  ADD COLUMN reminder_sent_at DATETIME(3) NULL AFTER expires_at,
  ADD INDEX idx_intake_tokens_reminder (is_revoked, used_at, reminder_sent_at, expires_at);

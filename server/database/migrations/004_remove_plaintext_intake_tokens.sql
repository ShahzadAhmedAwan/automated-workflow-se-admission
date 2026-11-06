-- Run once on databases created before token hashes became canonical.
-- Existing links remain valid because requests are matched against token_hash.
ALTER TABLE adm_intake_tokens DROP COLUMN raw_token;

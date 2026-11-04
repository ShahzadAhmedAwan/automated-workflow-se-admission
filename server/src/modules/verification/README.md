# Verification module boundary

Own intake tokens, document workflows, OCR integrations, and mocks here. Add `adm_*` table definitions to the Verification section of `server/database/schema.sql`. Public upload-token endpoints are capability based; staff review routes use `verification.documents.review` and token reissue uses `verification.tokens.reissue`. Publish work through the shared outbox.

# Verification module boundary

Own intake tokens, document workflows, OCR integrations, and mocks here. Add `adm_*` table definitions to the Verification section of `server/database/schema.sql`. Public upload-token endpoints are capability based; staff review routes use `verification.documents.review` and token reissue uses `verification.tokens.reissue`. Publish work through the shared outbox.

Before enabling public uploads in production, configure Gemini and Cloudflare R2 in `server/.env`. Google Drive archival also requires a service account with Drive API access and a shared archive folder; without it, archive jobs retry and the original file is retained. OCR and board fixtures are development-only and cannot approve a candidate.

Every candidate file can be opened from the authenticated staff dossier. If a document has no verification rule, OCR is incomplete, or the board cannot be confirmed, it enters manual review. Admission officers, verifiers, and super admins with `verification.documents.review` can record the evidence checked, a required review note, reviewer identity, and review time. The candidate-level `verified_by` is set when all uploaded documents reach an accepted state; per-document reviewer records and the audit log retain individual decisions. Auditors remain read-only.

Board sources are evidence references, not automated result scrapers. FBISE and AJK BISE official result pages are seeded as portal links; admins can add year-specific URLs or upload a PDF gazette. Staff open the portal or gazette, compare the candidate’s roll number, name, and result, then record a manual decision. Gazette layouts vary by board and year, so the system does not claim to parse or certify a gazette automatically. If OCR does not identify a matching board and year source, staff can still review the original uploaded record and add a source later.

Existing databases must apply `server/database/migrations/005_verification_review_tracking_and_board_sources.sql` once, then run `npm run db:setup` to grant review access to admission officers. Fresh installations receive these objects from `server/database/schema.sql`.

## Verification checks

Run the unit and mock-transaction checks with `npm run test:verification` from the repository root. To run the MySQL lifecycle integration test, create a disposable database whose name ends in `_test`, apply `server/database/schema.sql` (and any required one-time migrations), then provide `VERIFICATION_TEST_DB_HOST`, `VERIFICATION_TEST_DB_PORT`, `VERIFICATION_TEST_DB_NAME`, `VERIFICATION_TEST_DB_USER`, `VERIFICATION_TEST_DB_PASSWORD`, and `VERIFICATION_TEST_STAFF_ID`. The selected staff account must be active, hold `verification.documents.review`, and be an administrator for the board-source setup step. Set `VERIFICATION_INTEGRATION=1` and run `npm run test:verification`. The integration test refuses database names that do not end in `_test` and cleans up its tagged rows and uploaded files.

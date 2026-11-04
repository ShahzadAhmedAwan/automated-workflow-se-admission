# SE Admissions Automation System — Modular Implementation Plan & Zero-Conflict Architecture

---

## 1. Executive Summary & Stack Definition

The **SE Admissions Automation System** is an automated admissions intake, document verification, and merit calculation platform engineered specifically for **Shared Hosting (cPanel Node.js)** environments. 

The system is designed with **autonomous, decoupled modules**. Each module is self-contained with its own schema slice, route handlers, background worker logic, and mock test fixtures. **Any developer can pick up any module in any order or combination** and develop it in complete isolation without blocking or creating merge conflicts.

### Finalized Technology Stack

| Component | Selected Technology | Purpose & Architectural Justification |
| :--- | :--- | :--- |
| **Runtime & Hosting** | **Node.js (LTS) on cPanel** | Runs under cPanel Node.js Selector / Phusion Passenger. Zero container overhead, low idle footprint, fits shared hosting memory limits (≤1GB RAM). |
| **Database** | **MySQL 8.0 (`mysql2/promise`)** | Native local MySQL database on shared hosting. Connection-pooled (max 8–10 connections) with row-level locking (`SKIP LOCKED`) to act as the single source of truth and job queue. |
| **Frontend** | **React.js (Vite) + Tailwind CSS** | Single Page Application (SPA) compiled to static production assets served directly via Express or web server docroot. Modern, responsive, and lightweight. |
| **Messaging Engine** | **Baileys (WhatsApp Web Multi-Device)** | Free, direct socket-based WhatsApp client. Session credentials persisted directly in MySQL to avoid file count bloat. |
| **Scraping Engine** | **`axios` + `cheerio`** | High-speed HTTP request dispatcher and DOM parser. Eliminates headless Chrome/Puppeteer/Playwright to prevent RAM spikes and missing Linux OS dependencies. |
| **Document OCR** | **Google Gemini Flash API (`@google/genai`)** | Zero local CPU/GPU load. Extracts structured JSON directly from marksheet images. Managed with a 4–5 second sequential throttle to respect AI Studio Free Tier limits. |
| **PDF Extraction** | **`pdf-parse` (`pdf.js` text layer)** | Streams text directly from official gazette PDFs without launching external binaries or OCR models. |
| **Storage (Inode Shield)**| **Cloudflare R2 + Google Drive API** | **Cloudflare R2 (S3 API):** Holds active/pending uploads.<br>**Google Drive API:** Archives verified student records.<br>**Shared Hosting Disk:** Zero permanent files stored locally, preventing cPanel Inode limit penalties. |
| **Task Scheduler** | **`node-cron` + MySQL Outbox Table** | Reliable, persistent database-backed task queue. Eliminates Redis while providing durability across process restarts. |

---

## 2. Shared Hosting (cPanel) Architectural Guardrails

### 2.1 Inode Protection Strategy
- Shared hosts enforce strict limits on total file counts (typically 150,000–300,000 Inodes). Storing thousands of student uploads locally will rapidly exhaust account limits.
- **Approach:**
  1. Student documents are streamed directly to Cloudflare R2 via presigned URLs or memory-buffered uploads.
  2. Temporary files created during batch operations (e.g., CSV imports, PDF parsing) are processed in memory or written to temporary paths and immediately purged in `finally` blocks.
  3. Once a student's documents are marked `VERIFIED`, a background job streams them from Cloudflare R2 into a student-specific folder in Google Drive (Google Drive API v3) and deletes them from R2 to keep the free 10GB R2 bucket empty.

### 2.2 Memory Ceiling Defense ($\le$ 512MB–1GB RAM)
- cPanel CloudLinux environments enforce hard caps on virtual memory (512MB–1024MB) and CPU usage. Exceeding limits triggers kernel kills (OOM).
- **Approach:**
  - Node.js runtime flag: `--max-old-space-size=450` forces V8 garbage collection before reaching shared hosting caps.
  - No headless browsers (`puppeteer`, `playwright`, `selenium`) are permitted. All scraping is performed with `axios` + `cheerio` (<25MB RAM footprint).
  - OCR extraction is offloaded entirely to Google Gemini Flash API via HTTP. No local Tesseract or Python OCR engines are run on the server.
  - Large PDF Gazettes are processed via stream-based chunking with `pdf-parse` instead of buffering entire files in memory.

### 2.3 Single-Process Queue & Background Jobs
- Shared hosting does not support separate Redis daemons or Celery workers.
- **Approach:**
  - A dedicated MySQL table (`outbox_jobs`) acts as the persistent queue.
  - An internal `node-cron` runner polls the table at regular intervals using non-blocking row locks (`FOR UPDATE SKIP LOCKED`).
  - An external cPanel cron job pings a protected health endpoint every 5 minutes (`curl -s https://domain/api/v1/core/cron/heartbeat`) to wake or verify worker execution.

---

## 3. The Zero-Conflict Modular Architecture

To guarantee that any developer can implement any module without stepping on another developer's work, the codebase follows four decoupling principles:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              SHARED CORE INFRASTRUCTURE                                │
│  - Database Connection Pool Singleton (`src/core/db/pool.js`)                          │
│  - Persistent Outbox Event Bus Table (`outbox_jobs`)                                   │
│  - System Audit Logger (`src/core/audit/auditLogger.js`)                                │
└──────────────────────────────────────────┬─────────────────────────────────────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
┌──────────────────┐             ┌──────────────────┐              ┌──────────────────┐
│     MODULE 1     │             │     MODULE 2     │              │     MODULE 3     │
│  [Auth & Core]   │             │[Marketing/Leads] │              │[Doc Intake & AI] │
│                  │             │                  │              │                  │
│ - Admin RBAC     │             │ - CSV Preview    │              │ - Dynamic Portal │
│ - Baileys Engine │             │ - WhatsApp Bot   │              │ - Gemini Flash   │
│ - Outbox Daemon  │             │ - Lead Ingest    │              │ - R2 -> GDrive   │
└──────────────────┘             └────────┬─────────┘              └────────┬─────────┘
                                          │                                 │
                                          │ (Publishes:                     │ (Sets status:
                                          │  LEAD_QUALIFIED)                │  VERIFIED)
                                          ▼                                 ▼
                                 ┌────────────────────────────────────────────────────┐
                                 │                      MODULE 4                      │
                                 │                 [Results & Merit]                  │
                                 │                                                    │
                                 │ - Gazette PDF Stream Parser                        │
                                 │ - Cheerio Portal Fallback Scrapers                 │
                                 │ - Dynamic Formula Weighted Merit Engine            │
                                 │ - Multi-Tier Tie-Breaker Resolution                │
                                 │ - Immutable Merit Snapshot Store                   │
                                 └────────────────────────────────────────────────────┘
```

### 3.1 Strict Directory & Boundary Isolation
Each module resides in its own isolated folder. No module ever imports private internal files from another module.

```text
AGENT/
├── src/
│   ├── core/                        <-- Shared Core (DB Pool, Outbox Bus, Audit Logger)
│   │   ├── db/pool.js
│   │   ├── queue/outboxBus.js
│   │   └── audit/auditLogger.js
│   │
│   ├── modules/
│   │   ├── auth/                    <-- MODULE 1: Auth, Users, Baileys Socket, Settings
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── routes.js
│   │   │   └── mocks/               <-- Self-contained mock runner
│   │   │
│   │   ├── marketing/               <-- MODULE 2: Leads, WhatsApp Outreach & Chatbot
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── routes.js
│   │   │   └── mocks/               <-- Mock Baileys sender & lead seeds
│   │   │
│   │   ├── verification/            <-- MODULE 3: Intake Tokens, OCR & Board Scraper
│   │   │   ├── controllers/
│   │   │   ├── services/
│   │   │   ├── routes.js
│   │   │   └── mocks/               <-- Mock Gemini OCR & portal responses
│   │   │
│   │   └── merit/                   <-- MODULE 4: Gazette PDF, Tie-Breakers & Merit
│   │       ├── controllers/
│   │       ├── services/
│   │       ├── routes.js
│   │       └── mocks/               <-- Mock verified student datasets
│   │
│   ├── contracts/                   <-- Shared Type & Event Payloads
│   │   ├── eventTypes.js            <-- String constants for Outbox Jobs
│   │   └── dtos.js                  <-- Formal data schemas for inter-module events
│   │
│   └── server.js                    <-- Mounts module routers at independent prefixes
│
└── client/src/modules/
    ├── auth/                        <-- Module 1 UI (Login, User Management)
    ├── marketing/                   <-- Module 2 UI (Campaign Manager, Lead Tables)
    ├── verification/                <-- Module 3 UI (Upload Form, Manual Review Queue)
    └── merit/                       <-- Module 4 UI (Policy Config, Merit Snapshots)
```

### 3.2 Database Schema Namespacing & Migration Independence
Each module owns its database tables via a dedicated prefix. No cross-module migration locks or circular dependencies exist:
- `sys_*` $\rightarrow$ Module 1: Auth, users, Baileys session, audit logs.
- `mkt_*` $\rightarrow$ Module 2: Campaigns, raw leads, chat state history.
- `adm_*` $\rightarrow$ Module 3: Students, upload tokens, uploaded documents.
- `mrt_*` $\rightarrow$ Module 4: Gazette results, merit policies, snapshots, entries.
- `outbox_jobs` $\rightarrow$ Shared Outbox Queue (initialized once in core).

**Foreign Keys Rule:** Cross-module relationships use indexed logical IDs with `ON DELETE SET NULL` (e.g., `adm_students.lead_id` references `mkt_leads.id`). This allows developers to create and migrate their own module tables without requiring another module's tables to exist first.

### 3.3 Asynchronous Event Handoff via Outbox
Modules communicate asynchronously through `outbox_jobs`:
- Instead of calling Module 3 directly, Module 2 publishes a `LEAD_QUALIFIED` event.
- Instead of calling Module 1 directly, any module needing WhatsApp messaging publishes a `WHATSAPP_MESSAGE` event.
- Module 4 operates purely as a read query against candidates with `overall_status = 'VERIFIED'`.

---

## 4. Module Specifications & Implementation Details

---

### MODULE 1: Auth & Core Infrastructure

#### 1. Scope & Capabilities
Provides the foundational security boundary, admin identity management, MySQL connection pooling, Baileys persistent session engine, centralized outbox queue daemon, and append-only audit logging.

#### 2. Technical Approach & Architecture
- **Authentication & RBAC:**
  - Stateless JWT access tokens (15-minute lifespan) paired with cryptographically secure rotating refresh tokens stored in `httpOnly`, `SameSite=Strict` cookies.
  - Role-Based Access Control enforcing 4 roles:
    - `SUPER_ADMIN`: Full system privileges, user management, and locking merit snapshots.
    - `ADMISSION_OFFICER`: Manages marketing campaigns, policy setup, and merit runs.
    - `VERIFIER`: Restricted to document review queues and token re-issuance.
    - `AUDITOR`: Read-only access to audit logs, merit lists, and candidate history.
- **Baileys Multi-Device Persistence in MySQL:**
  - Serializes binary authentication keys and creds directly into `sys_baileys_auth` using custom Buffer reviver/replacer logic.
  - Eliminates the generation of hundreds of small JSON files on disk, strictly protecting cPanel Inode quotas.
  - Exposes an SSE endpoint (`/api/v1/core/baileys/qr-stream`) that pushes real-time QR code strings to the React admin panel until paired.
- **Outbox Queue Poller Daemon:**
  - Lightweight `node-cron` task polling every 5 seconds.
  - Claims jobs atomically using `SELECT ... FOR UPDATE SKIP LOCKED`.
  - Implements exponential backoff retry intervals (1 min, 5 min, 15 min). Jobs failing 3 consecutive times move to `FAILED` with diagnostics recorded.
- **Append-Only Audit Interceptor:**
  - Intercepts state changes across the application.
  - Every update records `actor_type`, `actor_id`, `event_category`, `action`, `entity_table`, `entity_id`, `payload_before`, and `payload_after` in `sys_audit_logs`.
  - The audit log table permits **no `UPDATE` or `DELETE` operations** at the application layer.

#### 3. Database Slice
- `sys_users` (UUID, email, password_hash, role, is_active)
- `sys_audit_logs` (actor, event_category, entity, payload_before, payload_after)
- `sys_settings` (setting_key, setting_value JSON)
- `sys_baileys_auth` (session_id, data_key, data_value LONGTEXT)
- `outbox_jobs` (queue_name, job_type, payload JSON, status, attempts, locked_at)

#### 4. In/Out Contracts
- **Consumes:** None (Module 1 is the root dependency).
- **Emits:** Event `WHATSAPP_MESSAGE_SENT` upon delivery.
- **Exposes:** `pool` singleton, `dispatchJob()`, `logAudit()`, and auth middlewares.

#### 5. Standalone Mocking Strategy for Developer
The developer building Module 1 can run an independent test script (`src/modules/auth/mocks/run_standalone.js`) that seeds an admin user, tests JWT login/refresh, connects a test Baileys session, and verifies that outbox worker loops successfully claim jobs via `SKIP LOCKED`.

---

### MODULE 2: Marketing & Lead Intake

#### 1. Scope & Capabilities
Handles bulk lead data ingestion, executes anti-ban WhatsApp outreach campaigns, runs an automated rule-based conversational chatbot to qualify applicants, and hands off eligible candidates to Admissions.

#### 2. Technical Approach & Architecture
- **Two-Stage Bulk Lead Ingestion:**
  - **Stage 1 (Dry-Run / Preview):**
    - Parses uploaded CSV/XLSX using memory-safe streaming.
    - Fuzzy-matches file columns to internal attributes (`Full Name`, `Phone`, `City`, `Previous Education`).
    - Normalizes phone numbers to standard international format (E.164: `03001234567` $\rightarrow$ `923001234567`).
    - Checks against existing numbers in `mkt_leads` and `adm_students` to flag duplicates.
    - Returns a JSON summary: `{ totalRows, validCount, duplicateCount, invalidPhoneCount, previewRows }`.
  - **Stage 2 (Commit):**
    - Inserts valid records into `mkt_leads` in batches of 250 rows under a campaign reference.
- **Anti-Ban WhatsApp Dispatcher:**
  - Outreach campaigns create individual records in `outbox_jobs` with progressive timestamps.
  - Enforces randomized jitter intervals between 12 and 28 seconds:
    $$\text{ScheduledTime}_{n} = \text{ScheduledTime}_{n-1} + \text{random}(12, 28) \text{ seconds}$$
  - Dispatches only within permitted daylight hours (09:00 to 20:00).
- **Rule-Based Conversational Qualification Agent:**
  - Listens to incoming WhatsApp messages received by Baileys.
  - Evaluates applicant responses via a deterministic state machine stored in `mkt_leads.conversation_state`:
    - `GREETING_SENT`: User receives campaign pitch: *"Are you interested in Software Engineering for Fall 2026? (Reply Yes/No)"*.
    - `AWAITING_INTEREST`: Detects affirmative response. Prompts: *"What was your obtained score in FSc/ICS Part 1? (e.g., 420/550 or 850/1100)"*.
    - `AWAITING_MARKS`: Evaluates numeric marks. Computes percentage.
      - If $< 50\%$: Replies with regret, sets `eligibility_status = 'INELIGIBLE'`, `ineligibility_reason = 'BELOW_MINIMUM_MARKS_50'`.
      - If $\ge 50\%$: Prompts: *"Did you study Mathematics as a major subject? (Yes/No)"*.
    - `AWAITING_MATHS`:
      - If "No": Sets `eligibility_status = 'INELIGIBLE'`, `ineligibility_reason = 'NO_MATHEMATICS'`.
      - If "Yes": Sets `eligibility_status = 'ELIGIBLE'`, `conversation_state = 'QUALIFIED'`, sends confirmation, and triggers admission handoff.
- **Lead-to-Admissions Handoff:**
  - Publishes an event `LEAD_QUALIFIED` into `outbox_jobs` containing normalized lead data.

#### 3. Database Slice
- `mkt_campaigns` (name, total_leads, sent_count, responded_count, eligible_count, status)
- `mkt_leads` (campaign_id, full_name, phone_normalized, prior_degree, fsc_marks, has_maths, eligibility_status, conversation_state, chat_history JSON)

#### 4. In/Out Contracts
- **Consumes:** Listens to incoming WhatsApp message events from Baileys.
- **Emits:**
  - Enqueues `WHATSAPP_MESSAGE` jobs to `outbox_jobs`.
  - Enqueues `LEAD_QUALIFIED` jobs to `outbox_jobs`.
- **Exposes:** Routes for lead upload preview, import confirmation, campaign management, and conversation logs.

#### 5. Standalone Mocking Strategy for Developer
The developer building Module 2 uses a mock WhatsApp service (`src/modules/marketing/mocks/mockBaileys.js`) that simulates incoming and outgoing WhatsApp messages via a simple local REST endpoint or CLI prompt, enabling full testing of the conversational state machine without needing a real WhatsApp connection.

---

### MODULE 3: Bulk Document Intake & AI Verification

#### 1. Scope & Capabilities
Manages issue-based bulk student document requests, generates single-use expiring upload links, provides a tailored public upload form, extracts document data using throttled Gemini Flash OCR, verifies credentials against educational board portals, moves files to Google Drive, and manages manual review escalations.

#### 2. Technical Approach & Architecture
- **Bulk Discrepancy Ingestion & Token Generation:**
  - Ingests an Excel spreadsheet of students with specific document issues.
  - Semicolon/comma-delimited tags (e.g., `MATRIC_MARKSHEET; FSC_MARKSHEET`) are mapped to standardized document types.
  - Creates or updates student records in `adm_students` and generates a single-use token in `adm_intake_tokens`:
    - Generates a 32-byte cryptographically secure random token, stored as a SHA-256 hash.
    - Stores `allowed_doc_types` as a JSON array (e.g., `["FSC_MARKSHEET"]`).
    - Sets a 48-hour expiration window.
    - Enqueues a personalized WhatsApp message with the exact missing items and link: `/upload/:token`.
- **Dynamic React Upload Portal:**
  - Public route `/upload/:token` accessible without login.
  - Fetches token metadata on load: verifies hash, expiration, and used status.
  - Renders upload dropzones **only** for the documents specified in `allowed_doc_types`.
  - Client-side validation enforces image/PDF mime-types and a 5MB per-file size ceiling.
  - Streams files directly to Cloudflare R2 storage via S3 API.
  - Marks token as used (`used_at = NOW()`), records document entries in `adm_student_documents` with status `PENDING`, and enqueues OCR jobs.
- **Throttled Gemini Flash OCR Engine:**
  - Worker claims pending documents one at a time.
  - **Rate-Limit Enforcement:** Executes a mandatory 4500ms sequential sleep between calls to guarantee execution remains safely below Google AI Studio Free Tier limits (15 RPM).
  - Sends base64-encoded document data to Gemini 2.5 Flash API with strict JSON schema instructions:
    - Extracts: `candidate_name`, `father_name`, `roll_number`, `registration_number`, `board_name`, `exam_year`, `total_marks`, `obtained_marks`, and `is_pass`.
  - Stores the raw structured response in `adm_student_documents.ocr_raw_response` and normalized fields in `extracted_data`.
- **Lightweight Board Portal Verification (`axios` + `cheerio`):**
  - If extracted OCR marks match the student's claimed marks, queries target board portals (e.g., FBISE, BISE AJK) using an HTTP POST/GET request.
  - Cheerio parses the resulting HTML DOM to verify candidate name, roll number, and total obtained marks.
  - Eliminates all headless browser overhead, completing the check in <500ms and <20MB RAM.
- **Decision Workflow & Multi-Tier Escalation:**
  - **Condition A (Verified Match):** OCR and portal data match the student record.
    - Set document status to `MATCHED` and student to `VERIFIED`.
    - Trigger background archival: stream file from Cloudflare R2 directly into student folder on Google Drive, record Google Drive file ID, and delete from R2.
  - **Condition B (Discrepancy on Attempts 1–2):** OCR or portal data conflicts with student input.
    - Increment `attempt_count`.
    - Invalidate current token and generate a fresh 48-hour single-use token.
    - Dispatch automated WhatsApp alert detailing the exact issue (e.g., *"Your FSc marksheet shows 810 marks, but your application stated 920. Please upload the correct official marksheet here: [Link]"*).
  - **Condition C (Discrepancy on Attempt 3+ OR Portal Discrepancy):**
    - Escalate student to `adm_students.overall_status = 'NEEDS_MANUAL_REVIEW'`.
    - Routes to the Admin Manual Review Queue with side-by-side display of the uploaded image, OCR extracted values, and board portal response.

#### 3. Database Slice
- `adm_students` (UUID, application_no, cnic, full_name, phone_normalized, fsc_roll_no, fsc_marks, matric_marks, overall_status, gdrive_folder_id)
- `adm_intake_tokens` (student_id, token_hash, allowed_doc_types JSON, attempt_count, is_revoked, used_at, expires_at)
- `adm_student_documents` (student_id, doc_type, r2_key, gdrive_file_id, storage_state, ocr_raw_response JSON, verification_status)

#### 4. In/Out Contracts
- **Consumes:**
  - Listens for `LEAD_QUALIFIED` event to auto-create admission candidates.
  - Claims `PROCESS_OCR_DOCUMENT` and `MIGRATE_GDRIVE` jobs from `outbox_jobs`.
- **Emits:**
  - Enqueues `WHATSAPP_MESSAGE` jobs for token links and discrepancy notices.
  - Sets `adm_students.overall_status = 'VERIFIED'` (consumed by Module 4).
- **Exposes:** Routes for issue sheet import, public token validation, document uploads, and manual review queue actions.

#### 5. Standalone Mocking Strategy for Developer
The developer building Module 3 uses local mock fixtures (`src/modules/verification/mocks/mockOcrResponse.json` and a local file mock storage adapter) to simulate uploads, Gemini OCR extraction, and board portal responses without requiring live Cloudflare R2 or Gemini credentials during initial development.

---

### MODULE 4: Seat / Post-Result Verification & Merit Engine

#### 1. Scope & Capabilities
Executes the one-trigger official result gazette import, provides board scraping fallback, calculates dynamic weighted merit aggregates based on customizable policies, resolves ties deterministically, and generates immutable merit snapshots.

#### 2. Technical Approach & Architecture
- **One-Trigger Official Result Processing:**
  - Admin uploads the official board/SEET result gazette PDF.
  - **Step 1 (Streaming Gazette PDF Extraction):**
    - `pdf-parse` reads the PDF text stream sequentially, avoiding high-memory buffer loading.
    - Regular expression patterns extract student records (Roll Number, Candidate Name, Marks, Pass/Fail status).
    - Extracted results are batch-inserted into `mrt_official_results`.
    - Matches entries against `adm_students` using CNIC first, then Roll Number. Backfills verified marks and missing roll numbers.
  - **Step 2 (Targeted Portal Scraping Fallback):**
    - For students still unverified after gazette parsing, targeted HTTP requests (`axios` + `cheerio`) query official online portals.
  - **Step 3 (Manual Queue Routing):**
    - Students who cannot be verified via gazette or portal scraping are marked as `NEEDS_MANUAL_REVIEW` with an audit note.
- **Dynamic Formula Merit Engine:**
  - Reads active weighting coefficients from `mrt_policies`:
    - Matric Weightage ($W_{\text{Matric}}$, default 10%)
    - FSc Weightage ($W_{\text{FSc}}$, default 40%)
    - Entry Test / SEET Weightage ($W_{\text{Test}}$, default 50%)
  - Aggregate calculation formula:
    $$\text{Aggregate} = \left(\frac{\text{Matric Obtained}}{\text{Matric Total}} \times W_{\text{Matric}}\right) + \left(\frac{\text{FSc Obtained}}{\text{FSc Total}} \times W_{\text{FSc}}\right) + \left(\frac{\text{Test Obtained}}{\text{Test Total}} \times W_{\text{Test}}\right)$$
  - Evaluates candidates strictly where `adm_students.overall_status = 'VERIFIED'`.
  - Computes quota distribution across categories defined in the policy (e.g., Open Merit: 70 seats, Regional Quota: 15 seats, Sports Quota: 5 seats).
- **Deterministic Multi-Tier Tie-Breaking Protocol:**
  - When two or more candidates achieve identical aggregate scores to 3 decimal places, the engine evaluates tie-breakers sequentially:
    1. **Tier 1:** Higher Entry Test score (`entry_test_score_used DESC`).
    2. **Tier 2:** Higher FSc score (`fsc_score_used DESC`).
    3. **Tier 3:** Higher Matric score (`matric_score_used DESC`).
    4. **Tier 4:** Candidate age (older candidate prioritized: `dob ASC`).
  - The resolved tier level is recorded in `mrt_entries.tie_break_level` for audit transparency.
- **Immutable Merit Snapshot Architecture:**
  - Calculating a merit list creates an immutable snapshot record in `mrt_snapshots` and associated ranked student rows in `mrt_entries`.
  - Once approved by `SUPER_ADMIN`, `is_locked` is set to `TRUE`. Locked snapshots can never be altered or overwritten.
  - Re-running the merit process (e.g., 2nd Merit List following seat cancellations) creates a new iteration (`iteration_number = 2`), preserving all prior snapshots for audit verification.
  - Exports snapshots directly to Excel and PDF gazettes.
  - Enqueues WhatsApp notification jobs to selected candidates via `outbox_jobs`.

#### 3. Database Slice
- `mrt_official_results` (source_type, board_or_test_name, cnic, roll_no, marks, subject_breakdown JSON)
- `mrt_policies` (name, version, is_active, matric_weightage, fsc_weightage, entry_test_weightage, tie_breaker_rules JSON, quota_definitions JSON)
- `mrt_snapshots` (policy_id, snapshot_title, iteration_number, is_locked, total_students_processed)
- `mrt_entries` (snapshot_id, student_id, merit_position, quota_category, aggregate_score, decision_status, tie_break_level)

#### 4. In/Out Contracts
- **Consumes:** Reads verified records from `adm_students` (`WHERE overall_status = 'VERIFIED'`).
- **Emits:** Enqueues `WHATSAPP_MESSAGE` jobs to notify selected candidates.
- **Exposes:** Routes for PDF gazette upload, policy configuration, dry-run merit calculation, snapshot generation, Excel/PDF export, and notification broadcast.

#### 5. Standalone Mocking Strategy for Developer
The developer building Module 4 uses a seed generator (`src/modules/merit/mocks/seedVerifiedStudents.js`) that creates 100 mock verified students with diverse scores, quotas, and exact score ties to test the merit aggregate and tie-breaking algorithms in complete isolation.

---

## 5. Formal Data Contracts & DTOs for Seamless Integration

Regardless of who implements each module, both developers adhere to these exact JSON event structures:

### 5.1 Outbox Event Payloads (`outbox_jobs.payload`)

#### Event: `WHATSAPP_MESSAGE` (Dispatched by Module 2, 3, or 4)
```json
{
  "recipientPhone": "923001234567",
  "messageType": "TRANSACTIONAL",
  "messageText": "Dear Applicant, your missing documents are required. Please upload them here: https://portal/upload/abc123hash",
  "metadata": {
    "module": "MODULE_3_VERIFICATION",
    "studentId": 1042,
    "tokenId": 58
  }
}
```

#### Event: `PROCESS_OCR_DOCUMENT` (Dispatched by Module 3)
```json
{
  "documentId": 389,
  "studentId": 1042,
  "docType": "FSC_MARKSHEET",
  "r2Key": "uploads/2026/std_1042/fsc_marksheet_v1.jpg",
  "fileMime": "image/jpeg"
}
```

#### Event: `LEAD_QUALIFIED` (Dispatched by Module 2 to Module 3)
```json
{
  "leadId": 4501,
  "fullName": "Muhammad Usman",
  "phoneNormalized": "923001234567",
  "city": "Rawalpindi",
  "priorDegree": "FSC_PRE_ENGINEERING",
  "fscMarks": 940,
  "hasMaths": true
}
```

#### Event: `MIGRATE_GDRIVE` (Dispatched by Module 3 upon verification)
```json
{
  "documentId": 389,
  "studentId": 1042,
  "studentCnic": "3740512345671",
  "filename": "FSC_Marksheet_Muhammad_Usman.jpg",
  "r2Key": "uploads/2026/std_1042/fsc_marksheet_v1.jpg",
  "fileMime": "image/jpeg"
}
```

### 5.2 Read Contract for Merit Calculation (Used by Module 4)
When Module 4 evaluates candidates, it queries `adm_students` adhering strictly to this contract:
- `id` (INT)
- `cnic` (VARCHAR)
- `full_name` (VARCHAR)
- `matric_obtained_marks` (INT)
- `matric_total_marks` (INT, default 1100)
- `fsc_obtained_marks` (INT)
- `fsc_total_marks` (INT, default 1100)
- `overall_status` (ENUM: must be strictly `'VERIFIED'`)

---

## 6. Integration & Wiring Guide (Merging Any Combination)

Because the modules are strictly decoupled, integrating any two developers' work requires only three simple wiring steps:

```
Step 1: Run Staged Migrations
├── 001_core_and_auth.sql (sys_*, outbox_jobs)
├── 002_marketing.sql (mkt_*)
├── 003_intake_and_verification.sql (adm_*)
└── 004_results_and_merit.sql (mrt_*)

Step 2: Mount Module Routers in `src/server.js`
├── app.use('/api/v1/auth', authRoutes);
├── app.use('/api/v1/mkt', marketingRoutes);
├── app.use('/api/v1/adm', admissionRoutes);
└── app.use('/api/v1/mrt', meritRoutes);

Step 3: Register Outbox Event Handlers in `src/core/queue/outboxBus.js`
├── on('WHATSAPP_MESSAGE')      --> baileysWorker.sendMessage()
├── on('LEAD_QUALIFIED')        --> admissionService.createCandidateFromLead()
├── on('PROCESS_OCR_DOCUMENT')  --> geminiOcrWorker.process()
└── on('MIGRATE_GDRIVE')        --> gdriveWorker.migrate()
```

---

## 7. Verification & Production Readiness Checklist

Before moving the system into live admissions operation, verify the following:

- [ ] **Queue Concurrency & Idempotency:** Confirm `SELECT ... FOR UPDATE SKIP LOCKED` allows multiple concurrent polling ticks without picking the same job or causing deadlocks.
- [ ] **OCR Rate-Limit Compliance:** Verify Gemini 2.5 Flash API calls maintain the 4–5 second sequential delay under a batch of 50 documents, resulting in zero HTTP 429 quota errors.
- [ ] **Zero Inode Leakage:** Confirm that uploading documents stores files in Cloudflare R2, and marking them `VERIFIED` transfers them to Google Drive and purges them from R2, leaving zero files on local cPanel disk.
- [ ] **Shared Hosting Memory Threshold:** Monitor Node.js process resident memory under peak batch load to ensure usage remains strictly under 450MB.
- [ ] **WhatsApp Ban Prevention:** Verify that outreach campaigns enforce randomized 12–28 second intervals between message dispatches.
- [ ] **Board Portal Scraping Resilience:** Confirm that portal downtime or slow responses time out gracefully (10s) and route students to the manual review queue without crashing the Node.js application.
- [ ] **Merit Snapshot Immutability:** Verify that once a merit snapshot is locked by an administrator, recalculations produce a new iteration without altering the historical snapshot.
- [ ] **Audit Trail Integrity:** Confirm that all administrative manual adjustments, status overrides, and mark modifications generate unalterable entries in `sys_audit_logs`.

# SE Admissions Automation System

Modular admissions workflow platform designed for Node.js shared hosting and MySQL. The repository starts with the shared API foundation and Module 1 (Auth & Core); later module folders follow the boundaries in `IMPLEMENTATION_PLAN.md`.

## Stack

- Node.js ESM and Express 5 API
- MySQL 8 through the `mysql2/promise` pool (maximum 8–10 connections)
- React + Vite client
- Central maintained SQL schema, routes, services, and contracts
- Shared server core for database access, security, audit logging, and outbox infrastructure

## Project layout

```text
client/                            React + Vite SPA
  src/core/api/                    shared API client; access token stays in memory
  src/modules/{auth,marketing,verification,merit}/
server/                            Express API and MySQL modules
  src/app.js                       Express composition and shared middleware
  src/server.js                    cPanel/Passenger entry point and shutdown
  src/core/{audit,config,db,errors,http,queue,security}/
  src/modules/{auth,marketing,verification,merit}/
  src/contracts/                   shared event names and DTO schemas
  database/
    schema.sql                     maintained complete database definition
  scripts/                         schema setup and Auth bootstrap commands
package.json                       npm workspaces and project commands
```

Backend modules may import shared `server/src/core` services and `server/src/contracts`, but must not import another module's private implementation. Tables use module prefixes and are defined in the central SQL file. Cross-module work is handed off through the shared outbox; direct imports between modules are avoided.

Frontend modules use `client/src/core/api/apiClient.js` for authenticated API requests. It owns the in-memory access token and refresh coordination; do not copy tokens into local storage or build module-specific token handling.

## Database schema workflow

`server/database/schema.sql` is the maintained, complete schema and the single SQL source of truth. `npm run db:setup` applies it to MySQL during initial setup. The running API does not store applicant data in this file; it reads and writes records in the MySQL database created from the schema.

For an existing database, `CREATE TABLE IF NOT EXISTS` will not change existing columns. Review and apply a safe `ALTER TABLE` upgrade before deploying code that requires a schema change, and keep the canonical `schema.sql` updated to match. Details are in `server/database/README.md`.

## Local setup

1. Use Node.js 20.19 or later and MySQL 8.
2. Create the application database and a local development user in MySQL Workbench or the MySQL shell:

   ```sql
   CREATE DATABASE se_admissions CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'se_admissions_app'@'localhost' IDENTIFIED BY 'replace-with-a-local-secret';
   GRANT ALL PRIVILEGES ON se_admissions.* TO 'se_admissions_app'@'localhost';
   ```

3. Copy `server/.env.example` to `server/.env` and set those database values. Generate a JWT secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
4. From the repository root, install dependencies once with `npm install`.
5. Apply the canonical schema to the empty database: `npm run db:setup`.
6. Bootstrap the first administrator once by temporarily setting `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_ADMIN_NAME`, then running `npm run auth:bootstrap-admin`. The command refuses to run once an active super administrator exists. Remove those temporary environment values after use.
7. Run the client and API in separate terminals with `npm run dev:client` and `npm run dev:server`. The Vite client proxies `/api` to the API at port 3000. Build the SPA with `npm run build:client`; deploy `client/dist` to the configured static document root.

Production requires HTTPS, `COOKIE_SECURE=true`, a strong unique JWT secret, and a narrowly configured `APP_ORIGIN`. Set `TRUST_PROXY_HOPS` only to the exact number of trusted reverse proxies in front of the app; leave it at `0` if clients connect directly. Do not commit `.env` or provide secrets in source code. Configure database accounts with only the permissions needed for schema setup and application runtime.

The broad database grant above is for local development only. In production, use a deployment account for `db:setup` and a separate runtime account with only the DML privileges the API needs; do not grant the runtime account `UPDATE` or `DELETE` on `sys_audit_logs`.

## Authentication and authorization

- Public account registration is not provided. A super administrator creates staff accounts.
- Passwords use Node's built-in scrypt KDF with per-password random salts and constant-time verification.
- API access uses 15-minute-or-shorter HS256 JWTs in the `Authorization: Bearer` header. The browser should keep the access token in memory.
- Refresh tokens are random opaque values, stored only as SHA-256 digests, and rotated on every refresh. Reuse of a revoked token invalidates its token family. Refresh credentials use `HttpOnly`, host-only cookies; a matching CSRF cookie/header is required on refresh and logout.
- Password changes require the current password, invalidate all refresh sessions, increment the account token version, and are audited.
- Authentication checks the current account and permission grants in MySQL on each protected request. Tokens are bound to a live database session. Logout, deactivation, password changes, and role changes invalidate active access tokens promptly.
- Authorization is deny-by-default and permission-based. The four seeded roles are `SUPER_ADMIN`, `ADMISSION_OFFICER`, `VERIFIER`, and `AUDITOR`.
- Seeded grants keep the role boundaries clear: `SUPER_ADMIN` receives all registered permissions; `ADMISSION_OFFICER` manages campaigns, merit policies/runs, and relevant read views; `VERIFIER` reviews documents and reissues tokens; `AUDITOR` receives read-only audit, merit, and candidate access.
- Auth routes: `POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`, and `POST /api/v1/auth/change-password`; user/role management is under `/api/v1/auth/users` and `/api/v1/auth/roles` and requires `users.manage`.
- Recovery: if you still control the server but have lost the super-admin password, temporarily set `ADMIN_RESET_EMAIL` and `ADMIN_RESET_PASSWORD`, then run `npm run auth:reset-admin`. It only resets an existing active `SUPER_ADMIN`, revokes their sessions, and writes an audit event. Remove both environment values afterward; never place reset credentials in `.env` or source control.
- Public intake tokens are a separate capability and do not grant an authenticated staff role.

## Operational notes

The initial login limiter uses an in-process store, which suits the planned single Node process on cPanel but resets on restart. Before running multiple application processes or instances, move rate-limit counters to a shared store and use a trusted-proxy configuration appropriate to the host. Audit log writes are append-only at the application API; production database credentials should also deny `UPDATE` and `DELETE` on `sys_audit_logs`.

## Auth tests

Run the fast security and authorization checks with `npm run test:auth`. The MySQL HTTP lifecycle test is included but skips unless explicitly enabled. To run it, create a **separate disposable test database** (for example `se_admissions_auth_test`) and grant your local test user access to it:

```sql
CREATE DATABASE se_admissions_auth_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON se_admissions_auth_test.* TO 'se_admissions_app'@'localhost';
```

Apply the canonical schema to that database, then run the integration test from PowerShell:

```powershell
$env:DB_NAME = "se_admissions_auth_test"
npm run db:setup
Remove-Item Env:DB_NAME
$env:AUTH_INTEGRATION = "1"
$env:AUTH_TEST_DB_HOST = "127.0.0.1"
$env:AUTH_TEST_DB_NAME = "se_admissions_auth_test"
$env:AUTH_TEST_DB_USER = "se_admissions_app"
$env:AUTH_TEST_DB_PASSWORD = "your-local-db-password"
npm run test:auth
```

The integration test exercises login, role permissions, user creation, password change and session revocation, refresh rotation and reuse detection, and logout. Never point this test at production or real applicant data.

See `IMPLEMENTATION_PLAN.md` for module workflows, event contracts, and shared-hosting constraints. See `server/src/modules/auth/README.md` for Auth route contracts and `server/database/README.md` for the SQL workflow.

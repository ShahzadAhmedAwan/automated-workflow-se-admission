# Database schema

`schema.sql` is the one maintained database definition for this project. It defines the tables and seeds the four Auth roles and their initial permissions. The application does not read this file on every request: `npm run db:setup` applies it to MySQL, then the API reads and writes data in that MySQL database.

## Initial setup

1. Create an empty MySQL 8 database and an application account with the required privileges.
2. Put the connection details in `server/.env`.
3. Run `npm run db:setup` from the repository root.
4. Bootstrap the first super administrator with `npm run auth:bootstrap-admin`.

`db:setup` is safe to repeat for the current schema because tables use `CREATE TABLE IF NOT EXISTS` and role grants use idempotent inserts. It does not delete existing data. It also does not alter existing tables when a column definition changes. For a database that already contains data, review and run a deliberate `ALTER TABLE` upgrade before deploying application code that depends on the new structure. Keep `schema.sql` updated as the canonical complete schema after each change.

Use the plan's table prefixes (`sys_*`, `mkt_*`, `adm_*`, `mrt_*`) and keep each module's definitions together in labeled sections of this file. Since this is a shared file, module developers should submit their table changes for integration rather than independently adding competing schema files.

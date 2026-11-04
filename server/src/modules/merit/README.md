# Merit module boundary

Own result ingestion, policy configuration, calculation, snapshots, routes, and mocks here. Add `mrt_*` table definitions to the Merit section of `server/database/schema.sql`. Use `merit.policies.manage`, `merit.run`, and `merit.snapshots.lock` for the matching actions; read-only views use `merit.read`. Preserve locked snapshots.

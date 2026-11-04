import { pool } from '../db/pool.js';

export async function logAudit({ connection = pool, actorId = null, actorType = 'USER', action, entityTable, entityId = null, before = null, after = null, ipAddress = null }) {
  await connection.execute(
    `INSERT INTO sys_audit_logs
      (actor_type, actor_id, event_category, action, entity_table, entity_id, payload_before, payload_after, ip_address)
     VALUES (?, ?, 'AUTHORIZATION', ?, ?, ?, ?, ?, ?)`,
    [actorType, actorId, action, entityTable, entityId, before && JSON.stringify(before), after && JSON.stringify(after), ipAddress],
  );
}

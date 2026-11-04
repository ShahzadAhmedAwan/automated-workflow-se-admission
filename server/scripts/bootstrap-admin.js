import { randomUUID } from 'node:crypto';
import { pool } from '../src/core/db/pool.js';
import { hashPassword } from '../src/core/security/password.js';

const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();

if (!email || !password || !displayName) {
  console.error('Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD, and BOOTSTRAP_ADMIN_NAME for this one-time command.');
  process.exitCode = 1;
} else {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [admins] = await connection.execute(
      `SELECT u.id FROM sys_users u JOIN sys_user_roles ur ON ur.user_id = u.id
       JOIN sys_roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN' AND u.is_active = TRUE FOR UPDATE`,
    );
    if (admins.length) throw new Error('An active super administrator already exists; bootstrap is disabled.');
    const [roles] = await connection.execute("SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN' LIMIT 1");
    if (!roles[0]) throw new Error('Run `npm run db:setup` before bootstrapping an administrator.');
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    await connection.execute(
      'INSERT INTO sys_users (id, email, display_name, password_hash, is_active) VALUES (?, ?, ?, ?, TRUE)',
      [id, email, displayName, passwordHash],
    );
    await connection.execute('INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)', [id, roles[0].id]);
    await connection.execute(
      `INSERT INTO sys_audit_logs (actor_type, event_category, action, entity_table, entity_id, payload_after)
       VALUES ('SYSTEM', 'AUTHORIZATION', 'INITIAL_SUPER_ADMIN_BOOTSTRAPPED', 'sys_users', ?, JSON_OBJECT('email', ?))`,
      [id, email],
    );
    await connection.commit();
    console.info(`Initial super administrator created: ${email}`);
  } catch (error) {
    await connection.rollback();
    console.error('Bootstrap failed:', error.message);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

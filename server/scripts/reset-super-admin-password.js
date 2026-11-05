import { pool } from '../src/core/db/pool.js';
import { hashPassword } from '../src/core/security/password.js';
import { logAudit } from '../src/core/audit/audit-logger.js';

const email = process.env.ADMIN_RESET_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_RESET_PASSWORD;

if (!email || !password) {
  console.error('Set ADMIN_RESET_EMAIL and ADMIN_RESET_PASSWORD temporarily before running this command.');
  process.exitCode = 1;
} else {
  const connection = await pool.getConnection();
  try {
    const passwordHash = await hashPassword(password);
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT u.id, u.email FROM sys_users u
         JOIN sys_user_roles ur ON ur.user_id = u.id
         JOIN sys_roles r ON r.id = ur.role_id
        WHERE u.email = ? AND r.name = 'SUPER_ADMIN' AND u.is_active = TRUE
        FOR UPDATE`, [email],
    );
    const admin = rows[0];
    if (!admin) throw new Error('No active super-admin account exists for that email.');

    await connection.execute(
      `UPDATE sys_users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP(3),
        token_version = token_version + 1 WHERE id = ?`, [passwordHash, admin.id],
    );
    await connection.execute(
      'UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE user_id = ?', [admin.id],
    );
    await logAudit({
      connection,
      actorType: 'SYSTEM',
      action: 'SUPER_ADMIN_PASSWORD_RESET',
      entityTable: 'sys_users',
      entityId: admin.id,
      after: { email: admin.email },
    });
    await connection.commit();
    console.info(`Password reset complete for ${admin.email}. All existing sessions were revoked.`);
  } catch (error) {
    await connection.rollback();
    console.error(`Password reset failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

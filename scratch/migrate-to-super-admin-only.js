import { pool } from '../server/src/core/db/pool.js';

async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [superRoles] = await conn.query("SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN' FOR UPDATE");
    if (!superRoles.length) {
      throw new Error('SUPER_ADMIN role not found in database!');
    }
    const superAdminRoleId = superRoles[0].id;
    console.log(`SUPER_ADMIN role ID: ${superAdminRoleId}`);

    // Update all users to SUPER_ADMIN so no user is orphaned
    const [updateRes] = await conn.query('UPDATE sys_user_roles SET role_id = ? WHERE role_id != ?', [superAdminRoleId, superAdminRoleId]);
    console.log(`Updated user assignments to SUPER_ADMIN: ${updateRes.affectedRows}`);

    // Delete non-SUPER_ADMIN role permissions
    const [delPerms] = await conn.query('DELETE FROM sys_role_permissions WHERE role_id != ?', [superAdminRoleId]);
    console.log(`Deleted non-SUPER_ADMIN role permissions: ${delPerms.affectedRows}`);

    // Delete non-SUPER_ADMIN roles from sys_roles
    const [delRes] = await conn.query("DELETE FROM sys_roles WHERE name != 'SUPER_ADMIN'");
    console.log(`Deleted non-SUPER_ADMIN roles: ${delRes.affectedRows}`);

    await conn.commit();
    console.log('Database migration committed successfully!');

    // Verification queries
    const [remainingRoles] = await pool.query('SELECT * FROM sys_roles');
    console.log('Remaining roles in sys_roles:', remainingRoles);

    const [userRoles] = await pool.query(`
      SELECT u.id, u.email, u.display_name, r.name as role
      FROM sys_users u
      JOIN sys_user_roles ur ON ur.user_id = u.id
      JOIN sys_roles r ON r.id = ur.role_id
    `);
    console.log('Current user assignments in system:', userRoles);

    const [permCount] = await pool.query('SELECT COUNT(*) as count FROM sys_role_permissions WHERE role_id = ?', [superAdminRoleId]);
    console.log(`SUPER_ADMIN total active permissions: ${permCount[0].count}`);
  } catch (err) {
    await conn.rollback();
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate();

import { hashPassword } from '../src/core/security/password.js';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

async function seedAdmin() {
  const conn = await mysql.createConnection({
    host: 'localhost',
    user: 'haseeb',
    password: 'adminisme',
    database: 'automated_admissions_workflow_db',
  });

  const [roles] = await conn.query("SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN'");
  const roleId = roles[0].id;
  const pwdHash = await hashPassword('AdminPass123!');
  const userId = crypto.randomUUID();

  await conn.query(
    `INSERT INTO sys_users (id, email, display_name, password_hash)
     VALUES (?, 'admin@admissions.local', 'Haseeb Admin', ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [userId, pwdHash]
  );

  await conn.query(
    `INSERT INTO sys_user_roles (user_id, role_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE role_id = VALUES(role_id)`,
    [userId, roleId]
  );

  console.log('✅ Super Admin Created:');
  console.log('Email:    admin@admissions.local');
  console.log('Password: AdminPass123!');
  await conn.end();
}

seedAdmin().catch(console.error);

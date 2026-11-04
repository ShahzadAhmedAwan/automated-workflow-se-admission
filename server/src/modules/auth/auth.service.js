import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pool } from '../../core/db/pool.js';
import { config } from '../../core/config/env.js';
import { AppError } from '../../core/errors/app-error.js';
import { logAudit } from '../../core/audit/audit-logger.js';
import { createOpaqueToken, createAccessToken, digestToken } from '../../core/security/tokens.js';
import { hashPassword, verifyPassword } from '../../core/security/password.js';

const unauthorized = () => new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
const dummyPasswordHash = hashPassword('InvalidAccountPassword8K');

async function getUserByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.display_name, u.password_hash, u.is_active, u.token_version,
            r.name AS role
       FROM sys_users u JOIN sys_user_roles ur ON ur.user_id = u.id
       JOIN sys_roles r ON r.id = ur.role_id
      WHERE u.email = ? LIMIT 1`, [email],
  );
  return rows[0] ?? null;
}

async function getPermissions(userId) {
  const [rows] = await pool.execute(
    `SELECT p.name FROM sys_user_roles ur
       JOIN sys_role_permissions rp ON rp.role_id = ur.role_id
       JOIN sys_permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = ? ORDER BY p.name`, [userId],
  );
  return rows.map((row) => row.name);
}

function equalToken(left, right) {
  const a = Buffer.from(left ?? '');
  const b = Buffer.from(right ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function issueSession(connection, { userId, familyId = randomUUID() }) {
  const refreshToken = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_MS);
  await connection.execute(
    `INSERT INTO sys_auth_sessions (id, family_id, user_id, refresh_token_hash, csrf_token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [sessionId, familyId, userId, digestToken(refreshToken), digestToken(csrfToken), expiresAt],
  );
  return { refreshToken, csrfToken, expiresAt, sessionId };
}

async function sessionResponse(user, session) {
  const permissions = await getPermissions(user.id);
  const accessToken = await createAccessToken(user, session.sessionId);
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role, permissions },
    ...session,
  };
}

export async function login({ email, password, ipAddress }) {
  const user = await getUserByEmail(email);
  const hashToCheck = user?.password_hash ?? await dummyPasswordHash;
  const valid = await verifyPassword(password, hashToCheck);
  if (!user || !valid || !user.is_active) {
    await logAudit({ actorType: 'ANONYMOUS', action: 'AUTH_LOGIN_FAILED', entityTable: 'sys_users', after: { email }, ipAddress });
    throw unauthorized();
  }
  await pool.execute('UPDATE sys_users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [user.id]);
  const connection = await pool.getConnection();
  let session;
  try {
    await connection.beginTransaction();
    session = await issueSession(connection, { userId: user.id });
    await logAudit({ connection, actorId: user.id, action: 'AUTH_LOGIN_SUCCEEDED', entityTable: 'sys_users', entityId: user.id, ipAddress });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return sessionResponse(user, session);
}

export async function rotateRefreshSession({ refreshToken, csrfToken, ipAddress }) {
  if (!refreshToken || !csrfToken) throw unauthorized();
  const connection = await pool.getConnection();
  let user;
  let rotated;
  let reuseDetected = false;
  let sessionUserId = null;
  try {
    await connection.beginTransaction();
    const [sessions] = await connection.execute(
      `SELECT s.id, s.family_id, s.user_id, s.csrf_token_hash, s.expires_at, s.revoked_at,
              u.email, u.display_name, u.is_active, u.token_version, r.name AS role
         FROM sys_auth_sessions s JOIN sys_users u ON u.id = s.user_id
         JOIN sys_user_roles ur ON ur.user_id = u.id JOIN sys_roles r ON r.id = ur.role_id
        WHERE s.refresh_token_hash = ? FOR UPDATE`, [digestToken(refreshToken)],
    );
    const current = sessions[0];
    if (!current) throw unauthorized();
    sessionUserId = current.user_id;
    if (current.revoked_at) {
      reuseDetected = true;
      await connection.execute(
        'UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE family_id = ?',
        [current.family_id],
      );
      await logAudit({ connection, actorId: sessionUserId, action: 'AUTH_REFRESH_REUSE_DETECTED', entityTable: 'sys_auth_sessions', entityId: current.id, ipAddress });
    } else if (!equalToken(digestToken(csrfToken), current.csrf_token_hash)) {
      throw new AppError(403, 'CSRF_VALIDATION_FAILED', 'The request could not be verified.');
    } else if (!current.is_active || new Date(current.expires_at).getTime() <= Date.now()) {
      await connection.execute(
        'UPDATE sys_auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE family_id = ?',
        [current.family_id],
      );
    } else {
      await connection.execute(
        'UPDATE sys_auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3), last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [current.id],
      );
      rotated = await issueSession(connection, { userId: current.user_id, familyId: current.family_id });
      user = current;
      await logAudit({ connection, actorId: user.id, action: 'AUTH_REFRESH_ROTATED', entityTable: 'sys_auth_sessions', entityId: current.id, ipAddress });
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error instanceof AppError) throw error;
    throw error;
  } finally {
    connection.release();
  }
  if (reuseDetected) {
    throw unauthorized();
  }
  if (!rotated) throw unauthorized();
  return sessionResponse(user, rotated);
}

export async function revokeRefreshSession({ refreshToken, csrfToken, ipAddress }) {
  if (!refreshToken || !csrfToken) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id, user_id, family_id, csrf_token_hash FROM sys_auth_sessions WHERE refresh_token_hash = ? FOR UPDATE',
      [digestToken(refreshToken)],
    );
    const session = rows[0];
    if (!session || !equalToken(digestToken(csrfToken), session.csrf_token_hash)) {
      await connection.rollback();
      return;
    }
    await connection.execute(
      'UPDATE sys_auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE family_id = ?', [session.family_id],
    );
    await logAudit({ connection, actorId: session.user_id, action: 'AUTH_LOGOUT', entityTable: 'sys_auth_sessions', entityId: session.id, ipAddress });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getCurrentUser(userId, sessionId) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.display_name, u.token_version, r.name AS role
       FROM sys_users u JOIN sys_auth_sessions s ON s.user_id = u.id
       JOIN sys_user_roles ur ON ur.user_id = u.id
       JOIN sys_roles r ON r.id = ur.role_id
      WHERE u.id = ? AND s.id = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP(3)
        AND u.is_active = TRUE`, [userId, sessionId],
  );
  const user = rows[0];
  if (!user) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  return { ...user, permissions: await getPermissions(userId) };
}

export async function changePassword(userId, currentPassword, newPassword, ipAddress) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT password_hash FROM sys_users WHERE id = ? AND is_active = TRUE LIMIT 1 FOR UPDATE', [userId],
    );
    const currentHash = rows[0]?.password_hash;
    if (!currentHash || !(await verifyPassword(currentPassword, currentHash))) {
      throw new AppError(400, 'CURRENT_PASSWORD_INVALID', 'The current password is incorrect.');
    }
    if (await verifyPassword(newPassword, currentHash)) {
      throw new AppError(400, 'PASSWORD_UNCHANGED', 'Choose a password different from your current password.');
    }
    const nextHash = await hashPassword(newPassword);
    await connection.execute(
      `UPDATE sys_users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP(3),
        token_version = token_version + 1 WHERE id = ?`, [nextHash, userId],
    );
    await connection.execute(
      'UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE user_id = ?', [userId],
    );
    await logAudit({ connection, actorId: userId, action: 'USER_PASSWORD_CHANGED', entityTable: 'sys_users', entityId: userId, ipAddress });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return { changed: true };
}

export async function createUser(input, actorId, ipAddress) {
  const passwordHash = await hashPassword(input.password);
  const id = randomUUID();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [roles] = await connection.execute('SELECT id FROM sys_roles WHERE name = ? LIMIT 1', [input.role]);
    if (!roles[0]) throw new AppError(400, 'INVALID_ROLE', 'The requested role is not configured.');
    await connection.execute(
      `INSERT INTO sys_users (id, email, display_name, password_hash, is_active)
       VALUES (?, ?, ?, ?, TRUE)`, [id, input.email, input.displayName, passwordHash],
    );
    await connection.execute('INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)', [id, roles[0].id]);
    await logAudit({ connection, actorId, action: 'USER_CREATED', entityTable: 'sys_users', entityId: id, after: { email: input.email, role: input.role }, ipAddress });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'A user with this email already exists.');
    throw error;
  } finally {
    connection.release();
  }
  return { id, email: input.email, displayName: input.displayName, role: input.role, isActive: true };
}

export async function listUsers({ limit = 50, cursor = null }) {
  const [rows] = await pool.execute(
    `SELECT u.id, u.email, u.display_name AS displayName, u.is_active AS isActive,
            r.name AS role, u.created_at AS createdAt
       FROM sys_users u JOIN sys_user_roles ur ON ur.user_id = u.id
       JOIN sys_roles r ON r.id = ur.role_id
      WHERE (? IS NULL OR u.id > ?)
      ORDER BY u.id LIMIT ?`, [cursor, cursor, limit],
  );
  return rows;
}

export async function listRoles() {
  const [rows] = await pool.execute(
    `SELECT r.name, r.description, p.name AS permission
       FROM sys_roles r LEFT JOIN sys_role_permissions rp ON rp.role_id = r.id
       LEFT JOIN sys_permissions p ON p.id = rp.permission_id
      ORDER BY r.name, p.name`,
  );
  const roles = new Map();
  for (const row of rows) {
    if (!roles.has(row.name)) roles.set(row.name, { name: row.name, description: row.description, permissions: [] });
    if (row.permission) roles.get(row.name).permissions.push(row.permission);
  }
  return [...roles.values()];
}

export async function updateUser(userId, changes, actorId, ipAddress) {
  if (userId === actorId && (changes.isActive === false || changes.role && changes.role !== 'SUPER_ADMIN')) {
    throw new AppError(400, 'SELF_LOCKOUT_PREVENTED', 'You cannot deactivate or demote your own account.');
  }
  const connection = await pool.getConnection();
  let before;
  let after;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT u.id, u.email, u.is_active, r.name AS role
         FROM sys_users u JOIN sys_user_roles ur ON ur.user_id = u.id
         JOIN sys_roles r ON r.id = ur.role_id WHERE u.id = ? FOR UPDATE`, [userId],
    );
    before = rows[0];
    if (!before) throw new AppError(404, 'USER_NOT_FOUND', 'The user was not found.');
    const nextRole = changes.role ?? before.role;
    const nextActive = changes.isActive ?? Boolean(before.is_active);
    if (before.role === 'SUPER_ADMIN' && (nextRole !== 'SUPER_ADMIN' || !nextActive)) {
      await connection.execute("SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN' FOR UPDATE");
      const [activeAdmins] = await connection.execute(
        `SELECT u.id FROM sys_users u
           JOIN sys_user_roles ur ON ur.user_id = u.id JOIN sys_roles r ON r.id = ur.role_id
          WHERE r.name = 'SUPER_ADMIN' AND u.is_active = TRUE ORDER BY u.id FOR UPDATE`,
      );
      if (activeAdmins.length <= 1) throw new AppError(409, 'LAST_SUPER_ADMIN', 'At least one active super administrator must remain.');
    }
    if (changes.role) {
      const [roles] = await connection.execute('SELECT id FROM sys_roles WHERE name = ? LIMIT 1', [changes.role]);
      if (!roles[0]) throw new AppError(400, 'INVALID_ROLE', 'The requested role is not configured.');
      await connection.execute('DELETE FROM sys_user_roles WHERE user_id = ?', [userId]);
      await connection.execute('INSERT INTO sys_user_roles (user_id, role_id) VALUES (?, ?)', [userId, roles[0].id]);
    }
    await connection.execute(
      'UPDATE sys_users SET is_active = ?, token_version = token_version + 1 WHERE id = ?', [nextActive, userId],
    );
    if (!nextActive || changes.role) {
      await connection.execute(
        'UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE user_id = ?', [userId],
      );
    }
    after = { id: userId, email: before.email, role: nextRole, isActive: nextActive };
    await logAudit({ connection, actorId, action: 'USER_UPDATED', entityTable: 'sys_users', entityId: userId, before, after, ipAddress });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return after;
}

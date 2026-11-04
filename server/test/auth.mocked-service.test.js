import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

// Setup test env variables before imports
Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_ORIGIN: 'http://localhost:5173',
  API_BASE_PATH: '/api/v1',
  TRUST_PROXY_HOPS: '0',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'se_admissions_test',
  DB_USER: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_CONNECTION_LIMIT: '2',
  DB_SSL: 'false',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  JWT_ISSUER: 'se-admissions-test',
  JWT_AUDIENCE: 'se-admissions-test-client',
  ACCESS_TOKEN_TTL_SECONDS: '300',
  REFRESH_TOKEN_TTL_DAYS: '1',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'strict',
});

const { pool } = await import('../src/core/db/pool.js');
const { hashPassword } = await import('../src/core/security/password.js');
const { digestToken } = await import('../src/core/security/tokens.js');
const auth = await import('../src/modules/auth/auth.service.js');
const { EVENT_TYPES } = await import('../src/contracts/event-types.js');
const {
  sendUserWelcomeEmail,
  generateUserWelcomeContent,
  getSentEmails,
  clearSentEmails,
  resetTransporter,
} = await import('../src/core/mail/mailer.js');

// Mock harness
let mockHandler = null;

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;

pool.execute = async (sql, params) => {
  if (mockHandler) {
    const res = await mockHandler(sql, params);
    if (res !== undefined) return res;
  }
  return originalExecute.call(pool, sql, params);
};

pool.getConnection = async () => {
  const mockConn = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    execute: async (sql, params) => {
      if (mockHandler) {
        const res = await mockHandler(sql, params);
        if (res !== undefined) return res;
      }
      return [[]];
    },
  };
  return mockConn;
};

test.after(() => {
  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
  resetTransporter();
});

test.beforeEach(() => {
  clearSentEmails();
});

// ---------------------------------------------------------
// 1. LOGIN SERVICE TESTS
// ---------------------------------------------------------
test('auth.service.login: successful login returns tokens and session', async () => {
  const dummyPassword = 'CorrectPassword2026';
  const hashedPassword = await hashPassword(dummyPassword);
  const userId = randomUUID();

  mockHandler = async (sql, params) => {
    if (sql.includes('FROM sys_users u JOIN sys_user_roles ur')) {
      return [[{
        id: userId,
        email: 'admin@example.com',
        display_name: 'Admin User',
        password_hash: hashedPassword,
        is_active: 1,
        token_version: 0,
        role: 'SUPER_ADMIN',
      }]];
    }
    if (sql.includes('UPDATE sys_users SET last_login_at')) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO sys_auth_sessions')) {
      return [{ insertId: 1 }];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) {
      return [{ insertId: 1 }];
    }
    if (sql.includes('SELECT p.name FROM sys_user_roles')) {
      return [[{ name: 'settings.manage' }, { name: 'users.manage' }]];
    }
    return [[]];
  };

  const session = await auth.login({
    email: 'admin@example.com',
    password: dummyPassword,
    ipAddress: '127.0.0.1',
  });

  assert.ok(session.accessToken);
  assert.ok(session.refreshToken);
  assert.ok(session.csrfToken);
  assert.equal(session.user.id, userId);
  assert.equal(session.user.email, 'admin@example.com');
  assert.equal(session.user.displayName, 'Admin User');
  assert.equal(session.user.role, 'SUPER_ADMIN');
  assert.deepEqual(session.user.permissions, ['settings.manage', 'users.manage']);
});

test('auth.service.login: wrong password or deactivated account throws INVALID_CREDENTIALS', async () => {
  const dummyPassword = 'CorrectPassword2026';
  const hashedPassword = await hashPassword(dummyPassword);

  // Case A: Wrong password
  mockHandler = async (sql) => {
    if (sql.includes('FROM sys_users u JOIN sys_user_roles ur')) {
      return [[{
        id: 'user-1', email: 'test@example.com', display_name: 'User 1',
        password_hash: hashedPassword, is_active: 1, token_version: 0, role: 'AUDITOR',
      }]];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 1 }];
    return [[]];
  };

  await assert.rejects(
    async () => auth.login({ email: 'test@example.com', password: 'WrongPassword2026', ipAddress: '127.0.0.1' }),
    (err) => err.status === 401 && err.code === 'INVALID_CREDENTIALS',
    'wrong password returns 401 INVALID_CREDENTIALS'
  );

  // Case B: Inactive account
  mockHandler = async (sql) => {
    if (sql.includes('FROM sys_users u JOIN sys_user_roles ur')) {
      return [[{
        id: 'user-2', email: 'inactive@example.com', display_name: 'User 2',
        password_hash: hashedPassword, is_active: 0, token_version: 0, role: 'AUDITOR',
      }]];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 1 }];
    return [[]];
  };

  await assert.rejects(
    async () => auth.login({ email: 'inactive@example.com', password: dummyPassword, ipAddress: '127.0.0.1' }),
    (err) => err.status === 401 && err.code === 'INVALID_CREDENTIALS',
    'inactive account returns 401 INVALID_CREDENTIALS'
  );
});

// ---------------------------------------------------------
// 2. REFRESH ROTATION & REUSE ATTACK DETECTION
// ---------------------------------------------------------
test('auth.service.rotateRefreshSession: detects refresh token reuse and revokes entire session family', async () => {
  const stolenRefreshToken = 'stolen-refresh-token';
  const stolenCsrfToken = 'stolen-csrf-token';
  const familyId = randomUUID();
  let familyRevoked = false;

  mockHandler = async (sql, params) => {
    if (sql.includes('FROM sys_auth_sessions s JOIN sys_users u')) {
      return [[{
        id: 'session-old',
        family_id: familyId,
        user_id: 'user-victim',
        csrf_token_hash: digestToken(stolenCsrfToken),
        expires_at: new Date(Date.now() + 100000),
        revoked_at: new Date(Date.now() - 5000),
        email: 'victim@example.com',
        display_name: 'Victim',
        is_active: 1,
        token_version: 1,
        role: 'AUDITOR',
      }]];
    }
    if (sql.includes('UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE family_id = ?')) {
      if (params[0] === familyId) familyRevoked = true;
      return [{ affectedRows: 2 }];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) {
      assert.equal(params[2], 'AUTH_REFRESH_REUSE_DETECTED');
      return [{ insertId: 1 }];
    }
    return [[]];
  };

  await assert.rejects(
    async () => auth.rotateRefreshSession({
      refreshToken: stolenRefreshToken,
      csrfToken: stolenCsrfToken,
      ipAddress: '127.0.0.1',
    }),
    (err) => err.status === 401 && err.code === 'INVALID_CREDENTIALS'
  );

  assert.equal(familyRevoked, true, 'the entire session family was revoked upon reuse detection');
});

test('auth.service.rotateRefreshSession: enforces CSRF token matching against database hash', async () => {
  const validRefreshToken = 'valid-refresh-token';
  const legitimateCsrf = 'correct-csrf-token';
  const wrongCsrf = 'wrong-csrf-token';

  mockHandler = async (sql) => {
    if (sql.includes('FROM sys_auth_sessions s JOIN sys_users u')) {
      return [[{
        id: 'session-active',
        family_id: 'family-1',
        user_id: 'user-1',
        csrf_token_hash: digestToken(legitimateCsrf),
        expires_at: new Date(Date.now() + 100000),
        revoked_at: null,
        email: 'user@example.com',
        display_name: 'User',
        is_active: 1,
        token_version: 1,
        role: 'AUDITOR',
      }]];
    }
    return [[]];
  };

  await assert.rejects(
    async () => auth.rotateRefreshSession({
      refreshToken: validRefreshToken,
      csrfToken: wrongCsrf,
      ipAddress: '127.0.0.1',
    }),
    (err) => err.status === 403 && err.code === 'CSRF_VALIDATION_FAILED'
  );
});

// ---------------------------------------------------------
// 3. VERIFYING DEFECT FIXES: CONTRACT INTEGRITY & PERMISSIONS
// ---------------------------------------------------------
test('VERIFY FIX: auth.service.getCurrentUser consistently returns camelCase displayName', async () => {
  mockHandler = async (sql) => {
    if (sql.includes('FROM sys_users u JOIN sys_auth_sessions s')) {
      return [[{
        id: 'u-1',
        email: 'user@example.com',
        displayName: 'Display Name',
        token_version: 0,
        role: 'AUDITOR',
      }]];
    }
    if (sql.includes('SELECT p.name FROM sys_user_roles')) {
      return [[{ name: 'audit.read' }]];
    }
    return [[]];
  };

  const user = await auth.getCurrentUser('u-1', 's-1');
  assert.equal(user.displayName, 'Display Name', 'returns standardized camelCase displayName');
  assert.equal(user.display_name, undefined, 'snake_case display_name is not exposed');
});

test('VERIFY FIX: auth.service.updateUser permits modifying an already-inactive super admin', async () => {
  const inactiveAdminId = randomUUID();
  const callerId = randomUUID();
  let roleUpdated = false;

  mockHandler = async (sql, params) => {
    if (sql.includes('WHERE u.id = ? FOR UPDATE')) {
      return [[{
        id: inactiveAdminId,
        email: 'inactive-admin@example.com',
        displayName: 'Old Admin',
        is_active: 0, // Inactive
        role: 'SUPER_ADMIN',
      }]];
    }
    if (sql.includes('SELECT id FROM sys_roles WHERE name = ?')) {
      return [[{ id: 4 }]]; // AUDITOR role ID
    }
    if (sql.includes('DELETE FROM sys_user_roles')) return [{ affectedRows: 1 }];
    if (sql.includes('INSERT INTO sys_user_roles')) {
      roleUpdated = true;
      return [{ insertId: 1 }];
    }
    if (sql.includes('UPDATE sys_users SET is_active = ?')) return [{ affectedRows: 1 }];
    if (sql.includes('UPDATE sys_auth_sessions SET revoked_at')) return [{ affectedRows: 0 }];
    if (sql.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 1 }];
    return [[]];
  };

  // Changing role of the already-inactive super admin should now succeed without triggering LAST_SUPER_ADMIN
  const updated = await auth.updateUser(inactiveAdminId, { role: 'AUDITOR' }, callerId, '127.0.0.1');
  assert.equal(updated.role, 'AUDITOR');
  assert.equal(roleUpdated, true);
});

test('auth.service.updateUser: prevents self-lockout and demoting the only active super admin', async () => {
  const adminId = randomUUID();

  // 1. Self lockout
  await assert.rejects(
    async () => auth.updateUser(adminId, { isActive: false }, adminId, '127.0.0.1'),
    (err) => err.status === 400 && err.code === 'SELF_LOCKOUT_PREVENTED'
  );
  await assert.rejects(
    async () => auth.updateUser(adminId, { role: 'AUDITOR' }, adminId, '127.0.0.1'),
    (err) => err.status === 400 && err.code === 'SELF_LOCKOUT_PREVENTED'
  );

  // 2. Demoting the only active super admin (by another user if possible)
  mockHandler = async (sql) => {
    if (sql.includes('WHERE u.id = ? FOR UPDATE')) {
      return [[{ id: adminId, email: 'admin@example.com', displayName: 'Admin', is_active: 1, role: 'SUPER_ADMIN' }]];
    }
    if (sql.includes("SELECT id FROM sys_roles WHERE name = 'SUPER_ADMIN' FOR UPDATE")) {
      return [[{ id: 1 }]];
    }
    if (sql.includes("WHERE r.name = 'SUPER_ADMIN' AND u.is_active = TRUE ORDER BY u.id FOR UPDATE")) {
      return [[{ id: adminId }]]; // Only 1 active super admin
    }
    return [[]];
  };

  await assert.rejects(
    async () => auth.updateUser(adminId, { isActive: false }, 'other-caller', '127.0.0.1'),
    (err) => err.status === 409 && err.code === 'LAST_SUPER_ADMIN'
  );
});

// ---------------------------------------------------------
// 4. WELCOME EMAIL NOTIFICATION & OUTBOX INTEGRATION
// ---------------------------------------------------------
test('EMAIL NOTIFICATION: createUser dispatches transactional welcome email with role and credentials', async () => {
  let outboxDispatched = false;
  let dispatchedPayload = null;

  mockHandler = async (sql, params) => {
    if (sql.includes('SELECT id FROM sys_roles WHERE name = ?')) {
      return [[{ id: 2 }]]; // ADMISSION_OFFICER
    }
    if (sql.includes('INSERT INTO sys_users')) return [{ insertId: 1 }];
    if (sql.includes('INSERT INTO sys_user_roles')) return [{ insertId: 1 }];
    if (sql.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 1 }];
    if (sql.includes('INSERT INTO outbox_jobs')) {
      outboxDispatched = true;
      assert.equal(params[0], 'email');
      assert.equal(params[1], EVENT_TYPES.USER_WELCOME_EMAIL);
      dispatchedPayload = JSON.parse(params[2]);
      return [{ insertId: 101 }];
    }
    return [[]];
  };

  const newUser = await auth.createUser({
    email: 'new.officer@domain.edu',
    password: 'InitialPassword2026',
    role: 'ADMISSION_OFFICER',
    displayName: 'Admission Officer Jane',
  }, 'super-admin-id', '127.0.0.1');

  assert.ok(newUser.id);
  assert.equal(newUser.email, 'new.officer@domain.edu');
  assert.equal(newUser.displayName, 'Admission Officer Jane');
  assert.equal(newUser.role, 'ADMISSION_OFFICER');

  assert.equal(outboxDispatched, true, 'welcome email job was committed to outbox');
  assert.equal(dispatchedPayload.email, 'new.officer@domain.edu');
  assert.equal(dispatchedPayload.displayName, 'Admission Officer Jane');
  assert.equal(dispatchedPayload.role, 'ADMISSION_OFFICER');
  assert.equal(dispatchedPayload.initialPassword, 'InitialPassword2026');
  assert.ok(dispatchedPayload.loginUrl);
});

test('EMAIL NOTIFICATION: generateUserWelcomeContent creates tailored text and HTML for all roles', () => {
  const roles = ['SUPER_ADMIN', 'ADMISSION_OFFICER', 'VERIFIER', 'AUDITOR'];

  for (const role of roles) {
    const { subject, text, html } = generateUserWelcomeContent({
      email: `${role.toLowerCase()}@example.com`,
      displayName: `Staff ${role}`,
      role,
      initialPassword: 'TempPassword2026',
      loginUrl: 'http://localhost:5173',
    });

    assert.ok(subject.includes('Welcome to SE Admissions'));
    assert.ok(text.includes(`Staff ${role}`));
    assert.ok(text.includes('TempPassword2026'));
    assert.ok(text.includes(`${role.toLowerCase()}@example.com`));
    assert.ok(text.includes('SECURITY NOTICE'));
    assert.ok(html.includes('TempPassword2026'));
    assert.ok(html.includes('Assigned Role:'));
  }
});

test('EMAIL NOTIFICATION: sendUserWelcomeEmail delivers via mailer transport', async () => {
  clearSentEmails();

  await sendUserWelcomeEmail({
    userId: randomUUID(),
    email: 'recipient@domain.edu',
    displayName: 'Verifier John',
    role: 'VERIFIER',
    initialPassword: 'VerifierSecure2026',
    loginUrl: 'http://localhost:5173',
  });

  const sent = getSentEmails();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'recipient@domain.edu');
  assert.ok(sent[0].subject.includes('Verification Officer'));
  assert.ok(sent[0].text.includes('VerifierSecure2026'));
  assert.ok(sent[0].html.includes('Verification Officer'));
});

// ---------------------------------------------------------
// 5. PASSWORD CHANGE & USER MANAGEMENT TESTS
// ---------------------------------------------------------
test('auth.service.changePassword: verifies current password, blocks reuse, and revokes all sessions', async () => {
  const userId = randomUUID();
  const currentPassword = 'CurrentPassword123';
  const newPassword = 'NewSecurePassword123';
  const currentHash = await hashPassword(currentPassword);
  let sessionsRevoked = false;
  let tokenVersionIncremented = false;

  mockHandler = async (sql) => {
    if (sql.includes('SELECT password_hash FROM sys_users WHERE id = ?')) {
      return [[{ password_hash: currentHash }]];
    }
    if (sql.includes('UPDATE sys_users SET password_hash = ?')) {
      tokenVersionIncremented = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE sys_auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP(3)) WHERE user_id = ?')) {
      sessionsRevoked = true;
      return [{ affectedRows: 3 }];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) {
      return [{ insertId: 1 }];
    }
    return [[]];
  };

  // 1. Wrong current password
  await assert.rejects(
    async () => auth.changePassword(userId, 'IncorrectCurrent123', newPassword, '127.0.0.1'),
    (err) => err.status === 400 && err.code === 'CURRENT_PASSWORD_INVALID'
  );

  // 2. Unchanged password
  await assert.rejects(
    async () => auth.changePassword(userId, currentPassword, currentPassword, '127.0.0.1'),
    (err) => err.status === 400 && err.code === 'PASSWORD_UNCHANGED'
  );

  // 3. Valid change
  const res = await auth.changePassword(userId, currentPassword, newPassword, '127.0.0.1');
  assert.equal(res.changed, true);
  assert.equal(tokenVersionIncremented, true, 'token_version was incremented');
  assert.equal(sessionsRevoked, true, 'all existing sessions were revoked');
});

test('auth.service.revokeRefreshSession: revokes session family only when CSRF matches', async () => {
  const refreshToken = 'valid-token';
  const csrfToken = 'valid-csrf';
  const familyId = randomUUID();
  let familyRevoked = false;

  mockHandler = async (sql, params) => {
    if (sql.includes('FROM sys_auth_sessions WHERE refresh_token_hash = ?')) {
      return [[{
        id: 's-1',
        user_id: 'u-1',
        family_id: familyId,
        csrf_token_hash: digestToken(csrfToken),
      }]];
    }
    if (sql.includes('UPDATE sys_auth_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE family_id = ?')) {
      if (params[0] === familyId) familyRevoked = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('INSERT INTO sys_audit_logs')) return [{ insertId: 1 }];
    return [[]];
  };

  // Mismatched CSRF -> does NOT revoke
  await auth.revokeRefreshSession({ refreshToken, csrfToken: 'wrong-csrf', ipAddress: '127.0.0.1' });
  assert.equal(familyRevoked, false, 'session was not revoked on mismatched CSRF');

  // Matching CSRF -> revokes
  await auth.revokeRefreshSession({ refreshToken, csrfToken, ipAddress: '127.0.0.1' });
  assert.equal(familyRevoked, true, 'session family was revoked on valid CSRF');
});

test('auth.service.listRoles: aggregates role permissions into array', async () => {
  mockHandler = async () => {
    return [[
      { name: 'SUPER_ADMIN', description: 'Admin', permission: 'users.manage' },
      { name: 'SUPER_ADMIN', description: 'Admin', permission: 'settings.manage' },
      { name: 'AUDITOR', description: 'Auditor', permission: 'audit.read' },
      { name: 'EMPTY_ROLE', description: 'Empty', permission: null },
    ]];
  };

  const roles = await auth.listRoles();
  assert.equal(roles.length, 3);

  const superAdmin = roles.find((r) => r.name === 'SUPER_ADMIN');
  assert.deepEqual(superAdmin.permissions, ['users.manage', 'settings.manage']);

  const emptyRole = roles.find((r) => r.name === 'EMPTY_ROLE');
  assert.deepEqual(emptyRole.permissions, []);
});

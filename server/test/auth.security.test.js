import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

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

const [{ hashPassword, verifyPassword, validatePassword }, { createAccessToken, verifyAccessToken }, schemas, constants, middleware] = await Promise.all([
  import('../src/core/security/password.js'),
  import('../src/core/security/tokens.js'),
  import('../src/modules/auth/auth.schemas.js'),
  import('../src/modules/auth/auth.constants.js'),
  import('../src/modules/auth/auth.middleware.js'),
]);

test('HTTP routes start, reject anonymous access, and enforce CSRF before touching the database', async () => {
  const { createApp } = await import('../src/app.js');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const live = await fetch(`${baseUrl}/api/v1/health/live`);
    assert.equal(live.status, 200);

    const anonymous = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, 'AUTHENTICATION_REQUIRED');

    const anonymousPatch = await fetch(`${baseUrl}/api/v1/auth/users/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(anonymousPatch.status, 401);
    assert.equal((await anonymousPatch.json()).error.code, 'AUTHENTICATION_REQUIRED');

    const missingCsrf = await fetch(`${baseUrl}/api/v1/auth/refresh`, { method: 'POST' });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error.code, 'CSRF_VALIDATION_FAILED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('password policy rejects weak values and scrypt verification distinguishes matches', async () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('alllowercase123'), false);
  const encoded = await hashPassword('SecureExample2026');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('SecureExample2026', encoded), true);
  assert.equal(await verifyPassword('IncorrectExample2026', encoded), false);
});

test('access JWTs are signed with the configured audience, issuer and session binding', async () => {
  const token = await createAccessToken({ id: 'user-123', email: 'admin@example.com', token_version: 4 }, 'session-456');
  const { payload, protectedHeader } = await verifyAccessToken(token);
  assert.equal(protectedHeader.alg, 'HS256');
  assert.equal(payload.sub, 'user-123');
  assert.equal(payload.sid, 'session-456');
  assert.equal(payload.tokenVersion, 4);
  assert.equal(payload.iss, 'se-admissions-test');
});

test('auth request schemas constrain login, role assignment and password changes', () => {
  assert.equal(schemas.loginSchema.safeParse({ email: 'ADMIN@EXAMPLE.COM', password: 'anything' }).data.email, 'admin@example.com');
  assert.equal(schemas.loginSchema.safeParse({ email: 'bad', password: 'pw' }).success, false);
  assert.equal(schemas.createUserSchema.safeParse({ email: 'new@example.com', password: 'SecureExample2026', role: 'AUDITOR', displayName: 'Auditor' }).success, true);
  assert.equal(schemas.createUserSchema.safeParse({ email: 'new@example.com', password: 'SecureExample2026', role: 'ROOT', displayName: 'User' }).success, false);
  assert.equal(schemas.changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'SecureExample2026' }).success, true);
});

test('permission middleware allows granted permissions and denies missing permissions', () => {
  const guard = middleware.requirePermission(constants.PERMISSIONS.USERS_MANAGE);
  let allowed;
  guard({ auth: { permissions: new Set(['users.manage']) } }, {}, (error) => { allowed = error; });
  assert.equal(allowed, undefined);

  let denied;
  guard({ auth: { permissions: new Set(['audit.read']) } }, {}, (error) => { denied = error; });
  assert.equal(denied?.status, 403);
  assert.equal(denied?.code, 'FORBIDDEN');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

const enabled = process.env.AUTH_INTEGRATION === '1';

test('Auth HTTP lifecycle with MySQL', { skip: enabled ? false : 'Set AUTH_INTEGRATION=1 and use a dedicated test database.' , timeout: 60_000 }, async () => {
  const required = ['AUTH_TEST_DB_HOST', 'AUTH_TEST_DB_NAME', 'AUTH_TEST_DB_USER', 'AUTH_TEST_DB_PASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  assert.deepEqual(missing, [], `Missing integration settings: ${missing.join(', ')}`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '0',
    APP_ORIGIN: 'http://localhost:5173',
    API_BASE_PATH: '/api/v1',
    TRUST_PROXY_HOPS: '0',
    DB_HOST: process.env.AUTH_TEST_DB_HOST,
    DB_PORT: process.env.AUTH_TEST_DB_PORT ?? '3306',
    DB_NAME: process.env.AUTH_TEST_DB_NAME,
    DB_USER: process.env.AUTH_TEST_DB_USER,
    DB_PASSWORD: process.env.AUTH_TEST_DB_PASSWORD,
    DB_CONNECTION_LIMIT: '4',
    DB_SSL: 'false',
    JWT_SECRET: randomBytes(48).toString('base64url'),
    JWT_ISSUER: 'se-admissions-test',
    JWT_AUDIENCE: 'se-admissions-test-client',
    ACCESS_TOKEN_TTL_SECONDS: '300',
    REFRESH_TOKEN_TTL_DAYS: '1',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'strict',
  });

  const [{ createApp }, auth, { pool }] = await Promise.all([
    import('../src/app.js'),
    import('../src/modules/auth/auth.service.js'),
    import('../src/core/db/pool.js'),
  ]);
  const adminEmail = `auth-test-${randomBytes(5).toString('hex')}@example.test`;
  const adminPassword = 'AdminSecureExample2026';
  const auditorPassword = 'AuditorSecureExample2026';
  const nextPassword = 'ChangedSecureExample2026';
  let appServer;
  const createdUserIds = [];

  try {
    const admin = await auth.createUser({
      email: adminEmail, password: adminPassword, role: 'SUPER_ADMIN', displayName: 'Auth Test Admin',
    }, null, '127.0.0.1');
    createdUserIds.push(admin.id);
    const app = createApp();
    appServer = app.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const baseUrl = `http://127.0.0.1:${appServer.address().port}`;

    async function request(path, { method = 'GET', body, token, cookies = {}, csrf } = {}) {
      const headers = new Headers();
      if (body) headers.set('content-type', 'application/json');
      if (token) headers.set('authorization', `Bearer ${token}`);
      if (csrf) headers.set('x-csrf-token', csrf);
      const cookieHeader = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
      if (cookieHeader) headers.set('cookie', cookieHeader);
      const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const setCookies = response.headers.getSetCookie().map((value) => value.split(';', 1)[0]).map((part) => {
        const separator = part.indexOf('=');
        return [part.slice(0, separator), part.slice(separator + 1)];
      });
      const responseBody = response.status === 204 ? null : await response.json();
      return { response, body: responseBody, cookies: Object.fromEntries(setCookies) };
    }

    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: adminEmail, password: adminPassword },
    });
    assert.equal(adminLogin.response.status, 200);
    assert.ok(adminLogin.body.accessToken);
    assert.ok(adminLogin.cookies.refresh_token);
    assert.ok(adminLogin.cookies.csrf_token);
    assert.ok(adminLogin.body.user.permissions.includes('users.manage'));

    const currentAdmin = await request('/api/v1/auth/me', { token: adminLogin.body.accessToken });
    assert.equal(currentAdmin.response.status, 200);
    assert.equal(currentAdmin.body.user.role, 'SUPER_ADMIN');

    const createdAuditor = await request('/api/v1/auth/users', {
      method: 'POST', token: adminLogin.body.accessToken,
      body: { email: `auditor-${randomBytes(5).toString('hex')}@example.test`, password: auditorPassword, role: 'AUDITOR', displayName: 'Auth Test Auditor' },
    });
    assert.equal(createdAuditor.response.status, 201);
    createdUserIds.push(createdAuditor.body.user.id);

    const auditorLogin = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: createdAuditor.body.user.email, password: auditorPassword },
    });
    assert.equal(auditorLogin.response.status, 200);
    assert.ok(auditorLogin.body.user.permissions.includes('audit.read'));
    assert.equal(auditorLogin.body.user.permissions.includes('users.manage'), false);
    const forbidden = await request('/api/v1/auth/roles', { token: auditorLogin.body.accessToken });
    assert.equal(forbidden.response.status, 403);

    const changedPassword = await request('/api/v1/auth/change-password', {
      method: 'POST', token: auditorLogin.body.accessToken,
      body: { currentPassword: auditorPassword, newPassword: nextPassword },
    });
    assert.equal(changedPassword.response.status, 200);
    const revokedAfterPasswordChange = await request('/api/v1/auth/me', { token: auditorLogin.body.accessToken });
    assert.equal(revokedAfterPasswordChange.response.status, 401);

    const updatedAuditorLogin = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: createdAuditor.body.user.email, password: nextPassword },
    });
    assert.equal(updatedAuditorLogin.response.status, 200);

    const oldSessionCookies = { refresh_token: adminLogin.cookies.refresh_token, csrf_token: adminLogin.cookies.csrf_token };
    const rotated = await request('/api/v1/auth/refresh', {
      method: 'POST', cookies: oldSessionCookies, csrf: oldSessionCookies.csrf_token,
    });
    assert.equal(rotated.response.status, 200);
    assert.ok(rotated.cookies.refresh_token);
    assert.notEqual(rotated.cookies.refresh_token, oldSessionCookies.refresh_token);
    const oldAccessRevoked = await request('/api/v1/auth/me', { token: adminLogin.body.accessToken });
    assert.equal(oldAccessRevoked.response.status, 401);

    const reuse = await request('/api/v1/auth/refresh', {
      method: 'POST', cookies: oldSessionCookies, csrf: oldSessionCookies.csrf_token,
    });
    assert.equal(reuse.response.status, 401);
    const familyRevoked = await request('/api/v1/auth/me', { token: rotated.body.accessToken });
    assert.equal(familyRevoked.response.status, 401);

    const logoutLogin = await request('/api/v1/auth/login', {
      method: 'POST', body: { email: adminEmail, password: adminPassword },
    });
    const logoutCookies = { refresh_token: logoutLogin.cookies.refresh_token, csrf_token: logoutLogin.cookies.csrf_token };
    const logout = await request('/api/v1/auth/logout', {
      method: 'POST', cookies: logoutCookies, csrf: logoutCookies.csrf_token,
    });
    assert.equal(logout.response.status, 204);
    const revokedAfterLogout = await request('/api/v1/auth/me', { token: logoutLogin.body.accessToken });
    assert.equal(revokedAfterLogout.response.status, 401);
  } finally {
    if (appServer) await new Promise((resolve) => appServer.close(resolve));
    if (createdUserIds.length) {
      await pool.execute(`DELETE FROM sys_users WHERE id IN (${createdUserIds.map(() => '?').join(',')})`, createdUserIds);
    }
    await pool.end();
  }
});

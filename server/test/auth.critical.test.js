import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

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

const { validatePassword, hashPassword, verifyPassword } = await import('../src/core/security/password.js');
const { createAccessToken, verifyAccessToken, createOpaqueToken, digestToken } = await import('../src/core/security/tokens.js');
const schemas = await import('../src/modules/auth/auth.schemas.js');
const { ROLE_NAMES, PERMISSIONS } = await import('../src/modules/auth/auth.constants.js');
const { requirePermission, authenticate } = await import('../src/modules/auth/auth.middleware.js');
const { AppError } = await import('../src/core/errors/app-error.js');

// ---------------------------------------------------------
// 1. PASSWORD SECURITY & SCRYPT VERIFICATION
// ---------------------------------------------------------
test('Password Policy: validates bounds, casing and digit rules strictly', () => {
  // Boundary lengths
  assert.equal(validatePassword(''), false, 'empty password rejected');
  assert.equal(validatePassword('Ab1!xxxxxxx'), false, '11 chars rejected');
  assert.equal(validatePassword('Ab1!xxxxxxxx'), true, '12 chars accepted');
  assert.equal(validatePassword('A1b'.repeat(42) + 'Xx'), true, '128 chars accepted');
  assert.equal(validatePassword('A1b'.repeat(42) + 'Xxx'), false, '129 chars rejected');

  // Character class enforcement
  assert.equal(validatePassword('alllowercase123'), false, 'missing uppercase rejected');
  assert.equal(validatePassword('ALLUPPERCASE123'), false, 'missing lowercase rejected');
  assert.equal(validatePassword('NoDigitsHereAtAll!'), false, 'missing number rejected');
  assert.equal(validatePassword('ValidPass1234'), true, 'meets all criteria');

  // Non-string types
  assert.equal(validatePassword(null), false, 'null rejected');
  assert.equal(validatePassword(undefined), false, 'undefined rejected');
  assert.equal(validatePassword(123456789012), false, 'number rejected');
  assert.equal(validatePassword({}), false, 'object rejected');
});

test('Password Hashing: produces unique scrypt salts and resists tampering', async () => {
  await assert.rejects(
    async () => hashPassword('weak'),
    /Password must be 12–128 characters/,
    'weak password throws TypeError on hash attempt'
  );

  const hash1 = await hashPassword('SecretTestPassword123');
  const hash2 = await hashPassword('SecretTestPassword123');

  assert.notEqual(hash1, hash2, 'two hashes of the same password produce distinct salts and ciphertext');
  assert.equal(await verifyPassword('SecretTestPassword123', hash1), true);
  assert.equal(await verifyPassword('WrongPassword1234', hash1), false);

  // Tampering detection
  assert.equal(await verifyPassword('SecretTestPassword123', hash1 + 'x'), false, 'tampered string rejected');
  assert.equal(await verifyPassword('SecretTestPassword123', 'invalid$format'), false, 'malformed format rejected');
  assert.equal(await verifyPassword('SecretTestPassword123', null), false, 'null hash safely rejected without throwing');
  assert.equal(await verifyPassword(null, hash1), false, 'null password safely rejected without throwing');
});

// ---------------------------------------------------------
// 2. JWT & TOKEN BOUNDARY TESTING
// ---------------------------------------------------------
test('Tokens: signs access JWTs with strict subject, audience, issuer and session claims', async () => {
  const user = { id: 'usr-987-abc', token_version: 5 };
  const sessionId = 'ses-456-def';

  const token = await createAccessToken(user, sessionId);
  assert.ok(typeof token === 'string');

  const { payload, protectedHeader } = await verifyAccessToken(token);
  assert.equal(protectedHeader.alg, 'HS256');
  assert.equal(payload.sub, 'usr-987-abc');
  assert.equal(payload.sid, 'ses-456-def');
  assert.equal(payload.tokenVersion, 5);
  assert.equal(payload.iss, 'se-admissions-test');
  assert.equal(payload.aud, 'se-admissions-test-client');
  assert.ok(payload.jti, 'JTI exists for replay defense');
});

test('Tokens: rejects tampered JWT signature and payload modifications', async () => {
  const user = { id: 'usr-tamper-test', token_version: 1 };
  const token = await createAccessToken(user, 'ses-tamper');
  const [header, payload, signature] = token.split('.');

  // 1. Modifying payload
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), tokenVersion: 999 })
  ).toString('base64url');
  const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

  await assert.rejects(
    async () => verifyAccessToken(tamperedToken),
    /signature verification failed/i,
    'tampered payload causes signature mismatch'
  );

  // 2. Corrupting signature
  const corruptedSignature = signature.slice(0, -4) + 'AAAA';
  await assert.rejects(
    async () => verifyAccessToken(`${header}.${payload}.${corruptedSignature}`),
    /signature verification failed/i,
    'corrupted signature rejected'
  );
});

test('Tokens: Opaque tokens and SHA-256 digests operate deterministically with high entropy', () => {
  const token1 = createOpaqueToken();
  const token2 = createOpaqueToken();
  assert.notEqual(token1, token2, 'opaque tokens are unique');
  assert.equal(token1.length, 64, '48 random bytes encoded as base64url is 64 characters');

  const digest1 = digestToken(token1);
  const digest2 = digestToken(token1);
  assert.equal(digest1, digest2, 'digest is deterministic');
  assert.equal(digest1.length, 64, 'SHA-256 hex digest is 64 characters');
  assert.match(digest1, /^[0-9a-f]{64}$/, 'hex format');
});

// ---------------------------------------------------------
// 3. SCHEMA VALIDATION CRITICAL CHECKS
// ---------------------------------------------------------
test('Schemas: loginSchema normalizes email and blocks extra properties', () => {
  const result = schemas.loginSchema.safeParse({
    email: '  Staff.Member@DOMAIN.EDU  ',
    password: 'any-password',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.email, 'staff.member@domain.edu', 'trimmed and lowercased');

  // Strict rejection of extraneous parameters
  const extraField = schemas.loginSchema.safeParse({
    email: 'test@example.com',
    password: 'pass',
    isAdmin: true,
  });
  assert.equal(extraField.success, false, 'rejects injected fields');
});

test('Schemas: createUserSchema accepts only allowed roles and strong passwords', () => {
  for (const role of ROLE_NAMES) {
    const res = schemas.createUserSchema.safeParse({
      email: 'user@example.com',
      password: 'StrongPassword2026',
      role,
      displayName: 'Valid Name',
    });
    assert.equal(res.success, true, `role ${role} must be accepted`);
  }

  const badRole = schemas.createUserSchema.safeParse({
    email: 'user@example.com',
    password: 'StrongPassword2026',
    role: 'SUPERUSER',
    displayName: 'Invalid',
  });
  assert.equal(badRole.success, false, 'non-whitelisted role rejected');

  const emptyName = schemas.createUserSchema.safeParse({
    email: 'user@example.com',
    password: 'StrongPassword2026',
    role: 'AUDITOR',
    displayName: '   ',
  });
  assert.equal(emptyName.success, false, 'whitespace-only displayName rejected');
});

test('Schemas: updateUserSchema forbids empty payloads and invalid roles', () => {
  // Empty update rejected
  assert.equal(schemas.updateUserSchema.safeParse({}).success, false);

  // Valid updates
  assert.equal(schemas.updateUserSchema.safeParse({ role: 'VERIFIER' }).success, true);
  assert.equal(schemas.updateUserSchema.safeParse({ isActive: false }).success, true);
  assert.equal(schemas.updateUserSchema.safeParse({ role: 'AUDITOR', isActive: true }).success, true);

  // Disallowed fields
  assert.equal(schemas.updateUserSchema.safeParse({ displayName: 'New Name' }).success, false);
  assert.equal(schemas.updateUserSchema.safeParse({ email: 'new@example.com' }).success, false);
});

test('Schemas: userIdSchema requires valid UUID v4', () => {
  assert.equal(schemas.userIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success, true);
  assert.equal(schemas.userIdSchema.safeParse('not-a-uuid').success, false);
  assert.equal(schemas.userIdSchema.safeParse('------------------------------------').success, false);
  assert.equal(schemas.userIdSchema.safeParse("1' OR '1'='1").success, false);
});

// ---------------------------------------------------------
// 4. PERMISSIONS & RBAC MIDDLEWARE TESTING
// ---------------------------------------------------------
test('RBAC Middleware: requirePermission enforces presence and full coverage', () => {
  assert.throws(() => requirePermission(), /At least one permission is required/);

  const guard = requirePermission(PERMISSIONS.USERS_MANAGE, PERMISSIONS.SETTINGS_MANAGE);

  // Missing req.auth
  let errNoAuth;
  guard({}, {}, (err) => { errNoAuth = err; });
  assert.equal(errNoAuth?.status, 403);
  assert.equal(errNoAuth?.code, 'FORBIDDEN');

  // Partial permissions
  let errPartial;
  guard({ auth: { permissions: new Set([PERMISSIONS.USERS_MANAGE]) } }, {}, (err) => { errPartial = err; });
  assert.equal(errPartial?.status, 403);

  // Full permissions
  let success;
  guard({ auth: { permissions: new Set([PERMISSIONS.USERS_MANAGE, PERMISSIONS.SETTINGS_MANAGE, PERMISSIONS.AUDIT_READ]) } }, {}, (err) => {
    success = err;
  });
  assert.equal(success, undefined);
});

test('Authentication Middleware: rejects malformed headers and missing tokens', async () => {
  let errMissing;
  await authenticate({ get: () => undefined }, {}, (err) => { errMissing = err; });
  assert.equal(errMissing?.status, 401);
  assert.equal(errMissing?.code, 'AUTHENTICATION_REQUIRED');

  let errBasic;
  await authenticate({ get: () => 'Basic dXNlcjpwYXNz' }, {}, (err) => { errBasic = err; });
  assert.equal(errBasic?.status, 401);

  let errEmptyBearer;
  await authenticate({ get: () => 'Bearer ' }, {}, (err) => { errEmptyBearer = err; });
  assert.equal(errEmptyBearer?.status, 401);

  let errInvalidToken;
  await authenticate({ get: () => 'Bearer invalid.token.value' }, {}, (err) => { errInvalidToken = err; });
  assert.equal(errInvalidToken?.status, 401);
});

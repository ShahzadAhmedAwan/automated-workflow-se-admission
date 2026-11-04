import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../../core/errors/app-error.js';
import { config } from '../../core/config/env.js';
import { changePassword, createUser, getCurrentUser, listRoles, listUsers, login, revokeRefreshSession, rotateRefreshSession, updateUser } from './auth.service.js';
import { CSRF_COOKIE, REFRESH_COOKIE } from './auth.constants.js';
import { userIdSchema } from './auth.schemas.js';

const cookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: config.COOKIE_SAME_SITE,
  path: `${config.API_BASE_PATH}/auth`,
};
const csrfCookieOptions = { ...cookieOptions, httpOnly: false, path: '/' };

function setSessionCookies(res, session) {
  const maxAge = Math.max(0, new Date(session.expiresAt).getTime() - Date.now());
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge });
  res.cookie(CSRF_COOKIE, session.csrfToken, { ...csrfCookieOptions, maxAge });
}

function clearSessionCookies(res) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions);
}

function requireCsrf(req) {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get('x-csrf-token');
  const a = Buffer.from(cookie ?? '');
  const b = Buffer.from(header ?? '');
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(403, 'CSRF_VALIDATION_FAILED', 'The request could not be verified.');
  }
  return cookie;
}

export async function loginHandler(req, res) {
  const session = await login({ ...req.validatedBody, ipAddress: req.ip });
  setSessionCookies(res, session);
  const { refreshToken: _refresh, csrfToken: _csrf, expiresAt: _expiresAt, sessionId: _sessionId, ...body } = session;
  res.status(200).json(body);
}

export async function refreshHandler(req, res) {
  const csrfToken = requireCsrf(req);
  let session;
  try {
    session = await rotateRefreshSession({
      refreshToken: req.cookies?.[REFRESH_COOKIE], csrfToken, ipAddress: req.ip,
    });
  } catch (error) {
    if (error.status === 401) clearSessionCookies(res);
    throw error;
  }
  setSessionCookies(res, session);
  const { refreshToken: _refresh, csrfToken: _csrf, expiresAt: _expiresAt, sessionId: _sessionId, ...body } = session;
  res.status(200).json(body);
}

export async function logoutHandler(req, res) {
  const csrfToken = requireCsrf(req);
  await revokeRefreshSession({
    refreshToken: req.cookies?.[REFRESH_COOKIE], csrfToken, ipAddress: req.ip,
  });
  clearSessionCookies(res);
  res.status(204).end();
}

export async function meHandler(req, res) {
  const user = await getCurrentUser(req.auth.userId, req.auth.sessionId);
  const { password_hash: _passwordHash, token_version: _tokenVersion, ...safeUser } = user;
  res.json({ user: safeUser });
}

export async function changePasswordHandler(req, res) {
  const result = await changePassword(
    req.auth.userId, req.validatedBody.currentPassword, req.validatedBody.newPassword, req.ip,
  );
  clearSessionCookies(res);
  res.json(result);
}

export async function createUserHandler(req, res) {
  const user = await createUser(req.validatedBody, req.auth.userId, req.ip);
  res.status(201).json({ user });
}

export async function listUsersHandler(req, res) {
  const limitValue = Number(req.query.limit ?? 50);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) {
    throw new AppError(400, 'INVALID_QUERY', 'limit must be an integer from 1 to 100.');
  }
  const cursor = req.query.cursor ? String(req.query.cursor) : null;
  if (cursor && !userIdSchema.safeParse(cursor).success) {
    throw new AppError(400, 'INVALID_QUERY', 'cursor must be a valid user UUID.');
  }
  const users = await listUsers({ limit: limitValue, cursor });
  res.json({ users, nextCursor: users.length === limitValue ? users.at(-1).id : null });
}

export async function listRolesHandler(_req, res) {
  res.json({ roles: await listRoles() });
}

export async function updateUserHandler(req, res) {
  const user = await updateUser(req.params.userId, req.validatedBody, req.auth.userId, req.ip);
  res.json({ user });
}

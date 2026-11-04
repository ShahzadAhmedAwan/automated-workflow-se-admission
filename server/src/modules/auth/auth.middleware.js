import { AppError } from '../../core/errors/app-error.js';
import { verifyAccessToken } from '../../core/security/tokens.js';
import { getCurrentUser } from './auth.service.js';

export async function authenticate(req, _res, next) {
  try {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    const { payload } = await verifyAccessToken(match[1]);
    if (typeof payload.sid !== 'string') throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
    const currentUser = await getCurrentUser(payload.sub, payload.sid);
    if (Number(payload.tokenVersion) !== Number(currentUser.token_version)) {
      throw new AppError(401, 'SESSION_REVOKED', 'Your session is no longer valid.');
    }
    req.auth = {
      userId: currentUser.id,
      sessionId: payload.sid,
      email: currentUser.email,
      role: currentUser.role,
      permissions: new Set(currentUser.permissions),
    };
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
  }
}

export function requirePermission(...required) {
  if (!required.length) throw new TypeError('At least one permission is required.');
  return (req, _res, next) => {
    if (!req.auth || !required.every((permission) => req.auth.permissions.has(permission))) {
      return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.'));
    }
    next();
  };
}

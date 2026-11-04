import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, requirePermission } from './auth.middleware.js';
import { changePasswordHandler, createUserHandler, listRolesHandler, listUsersHandler, loginHandler, logoutHandler, meHandler, refreshHandler, updateUserHandler } from './auth.controller.js';
import { changePasswordSchema, createUserSchema, loginSchema, updateUserSchema, userIdSchema } from './auth.schemas.js';
import { PERMISSIONS } from './auth.constants.js';
import { AppError } from '../../core/errors/app-error.js';

const router = Router();
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
});

function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(new AppError(400, 'VALIDATION_ERROR', 'The request body is invalid.'));
    req.validatedBody = result.data;
    next();
  };
}

router.post('/login', loginLimiter, validateBody(loginSchema), loginHandler);
router.post('/refresh', refreshLimiter, refreshHandler);
router.post('/logout', refreshLimiter, logoutHandler);
router.get('/me', authenticate, meHandler);
router.post('/change-password', authenticate, validateBody(changePasswordSchema), changePasswordHandler);

router.get('/users', authenticate, requirePermission(PERMISSIONS.USERS_MANAGE), listUsersHandler);
router.get('/roles', authenticate, requirePermission(PERMISSIONS.USERS_MANAGE), listRolesHandler);
router.post('/users', authenticate, requirePermission(PERMISSIONS.USERS_MANAGE), validateBody(createUserSchema), createUserHandler);
router.patch(
  '/users/:userId',
  authenticate,
  requirePermission(PERMISSIONS.USERS_MANAGE),
  (req, _res, next) => {
    if (!userIdSchema.safeParse(req.params.userId).success) {
      return next(new AppError(400, 'INVALID_USER_ID', 'The user ID must be a UUID.'));
    }
    next();
  },
  validateBody(updateUserSchema),
  updateUserHandler,
);

export { router as authRoutes };

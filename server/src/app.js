import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { config } from './core/config/env.js';
import { authRoutes } from './modules/auth/index.js';
import { marketingRoutes } from './modules/marketing/index.js';
import { verificationRoutes } from './modules/verification/index.js';
import { meritRoutes } from './modules/merit/index.js';
import { errorHandler, notFoundHandler } from './core/http/error-handler.js';
import { pool } from './core/db/pool.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    next();
  });
  if (config.TRUST_PROXY_HOPS > 0) app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet());
  const isAllowedOrigin = (origin) => {
    if (!origin) return true;
    if (origin === config.APP_ORIGIN) return true;
    if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5174' || origin === 'http://127.0.0.1:5174') return true;
    if (/^http:\/\/(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?:\.sslip\.io)?(?::(?:5173|5174))?$/.test(origin)) return true;
    return false;
  };
  app.use(cors({
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  }));
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookieParser());

  app.get(`${config.API_BASE_PATH}/health/live`, (_req, res) => res.json({ status: 'ok' }));
  app.get(`${config.API_BASE_PATH}/health/ready`, async (_req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch (error) { next(error); }
  });
  app.use(`${config.API_BASE_PATH}/auth`, authRoutes);
  app.use(`${config.API_BASE_PATH}/marketing`, marketingRoutes);
  app.use(`${config.API_BASE_PATH}/verification`, verificationRoutes);
  app.use(`${config.API_BASE_PATH}/merit`, meritRoutes);

  // Rate-limited and validated public upload link redirect handlers
  const redirectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.NODE_ENV === 'test' ? 1000 : 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many link redirect requests. Please try again later.' } },
  });

  const isValidRedirectToken = (token) => {
    return typeof token === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(token);
  };

  app.get('/u/:token', redirectLimiter, (req, res) => {
    if (!isValidRedirectToken(req.params.token)) {
      return res.status(400).json({ error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid document intake link token format.' } });
    }
    res.redirect(`${config.APP_ORIGIN}/u/${encodeURIComponent(req.params.token)}`);
  });
  app.get('/upload/:token', redirectLimiter, (req, res) => {
    if (!isValidRedirectToken(req.params.token)) {
      return res.status(400).json({ error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid document intake link token format.' } });
    }
    res.redirect(`${config.APP_ORIGIN}/u/${encodeURIComponent(req.params.token)}`);
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

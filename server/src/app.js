import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { config } from './core/config/env.js';
import { authRoutes } from './modules/auth/index.js';
import { marketingRoutes } from './modules/marketing/index.js';
import { verificationRoutes } from './modules/verification/index.js';
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
    if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return true;
    if (/^http:\/\/192\.168\.\d+\.\d+:5173$/.test(origin)) return true;
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
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

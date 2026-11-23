import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(here, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

function resolveLocalAppOrigin(configuredOrigin) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return configuredOrigin;
  try {
    const url = new URL(configuredOrigin);
    if (/^(192\.168\.|10\.|localhost|127\.0\.0\.1)/.test(url.hostname)) {
      const ifaces = os.networkInterfaces();
      // Prioritize active Wi-Fi or wireless adapter
      for (const name of Object.keys(ifaces)) {
        if (/wi-?fi|wireless|wlan/i.test(name)) {
          for (const net of ifaces[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
              return `${url.protocol}//${net.address}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
            }
          }
        }
      }
      // Fallback: any non-virtual IPv4
      for (const name of Object.keys(ifaces)) {
        if (/vmnet|virtual|vEthernet|loopback|host-only/i.test(name)) continue;
        for (const net of ifaces[name] || []) {
          if (net.family === 'IPv4' && !net.internal && /^(192\.168\.|10\.)/.test(net.address)) {
            return `${url.protocol}//${net.address}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
          }
        }
      }
    }
  } catch {
    // fallback
  }
  return configuredOrigin;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.string().url().refine((value) => new URL(value).origin === value.replace(/\/$/, ''), 'APP_ORIGIN must be an origin without a path.'),
  API_BASE_PATH: z.string().regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/).default('/api/v1'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(10).default(8),
  DB_SSL: z.enum(['true', 'false']).default('false'),
  JWT_SECRET: z.string().min(43, 'JWT_SECRET must contain at least 32 random bytes.'),
  JWT_ISSUER: z.string().min(1).default('se-admissions-api'),
  JWT_AUDIENCE: z.string().min(1).default('se-admissions-client'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(900).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('SE Admissions <noreply@se-admissions.local>'),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map(({ path, message }) => `${path.join('.')}: ${message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${problems}`);
}

const value = parsed.data;
if (value.NODE_ENV === 'production' && value.COOKIE_SECURE !== 'true') {
  throw new Error('COOKIE_SECURE must be true in production.');
}
if (value.COOKIE_SAME_SITE === 'none' && value.COOKIE_SECURE !== 'true') {
  throw new Error('SameSite=None cookies require COOKIE_SECURE=true.');
}

export const config = Object.freeze({
  ...value,
  APP_ORIGIN: resolveLocalAppOrigin(new URL(value.APP_ORIGIN).origin),
  DB_SSL: value.DB_SSL === 'true',
  COOKIE_SECURE: value.COOKIE_SECURE === 'true',
  SMTP_SECURE: value.SMTP_SECURE === 'true',
  JWT_SECRET_BYTES: Buffer.from(value.JWT_SECRET, 'base64url'),
  REFRESH_TOKEN_TTL_MS: value.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});
if (config.JWT_SECRET_BYTES.length < 32) throw new Error('JWT_SECRET must decode to at least 32 bytes.');

import 'dotenv/config';
import { z } from 'zod';

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
  APP_ORIGIN: new URL(value.APP_ORIGIN).origin,
  DB_SSL: value.DB_SSL === 'true',
  COOKIE_SECURE: value.COOKIE_SECURE === 'true',
  JWT_SECRET_BYTES: Buffer.from(value.JWT_SECRET, 'base64url'),
  REFRESH_TOKEN_TTL_MS: value.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});
if (config.JWT_SECRET_BYTES.length < 32) throw new Error('JWT_SECRET must decode to at least 32 bytes.');

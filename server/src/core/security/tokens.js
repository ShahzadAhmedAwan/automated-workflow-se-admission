import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/env.js';

const signingKey = config.JWT_SECRET_BYTES;
const AT_REST_KEY = createHash('sha256').update(config.JWT_SECRET || 'admissions-secret').digest();

export async function createAccessToken(user, sessionId) {
  return new SignJWT({
    tokenVersion: user.token_version,
    sid: sessionId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(user.id))
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.ACCESS_TOKEN_TTL_SECONDS}s`)
    .setJti(randomBytes(16).toString('base64url'))
    .sign(signingKey);
}

export async function verifyAccessToken(token) {
  return jwtVerify(token, signingKey, {
    algorithms: ['HS256'],
    issuer: config.JWT_ISSUER,
    audience: config.JWT_AUDIENCE,
    clockTolerance: 5,
  });
}

export function createOpaqueToken() {
  return randomBytes(48).toString('base64url');
}

export function digestToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Encrypt sensitive plaintext at rest using authenticated AES-256-GCM.
 * Output format: <iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptAtRest(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', AT_REST_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt sensitive ciphertext at rest using AES-256-GCM.
 * Gracefully preserves unencrypted legacy plaintext for zero downtime.
 */
export function decryptAtRest(encrypted) {
  if (!encrypted || typeof encrypted !== 'string') return null;
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    // Plaintext fallback (legacy records)
    return encrypted;
  }
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(dataHex, 'hex');
    if (iv.length !== 12 || tag.length !== 16) {
      return encrypted;
    }
    const decipher = createDecipheriv('aes-256-gcm', AT_REST_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}


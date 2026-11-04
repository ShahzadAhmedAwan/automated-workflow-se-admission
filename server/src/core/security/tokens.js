import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config/env.js';

const signingKey = config.JWT_SECRET_BYTES;

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

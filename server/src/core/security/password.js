import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;

export function validatePassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && password.length <= 128
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password);
}

export async function hashPassword(password) {
  if (!validatePassword(password)) {
    throw new TypeError('Password must be 12–128 characters and include lowercase, uppercase, and a number.');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [algorithm, n, r, p, saltEncoded, keyEncoded, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || extra !== undefined) return false;
  const N = Number(n), blockSize = Number(r), parallelization = Number(p);
  if (![N, blockSize, parallelization].every(Number.isInteger) || N < 16384 || N > 131072 || blockSize < 1 || blockSize > 16 || parallelization < 1 || parallelization > 4) return false;
  try {
    const salt = Buffer.from(saltEncoded, 'base64url');
    const expected = Buffer.from(keyEncoded, 'base64url');
    if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await scrypt(password, salt, expected.length, {
      N, r: blockSize, p: parallelization, maxmem: 256 * 1024 * 1024,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

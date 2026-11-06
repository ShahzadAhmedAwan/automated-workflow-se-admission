import crypto from 'node:crypto';
import { pool } from '../../../core/db/pool.js';
import { TOKEN_CONFIG } from '../verification.constants.js';
import { AppError } from '../../../core/errors/app-error.js';

export class IntakeTokenService {
  /**
   * Mint a new cryptographically secure single-use intake token
   *
   * @param {Object} params
   * @param {number} params.studentId
   * @param {string[]} params.allowedDocTypes
   * @param {number} [params.attemptCount=1]
   * @param {number} [params.expiresInHours=48]
   * @param {any} [params.connection=pool]
   * @returns {Promise<{ tokenId: number, rawToken: string, tokenHash: string, expiresAt: Date, attemptCount: number }>}
   */
  static async generateToken({
    studentId,
    allowedDocTypes,
    attemptCount = 1,
    expiresInHours = TOKEN_CONFIG.EXPIRATION_HOURS,
    connection = pool,
  }) {
    if (!studentId) throw new TypeError('studentId is required.');
    if (!Array.isArray(allowedDocTypes) || allowedDocTypes.length === 0) {
      throw new TypeError('allowedDocTypes must be a non-empty array.');
    }

    // Generate 32 bytes of cryptographic entropy
    const rawToken = crypto.randomBytes(TOKEN_CONFIG.BYTES).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const [result] = await connection.execute(
      `INSERT INTO adm_intake_tokens (student_id, token_hash, allowed_doc_types, attempt_count, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [studentId, tokenHash, JSON.stringify(allowedDocTypes), attemptCount, expiresAt]
    );

    return {
      tokenId: result.insertId,
      rawToken,
      tokenHash,
      expiresAt,
      attemptCount,
      allowedDocTypes,
    };
  }

  /**
   * Validate a raw capability token and return student details
   *
   * @param {string} rawToken
   * @param {any} [connection=pool]
   */
  static async validateToken(rawToken, connection = pool, { lock = false } = {}) {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new AppError(400, 'INVALID_TOKEN_FORMAT', 'Upload token is malformed.');
    }

    let cleanToken;
    try { cleanToken = decodeURIComponent(rawToken.trim()); }
    catch { throw new AppError(400, 'INVALID_TOKEN_FORMAT', 'Upload token is malformed.'); }
    const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

    const [rows] = await connection.execute(
      `SELECT t.id AS token_id, t.student_id, t.allowed_doc_types, t.attempt_count,
              t.is_revoked, t.used_at, t.expires_at,
              s.application_no, s.full_name, s.phone_normalized, s.overall_status
         FROM adm_intake_tokens t
         JOIN adm_students s ON s.id = t.student_id
        WHERE t.token_hash = ?${lock ? ' FOR UPDATE' : ''}`,
      [tokenHash]
    );

    if (!rows.length) {
      throw new AppError(404, 'TOKEN_NOT_FOUND', 'This document upload link is invalid or does not exist.');
    }

    const row = rows[0];

    if (row.is_revoked) {
      throw new AppError(410, 'TOKEN_REVOKED', 'This upload link has been replaced or revoked. Please check your latest SMS/WhatsApp message.');
    }

    if (row.used_at) {
      throw new AppError(410, 'TOKEN_ALREADY_USED', 'This upload link has already been used to submit documents.');
    }

    const now = new Date();
    if (new Date(row.expires_at) < now) {
      throw new AppError(410, 'TOKEN_EXPIRED', 'This document upload link has expired (48-hour submission window exceeded).');
    }

    const allowedDocs = typeof row.allowed_doc_types === 'string'
      ? JSON.parse(row.allowed_doc_types)
      : row.allowed_doc_types;

    // Mask name for privacy on public page (e.g. "Muhammad U****")
    const nameParts = (row.full_name || '').split(' ');
    const maskedName = nameParts.map((p, idx) => idx === 0 ? p : p[0] + '****').join(' ');

    return {
      tokenId: row.token_id,
      studentId: row.student_id,
      applicationNo: row.application_no,
      maskedFullName: maskedName,
      allowedDocTypes: allowedDocs,
      attemptCount: row.attempt_count,
      expiresAt: row.expires_at,
      overallStatus: row.overall_status,
    };
  }

  /**
   * Revoke token (e.g. when re-issuing a new link)
   */
  static async revokeToken(tokenId, connection = pool) {
    await connection.execute(
      `UPDATE adm_intake_tokens SET is_revoked = TRUE WHERE id = ?`,
      [tokenId]
    );
  }

  /**
   * Mark token as used inside an active transaction
   */
  static async markTokenUsed(tokenId, connection) {
    const [result] = await connection.execute(
      `UPDATE adm_intake_tokens SET used_at = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND used_at IS NULL AND is_revoked = FALSE AND expires_at > CURRENT_TIMESTAMP(3)`,
      [tokenId]
    );
    if (result.affectedRows !== 1) {
      throw new AppError(409, 'TOKEN_ALREADY_USED', 'This upload link has already been used or expired. Request a new link.');
    }
  }
}

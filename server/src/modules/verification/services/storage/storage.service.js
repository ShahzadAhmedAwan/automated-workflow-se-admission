import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { STORAGE_PROVIDER, STORAGE_STATE } from '../../verification.constants.js';

// Environment variables for Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// Local fallback directory for zero-dependency dev/test environments
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), 'data', 'uploads');
let cachedDriveAccessToken = null;
let driveAccessTokenExpiresAt = 0;

export class StorageService {
  /**
   * Determine whether real Cloudflare R2 is configured
   */
  static isR2Configured() {
    return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
  }

  /**
   * Upload file to active storage (R2 or Local Fallback)
   *
   * @param {Object} params
   * @param {Buffer} params.buffer
   * @param {string} params.originalFilename
   * @param {string} params.mimeType
   * @param {number|string} params.studentId
   * @param {string} params.docType
   * @returns {Promise<{ storageProvider: string, storageKey: string, fileMime: string, fileSize: number }>}
   */
  static async uploadFile({ buffer, originalFilename, mimeType, studentId, docType }) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('File buffer is required.');
    }

    const extension = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mimeType];
    if (!extension || !/^[A-Z0-9_]{2,40}$/.test(docType) || !/^\d+$/.test(String(studentId))) {
      throw new TypeError('Unsupported document storage metadata.');
    }
    const storageKey = `uploads/student_${studentId}/${docType.toLowerCase()}_${crypto.randomUUID()}${extension}`;

    if (this.isR2Configured()) {
      await this._uploadToR2(storageKey, buffer, mimeType);
      return {
        storageProvider: STORAGE_PROVIDER.R2,
        storageKey,
        fileMime: mimeType,
        fileSize: buffer.length,
      };
    }

    if (process.env.NODE_ENV === 'production') throw new Error('Document storage is not configured: provide Cloudflare R2 credentials before accepting uploads.');

    // Local disk fallback for development/testing
    await this._uploadToLocal(storageKey, buffer);
    return {
      storageProvider: STORAGE_PROVIDER.LOCAL_MOCK,
      storageKey,
      fileMime: mimeType,
      fileSize: buffer.length,
    };
  }

  static async uploadBoardGazette(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new TypeError('The gazette must be a valid PDF file.');
    }
    const storageKey = `uploads/board-gazettes/${crypto.randomUUID()}.pdf`;
    if (this.isR2Configured()) {
      await this._uploadToR2(storageKey, buffer, 'application/pdf');
      return { storageProvider: STORAGE_PROVIDER.R2, storageKey, fileSize: buffer.length };
    }
    if (process.env.NODE_ENV === 'production') throw new Error('Board gazette storage is not configured. Configure Cloudflare R2.');
    await this._uploadToLocal(storageKey, buffer);
    return { storageProvider: STORAGE_PROVIDER.LOCAL_MOCK, storageKey, fileSize: buffer.length };
  }

  /**
   * Retrieve file buffer by storage key
   *
   * @param {string} storageKey
   * @param {string} [storageProvider]
   * @returns {Promise<Buffer>}
   */
  static async getFileBuffer(storageKey, storageProvider = STORAGE_PROVIDER.R2) {
    if (storageProvider === STORAGE_PROVIDER.R2 && this.isR2Configured()) {
      return this._fetchFromR2(storageKey);
    }
    if (storageProvider === STORAGE_PROVIDER.R2 && process.env.NODE_ENV === 'production') {
      throw new Error('Cloudflare R2 is not configured for document retrieval.');
    }

    const localPath = this._resolveLocalPath(storageKey);
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at storage key: ${storageKey}`);
    }
    return fs.promises.readFile(localPath);
  }

  static async getArchivedFileBuffer(gdriveFileId) {
    if (!/^[A-Za-z0-9_-]{10,255}$/.test(String(gdriveFileId || ''))) throw new Error('Invalid archived document reference.');
    const email = process.env.GDRIVE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GDRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!email || !privateKey) throw new Error('Google Drive archive access is not configured.');
    const accessToken = await this._getDriveAccessToken(email, privateKey);
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(gdriveFileId)}`);
    url.searchParams.set('alt', 'media');
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Google Drive document retrieval failed (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Delete file from storage
   */
  static async deleteFile(storageKey, storageProvider = STORAGE_PROVIDER.R2) {
    if (storageProvider === STORAGE_PROVIDER.R2 && this.isR2Configured()) {
      return this._deleteFromR2(storageKey);
    }
    if (storageProvider === STORAGE_PROVIDER.R2 && process.env.NODE_ENV === 'production') {
      throw new Error('Cloudflare R2 is not configured for document deletion.');
    }
    const localPath = this._resolveLocalPath(storageKey);
    try { await fs.promises.unlink(localPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  static _resolveLocalPath(storageKey) {
    if (typeof storageKey !== 'string' || path.isAbsolute(storageKey)) throw new Error('Invalid storage key.');
    const base = path.resolve(LOCAL_STORAGE_DIR);
    const target = path.resolve(base, storageKey);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) throw new Error('Invalid storage key.');
    return target;
  }

  /**
   * Migrate verified document from R2 to Google Drive archive
   * Archive a verified document. Missing Drive configuration fails closed and preserves the source.
   */
  static async migrateToGoogleDrive({ storageKey, filename, mimeType, storageProvider }) {
    const email = process.env.GDRIVE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GDRIVE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const folderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID;
    if (!email || !privateKey || !folderId) {
      throw new Error('Google Drive archive is not configured. Set GDRIVE_SERVICE_ACCOUNT_EMAIL, GDRIVE_PRIVATE_KEY, and GDRIVE_ARCHIVE_FOLDER_ID. The source remains in active storage.');
    }
    const accessToken = await this._getDriveAccessToken(email, privateKey);
    const sourceKeyHash = crypto.createHash('sha256').update(storageKey).digest('hex');
    const search = new URL('https://www.googleapis.com/drive/v3/files');
    search.searchParams.set('q', `appProperties has { key='sourceKeyHash' and value='${sourceKeyHash}' } and trashed=false`);
    search.searchParams.set('fields', 'files(id,parents)');
    const existingResponse = await fetch(search, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    if (!existingResponse.ok) throw new Error(`Google Drive archive lookup failed (${existingResponse.status}).`);
    const existing = await existingResponse.json();
    if (existing.files?.[0]?.id) {
      return { gdriveFileId: existing.files[0].id, gdriveFolderId: existing.files[0].parents?.[0] || folderId, storageState: STORAGE_STATE.ARCHIVED_GDRIVE };
    }
    const bytes = await this.getFileBuffer(storageKey, storageProvider);
    const boundary = `se-admissions-${crypto.randomUUID()}`;
    const safeName = path.basename(filename || 'admissions-document').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180);
    const metadata = { name: safeName, parents: [folderId], appProperties: { sourceKeyHash } };
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,parents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Google Drive archive upload failed (${response.status}).`);
    const archived = await response.json();
    if (!archived.id) throw new Error('Google Drive did not confirm the archived file.');
    return { gdriveFileId: archived.id, gdriveFolderId: archived.parents?.[0] || folderId, storageState: STORAGE_STATE.ARCHIVED_GDRIVE };
  }

  static async _getDriveAccessToken(email, privateKey) {
    if (cachedDriveAccessToken && driveAccessTokenExpiresAt > Date.now() + 60_000) return cachedDriveAccessToken;
    const now = Math.floor(Date.now() / 1000);
    const key = await importPKCS8(privateKey, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/drive.file' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) throw new Error(`Google Drive authorization failed (${response.status}).`);
    cachedDriveAccessToken = result.access_token;
    driveAccessTokenExpiresAt = Date.now() + Number(result.expires_in || 3600) * 1000;
    return cachedDriveAccessToken;
  }

  // =========================================================================
  // Internal Helpers for Local Mock Storage
  // =========================================================================

  static async _uploadToLocal(storageKey, buffer) {
    const fullPath = this._resolveLocalPath(storageKey);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }

  // =========================================================================
  // Zero-Dependency S3 / Cloudflare R2 REST Client with SigV4
  // =========================================================================

  static async _uploadToR2(storageKey, buffer, mimeType) {
    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const url = `${endpoint}/${R2_BUCKET_NAME}/${storageKey}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = date.slice(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const canonicalUri = `/${R2_BUCKET_NAME}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `${algorithm}\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;

    const signingKey = this._getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    const authorization = `${algorithm} Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Host': host,
        'Content-Type': mimeType || 'application/octet-stream',
        'x-amz-date': date,
        'x-amz-content-sha256': payloadHash,
        'Authorization': authorization,
      },
      body: buffer,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Cloudflare R2 PUT upload failed (${res.status}): ${errText}`);
    }
  }

  static async _fetchFromR2(storageKey) {
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const url = `https://${host}/${R2_BUCKET_NAME}/${storageKey}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = date.slice(0, 8);
    const region = 'auto';
    const service = 's3';
    const emptyHash = crypto.createHash('sha256').update('').digest('hex');
    const canonicalUri = `/${R2_BUCKET_NAME}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${date}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `GET\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${emptyHash}`;
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const signingKey = this._getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Host': host,
        'x-amz-date': date,
        'x-amz-content-sha256': emptyHash,
        'Authorization': `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    });

    if (!res.ok) throw new Error(`Cloudflare R2 GET failed with status ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  static async _deleteFromR2(storageKey) {
    const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const url = `https://${host}/${R2_BUCKET_NAME}/${storageKey}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = date.slice(0, 8);
    const region = 'auto';
    const service = 's3';
    const emptyHash = crypto.createHash('sha256').update('').digest('hex');
    const canonicalUri = `/${R2_BUCKET_NAME}/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${emptyHash}\nx-amz-date:${date}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalRequest = `DELETE\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${emptyHash}`;
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${credentialScope}\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
    const signingKey = this._getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, region, service);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Host': host,
        'x-amz-date': date,
        'x-amz-content-sha256': emptyHash,
        'Authorization': `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Cloudflare R2 DELETE failed with status ${response.status}`);
    }
  }

  static _getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }
}

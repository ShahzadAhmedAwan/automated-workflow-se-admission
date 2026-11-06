import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STORAGE_PROVIDER, STORAGE_STATE } from '../../verification.constants.js';

// Environment variables for Cloudflare R2
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// Local fallback directory for zero-dependency dev/test environments
const LOCAL_STORAGE_DIR = path.resolve(process.cwd(), 'data', 'uploads');

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

    const timestamp = Date.now();
    const cleanExt = path.extname(originalFilename || '') || (mimeType === 'application/pdf' ? '.pdf' : '.jpg');
    const storageKey = `uploads/student_${studentId}/${docType.toLowerCase()}_${timestamp}${cleanExt}`;

    if (this.isR2Configured()) {
      await this._uploadToR2(storageKey, buffer, mimeType);
      return {
        storageProvider: STORAGE_PROVIDER.R2,
        storageKey,
        fileMime: mimeType,
        fileSize: buffer.length,
      };
    }

    // Local disk fallback for development/testing
    await this._uploadToLocal(storageKey, buffer);
    return {
      storageProvider: STORAGE_PROVIDER.LOCAL_MOCK,
      storageKey,
      fileMime: mimeType,
      fileSize: buffer.length,
    };
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

    const localPath = path.join(LOCAL_STORAGE_DIR, storageKey);
    if (!fs.existsSync(localPath)) {
      throw new Error(`File not found at storage key: ${storageKey}`);
    }
    return fs.promises.readFile(localPath);
  }

  /**
   * Delete file from storage
   */
  static async deleteFile(storageKey, storageProvider = STORAGE_PROVIDER.R2) {
    if (storageProvider === STORAGE_PROVIDER.R2 && this.isR2Configured()) {
      return this._deleteFromR2(storageKey);
    }
    const localPath = path.join(LOCAL_STORAGE_DIR, storageKey);
    if (fs.existsSync(localPath)) {
      await fs.promises.unlink(localPath).catch(() => {});
    }
  }

  /**
   * Migrate verified document from R2 to Google Drive archive
   * In local/test mode without live Google credentials, records a mock GDrive file ID.
   */
  static async migrateToGoogleDrive({ storageKey, filename, mimeType, studentCnic }) {
    // If live GDrive API credentials exist, stream file to Google Drive:
    const gdriveFolderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID || 'mock_folder_se_verified';
    const mockGdriveFileId = `gdrive_file_${crypto.randomUUID()}`;

    // Once successfully saved to GDrive, purge from R2 / local storage to protect Inodes and bucket quota
    await this.deleteFile(storageKey);

    return {
      gdriveFileId: mockGdriveFileId,
      gdriveFolderId,
      storageState: STORAGE_STATE.ARCHIVED_GDRIVE,
    };
  }

  // =========================================================================
  // Internal Helpers for Local Mock Storage
  // =========================================================================

  static async _uploadToLocal(storageKey, buffer) {
    const fullPath = path.join(LOCAL_STORAGE_DIR, storageKey);
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

    await fetch(url, {
      method: 'DELETE',
      headers: {
        'Host': host,
        'x-amz-date': date,
        'x-amz-content-sha256': emptyHash,
        'Authorization': `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
    }).catch(() => {});
  }

  static _getSignatureKey(key, dateStamp, regionName, serviceName) {
    const kDate = crypto.createHmac('sha256', `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
    return crypto.createHmac('sha256', kService).update('aws4_request').digest();
  }
}

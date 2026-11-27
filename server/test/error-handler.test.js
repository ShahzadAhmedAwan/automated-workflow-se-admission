import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AppError } from '../src/core/errors/app-error.js';
import {
  formatZodError,
  resolveFriendlyError,
  errorHandler,
  notFoundHandler,
} from '../src/core/http/error-handler.js';

test('formatZodError: transforms raw Zod validation issues into plain-English sentences', () => {
  const schema = z.object({
    campaignId: z.coerce.number().int().positive({ message: 'Campaign selection is required.' }),
    fullName: z.string().min(2),
    phone: z.string().min(10),
  });

  const result = schema.safeParse({ fullName: 'A' });
  assert.equal(result.success, false);

  const formatted = formatZodError(result.error);
  // Must be readable string, not JSON dump
  assert.ok(!formatted.startsWith('['));
  assert.ok(!formatted.includes('invalid_type'));
  assert.ok(formatted.includes('Campaign selection is required.'));
  assert.ok(formatted.includes('Full name must be at least 2 characters.'));
  assert.ok(formatted.includes('Phone number is required.'));
});

test('resolveFriendlyError: resolves Zod validation errors to 400 VALIDATION_ERROR', () => {
  const schema = z.object({ email: z.string().email() });
  const result = schema.safeParse({ email: 'bad' });
  const friendly = resolveFriendlyError(result.error);

  assert.equal(friendly.status, 400);
  assert.equal(friendly.code, 'VALIDATION_ERROR');
  assert.ok(friendly.message.includes('Invalid email') || friendly.message.includes('Email address'));
});

test('resolveFriendlyError: resolves Multer file upload errors with helpful limits', () => {
  const multerSizeErr = new Error('File too large');
  multerSizeErr.name = 'MulterError';
  multerSizeErr.code = 'LIMIT_FILE_SIZE';

  const friendly = resolveFriendlyError(multerSizeErr);
  assert.equal(friendly.status, 413);
  assert.equal(friendly.code, 'FILE_TOO_LARGE');
  assert.ok(friendly.message.includes('10 MB'));
});

test('resolveFriendlyError: translates MySQL duplicate entry and connection failures into user-facing text', () => {
  const dupErr = new Error("Duplicate entry 'APP-2026-0001' for key 'uq_app'");
  dupErr.code = 'ER_DUP_ENTRY';
  const friendlyDup = resolveFriendlyError(dupErr);
  assert.equal(friendlyDup.status, 409);
  assert.equal(friendlyDup.code, 'DUPLICATE_ENTRY');
  assert.ok(friendlyDup.message.includes('already exists'));

  const connErr = new Error('connect ECONNREFUSED 127.0.0.1:3306');
  connErr.code = 'ECONNREFUSED';
  const friendlyConn = resolveFriendlyError(connErr);
  assert.equal(friendlyConn.status, 503);
  assert.equal(friendlyConn.code, 'SERVICE_UNAVAILABLE');
  assert.ok(friendlyConn.message.includes('database service is temporarily unavailable'));
});

test('resolveFriendlyError: preserves known AppError code and message', () => {
  const appErr = new AppError(404, 'STUDENT_NOT_FOUND', 'Candidate student record was not found.');
  const friendly = resolveFriendlyError(appErr);
  assert.equal(friendly.status, 404);
  assert.equal(friendly.code, 'STUDENT_NOT_FOUND');
  assert.equal(friendly.message, 'Candidate student record was not found.');
});

test('resolveFriendlyError: replaces generic unhandled 500 errors with friendly reassuring message', () => {
  const genericErr = new TypeError("Cannot read properties of undefined (reading 'split')");
  const friendly = resolveFriendlyError(genericErr);
  assert.equal(friendly.status, 500);
  assert.equal(friendly.code, 'INTERNAL_ERROR');
  assert.ok(!friendly.message.includes('terminal'));
  assert.ok(!friendly.message.includes('split'));
  assert.ok(friendly.message.includes('Something went wrong'));
});

test('errorHandler middleware: responds with clean JSON envelope and requestId', () => {
  let resStatus = 0;
  let resBody = null;

  const mockRes = {
    status(s) {
      resStatus = s;
      return this;
    },
    json(b) {
      resBody = b;
      return this;
    },
  };

  const req = { requestId: 'req-test-123', method: 'POST', path: '/api/v1/leads' };
  const error = new AppError(400, 'CAMPAIGN_REQUIRED', 'Selecting a campaign is required for student outreach.');

  errorHandler(error, req, mockRes, () => {});

  assert.equal(resStatus, 400);
  assert.equal(resBody.error.code, 'CAMPAIGN_REQUIRED');
  assert.equal(resBody.error.message, 'Selecting a campaign is required for student outreach.');
  assert.equal(resBody.requestId, 'req-test-123');
});

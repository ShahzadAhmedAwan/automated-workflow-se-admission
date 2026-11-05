import { AppError } from '../errors/app-error.js';

export function notFoundHandler(_req, _res, next) {
  next(new AppError(404, 'NOT_FOUND', 'The requested resource was not found.'));
}

export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const known = error instanceof AppError;
  const malformedJson = error?.type === 'entity.parse.failed';
  const payloadTooLarge = error?.type === 'entity.too.large';
  const status = known ? error.status : malformedJson ? 400 : payloadTooLarge ? 413 : 500;
  const requestId = req.requestId ?? 'unavailable';
  if (!known && !malformedJson && !payloadTooLarge) {
    console.error(`[${requestId}] ${req.method} ${req.path} failed:`, error);
  }
  const internalMessage = req.path.endsWith('/auth/login')
    ? `Sign-in service error. Reference ID: ${requestId}. Check the API server terminal.`
    : `The request failed on the server. Reference ID: ${requestId}. Check the API server terminal.`;
  res.status(status).json({
    error: {
      code: known ? error.code : malformedJson ? 'INVALID_JSON' : payloadTooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_ERROR',
      message: known ? error.message : malformedJson ? 'The request body is not valid JSON.' : payloadTooLarge ? 'The request body is too large.' : internalMessage,
    },
    requestId,
  });
}

const API = '/api/v1';
let accessToken = null;
let refreshPromise = null;

export class ApiError extends Error {
  constructor(message, { code = 'API_ERROR', status = 0, requestId = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

function readCsrfCookie() {
  const prefix = 'csrf_token=';
  const item = document.cookie.split('; ').find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

async function decodeResponse(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    return {
      error: {
        code: 'INVALID_API_RESPONSE',
        message: `The server responded unexpectedly (HTTP ${response.status}). Please try again in a moment.`,
      },
      requestId: response.headers.get('x-request-id'),
    };
  }
  try {
    return await response.json();
  } catch {
    return {
      error: {
        code: 'INVALID_API_RESPONSE',
        message: 'The server response could not be read. Please try again in a moment.',
      },
      requestId: response.headers.get('x-request-id'),
    };
  }
}

function apiUnavailableError() {
  return new ApiError('Unable to connect to the admissions server. Please check your internet connection or try again in a few moments.', {
    code: 'API_UNAVAILABLE',
  });
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const csrf = readCsrfCookie();
  if (!csrf) { accessToken = null; return null; }
  refreshPromise = (async () => {
    let response;
    try {
      response = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrf },
      });
    } catch {
      throw apiUnavailableError();
    }
    const body = await decodeResponse(response);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        accessToken = null;
        return null;
      }
      throw new ApiError(body?.error?.message ?? 'Your session could not be refreshed. Please sign in again.', {
        code: body?.error?.code ?? 'AUTH_REFRESH_FAILED',
        status: response.status,
        requestId: body?.requestId ?? response.headers.get('x-request-id'),
      });
    }
    accessToken = body.accessToken;
    return body;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

function notifySessionExpired() {
  accessToken = null;
  window.dispatchEvent(new Event('auth:session-expired'));
}

export async function apiRequest(path, options = {}, authenticated = false) {
  const execute = () => {
    const headers = new Headers(options.headers ?? {});
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (options.body && !isFormData && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (authenticated && accessToken) headers.set('authorization', `Bearer ${accessToken}`);
    return fetch(`${API}${path}`, { ...options, headers, credentials: 'include' });
  };

  let response;
  try {
    response = await execute();
  } catch {
    throw apiUnavailableError();
  }
  if (authenticated && response.status === 401 && path !== '/auth/refresh') {
    const refreshed = await refreshSession();
    if (!refreshed) {
      notifySessionExpired();
      throw new ApiError('Your session expired. Sign in again to continue.', {
        code: 'SESSION_EXPIRED', status: 401,
        requestId: response.headers.get('x-request-id'),
      });
    }
    response = await execute();
    if (response.status === 401) {
      notifySessionExpired();
      throw new ApiError('Your session expired. Sign in again to continue.', {
        code: 'SESSION_EXPIRED', status: 401,
        requestId: response.headers.get('x-request-id'),
      });
    }
  }
  const body = await decodeResponse(response);
  if (!response.ok) {
    throw new ApiError(body?.error?.message ?? `The request could not be completed (status ${response.status}). Please try again.`, {
      code: body?.error?.code ?? 'REQUEST_FAILED',
      status: response.status,
      requestId: body?.requestId ?? response.headers.get('x-request-id'),
    });
  }
  return body;
}

export async function apiRequestFile(path) {
  const execute = () => fetch(`${API}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
  let response;
  try { response = await execute(); } catch { throw apiUnavailableError(); }
  if (response.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      notifySessionExpired();
      throw new ApiError('Your session expired. Sign in again to continue.', { code: 'SESSION_EXPIRED', status: 401 });
    }
    response = await execute();
    if (response.status === 401) {
      notifySessionExpired();
      throw new ApiError('Your session expired. Sign in again to continue.', { code: 'SESSION_EXPIRED', status: 401 });
    }
  }
  if (!response.ok) {
    const body = await decodeResponse(response);
    throw new ApiError(body?.error?.message ?? `The requested file could not be downloaded (status ${response.status}). Please try again.`, {
      code: body?.error?.code ?? 'REQUEST_FAILED', status: response.status,
      requestId: body?.requestId ?? response.headers.get('x-request-id'),
    });
  }
  return response.blob();
}

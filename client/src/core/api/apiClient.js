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
    const message = import.meta.env.DEV
      ? `The API returned an unexpected response (HTTP ${response.status}). Make sure npm run dev:server is running.`
      : 'The sign-in service returned an invalid response. Try again later.';
    return {
      error: { code: 'INVALID_API_RESPONSE', message },
      requestId: response.headers.get('x-request-id'),
    };
  }
  try {
    return await response.json();
  } catch {
    return {
      error: { code: 'INVALID_API_RESPONSE', message: 'The API returned invalid JSON. Check the server terminal.' },
      requestId: response.headers.get('x-request-id'),
    };
  }
}

function apiUnavailableError() {
  const hint = import.meta.env.DEV ? ' Start the API with npm run dev:server, then try again.' : ' Try again later.';
  return new ApiError(`The sign-in service cannot be reached.${hint}`, { code: 'API_UNAVAILABLE' });
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
      throw new ApiError(body?.error?.message ?? 'The sign-in service is temporarily unavailable.', {
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
    throw new ApiError(body?.error?.message ?? `The request failed (HTTP ${response.status}).`, {
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
    throw new ApiError(body?.error?.message ?? `The request failed (HTTP ${response.status}).`, {
      code: body?.error?.code ?? 'REQUEST_FAILED', status: response.status,
      requestId: body?.requestId ?? response.headers.get('x-request-id'),
    });
  }
  return response.blob();
}

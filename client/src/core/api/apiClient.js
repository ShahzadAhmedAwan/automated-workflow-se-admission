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
      accessToken = null;
      return null;
    }
    const body = await decodeResponse(response);
    if (!response.ok) { accessToken = null; return null; }
    accessToken = body.accessToken;
    return body;
  })().catch(() => {
    accessToken = null;
    return null;
  }).finally(() => { refreshPromise = null; });
  return refreshPromise;
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
    if (refreshed) response = await execute();
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

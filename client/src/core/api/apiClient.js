const API = '/api/v1';
let accessToken = null;
let refreshPromise = null;

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
  return response.json().catch(() => ({}));
}

export async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const csrf = readCsrfCookie();
  if (!csrf) { accessToken = null; return null; }
  refreshPromise = (async () => {
    const response = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf-token': csrf },
    });
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

  let response = await execute();
  if (authenticated && response.status === 401 && path !== '/auth/refresh') {
    const refreshed = await refreshSession();
    if (refreshed) response = await execute();
  }
  const body = await decodeResponse(response);
  if (!response.ok) throw new Error(body?.error?.message ?? 'The request could not be completed.');
  return body;
}

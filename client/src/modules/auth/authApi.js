import { apiRequest, refreshSession, setAccessToken } from '../../core/api/apiClient.js';

let refreshDelayMs = 12 * 60 * 1000;

function keepSession(response) {
  setAccessToken(response.accessToken);
  refreshDelayMs = Math.max(60, response.expiresIn - 60) * 1000;
  return response.user;
}

export const authApi = {
  refreshDelay() { return refreshDelayMs; },
  async login(email, password) {
    return keepSession(await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }));
  },
  async restore() {
    const response = await refreshSession();
    return response ? keepSession(response) : null;
  },
  async refresh() {
    const response = await refreshSession();
    return response ? keepSession(response) : null;
  },
  async me() {
    const response = await apiRequest('/auth/me', {}, true);
    return response.user;
  },
  async logout() {
    const csrf = document.cookie.split('; ').find((part) => part.startsWith('csrf_token='))?.slice('csrf_token='.length);
    try {
      if (csrf) await apiRequest('/auth/logout', { method: 'POST', headers: { 'x-csrf-token': decodeURIComponent(csrf) } });
    } finally { setAccessToken(null); }
  },
};

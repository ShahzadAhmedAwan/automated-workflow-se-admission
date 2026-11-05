import { apiRequest } from '../../core/api/apiClient.js';

export const userManagementApi = {
  async listUsers() {
    const res = await apiRequest('/auth/users', {}, true);
    return res.users;
  },

  async listRoles() {
    const res = await apiRequest('/auth/roles', {}, true);
    return res.roles;
  },

  async createUser(payload) {
    return await apiRequest('/auth/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true);
  },

  async updateUser(userId, payload) {
    return await apiRequest(`/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }, true);
  },
};

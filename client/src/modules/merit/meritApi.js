import { apiRequest } from '../../core/api/apiClient.js';

export const meritApi = {
  async getActivePolicy(programCode = 'SE') {
    const res = await apiRequest(`/merit/policies/active?programCode=${programCode}`, {}, true);
    return res.data;
  },

  async listPolicies() {
    const res = await apiRequest('/merit/policies', {}, true);
    return res.data;
  },

  async createPolicy(policyData) {
    const res = await apiRequest('/merit/policies', {
      method: 'POST',
      body: JSON.stringify(policyData),
    }, true);
    return res.data;
  },

  async updatePolicy(id, policyData) {
    const res = await apiRequest(`/merit/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(policyData),
    }, true);
    return res.data;
  },

  async lookupSeet(cnic, simulate = false) {
    const res = await apiRequest('/merit/seet/lookup', {
      method: 'POST',
      body: JSON.stringify({ cnic, simulate }),
    }, true);
    return res.data;
  },

  async saveSeetResult(data) {
    const res = await apiRequest('/merit/seet/save', {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
    return res.data;
  },

  async syncVerifiedSeet() {
    const res = await apiRequest('/merit/seet/sync-verified', {
      method: 'POST',
    }, true);
    return res.data;
  },

  async uploadGazette(formData) {
    const res = await apiRequest('/merit/gazette/upload', {
      method: 'POST',
      body: formData,
    }, true);
    return res.data;
  },

  async calculateMerit(options = {}) {
    const res = await apiRequest('/merit/calculate', {
      method: 'POST',
      body: JSON.stringify(options),
    }, true);
    return res.data;
  },

  async listSnapshots() {
    const res = await apiRequest('/merit/snapshots', {}, true);
    return res.data;
  },

  async getSnapshot(id) {
    const res = await apiRequest(`/merit/snapshots/${id}`, {}, true);
    return res.data;
  },

  async lockSnapshot(id) {
    const res = await apiRequest(`/merit/snapshots/${id}/lock`, {
      method: 'POST',
    }, true);
    return res.data;
  },

  async notifySelected(id, data = {}) {
    const res = await apiRequest(`/merit/snapshots/${id}/notify`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, true);
    return res.data;
  },
};

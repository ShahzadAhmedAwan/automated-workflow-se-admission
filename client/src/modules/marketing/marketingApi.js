import { apiRequest } from '../../core/api/apiClient.js';

export const marketingApi = {
  async listCampaigns(limit = 50, offset = 0) {
    const res = await apiRequest(`/marketing/campaigns?limit=${limit}&offset=${offset}`, {}, true);
    return res.data;
  },

  async getCampaign(id) {
    const res = await apiRequest(`/marketing/campaigns/${id}`, {}, true);
    return res.data;
  },

  async createCampaign(name, description = '') {
    const res = await apiRequest('/marketing/campaigns', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }, true);
    return res.data;
  },

  async previewCsv(file) {
    const formData = new FormData();
    formData.append('file', file);
    // Don't stringify body; apiRequest handles FormData if Content-Type is not set
    const res = await apiRequest('/marketing/leads/preview', {
      method: 'POST',
      body: formData,
    }, true);
    return res.data;
  },

  async importLeads(campaignId, leads) {
    const res = await apiRequest('/marketing/leads/import', {
      method: 'POST',
      body: JSON.stringify({ campaignId: Number(campaignId), leads }),
    }, true);
    return res.data;
  },

  async triggerOutreach(campaignId, options = {}) {
    const res = await apiRequest(`/marketing/campaigns/${campaignId}/outreach`, {
      method: 'POST',
      body: JSON.stringify(options),
    }, true);
    return res.data;
  },

  async simulateInboundMessage(from, body) {
    const res = await apiRequest('/marketing/webhook/incoming-message', {
      method: 'POST',
      body: JSON.stringify({ from, body }),
    }, false);
    return res.data;
  },
};

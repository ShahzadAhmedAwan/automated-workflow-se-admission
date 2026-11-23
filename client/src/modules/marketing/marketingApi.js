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

  async deleteCampaign(id) {
    const res = await apiRequest(`/marketing/campaigns/${id}`, {
      method: 'DELETE',
    }, true);
    return res.data;
  },

  async listLeads({ campaignId, status, conversationState, search, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams();
    if (campaignId) params.append('campaignId', campaignId);
    if (status) params.append('status', status);
    if (conversationState) params.append('conversationState', conversationState);
    if (search) params.append('search', search);
    params.append('limit', limit);
    params.append('offset', offset);
    const res = await apiRequest(`/marketing/leads?${params.toString()}`, {}, true);
    return res.data;
  },

  async getLead(id) {
    const res = await apiRequest(`/marketing/leads/${id}`, {}, true);
    return res.data;
  },

  async updateLead(id, updates) {
    const res = await apiRequest(`/marketing/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }, true);
    return res.data;
  },

  async deleteLead(id) {
    const res = await apiRequest(`/marketing/leads/${id}`, {
      method: 'DELETE',
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

  async sendSingleLead(payload) {
    const res = await apiRequest('/marketing/leads/single', {
      method: 'POST',
      body: JSON.stringify(payload),
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

  async getWhatsAppStatus() {
    const res = await apiRequest('/marketing/whatsapp/status', {}, true);
    return res.data;
  },

  async getWhatsAppQr() {
    const res = await apiRequest('/marketing/whatsapp/qr', {}, true);
    return res.data;
  },

  async resetWhatsAppSession() {
    const res = await apiRequest('/marketing/whatsapp/reset', {
      method: 'POST',
    }, true);
    return res.data;
  },

  async updateWhatsAppNumber(phone) {
    const res = await apiRequest('/marketing/whatsapp/number', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }, true);
    return res.data;
  },

  async getKnowledge() {
    const res = await apiRequest('/marketing/knowledge', {}, true);
    return res.data;
  },

  async updateKnowledge(knowledge) {
    const res = await apiRequest('/marketing/knowledge', {
      method: 'POST',
      body: JSON.stringify({ knowledge }),
    }, true);
    return res.data;
  },

  async uploadKnowledgeFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiRequest('/marketing/knowledge', {
      method: 'POST',
      body: formData,
    }, true);
    return res.data;
  },
};

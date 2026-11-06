import { apiRequest, apiRequestFile } from '../../core/api/apiClient.js';

export const verificationApi = {
  /**
   * Public: Validate capability token
   */
  async validateToken(token) {
    const res = await apiRequest(`/verification/intake/token/${encodeURIComponent(token)}`, {
      method: 'GET',
    }, false);
    return res.data;
  },

  /**
   * Public: Submit uploaded document files
   */
  async submitDocuments(token, formData) {
    const res = await apiRequest(`/verification/intake/token/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      body: formData,
    }, false);
    return res.data;
  },

  /**
   * Staff: Fetch candidate review queue
   */
  async fetchReviewQueue(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.limit) query.set('limit', params.limit);
    if (params.offset) query.set('offset', params.offset);

    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await apiRequest(`/verification/queue${qs}`, {
      method: 'GET',
    }, true);
    return res.data;
  },

  /**
   * Staff: Fetch student verification dossier
   */
  async fetchStudentDossier(studentId) {
    const res = await apiRequest(`/verification/students/${studentId}/dossier`, {
      method: 'GET',
    }, true);
    return res.data;
  },

  /**
   * Staff: Update student phone number
   */
  async updatePhone(studentId, phone) {
    const res = await apiRequest(`/verification/students/${studentId}/phone`, {
      method: 'PATCH',
      body: JSON.stringify({ phone }),
    }, true);
    return res.data;
  },

  /**
   * Staff: Execute review action (Approve, Override, Reject & Reissue)
   */
  async executeReviewAction(studentId, payload) {
    const res = await apiRequest(`/verification/students/${studentId}/action`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true);
    return res.data;
  },

  /**
   * Staff: Bulk import discrepancy sheet
   */
  async importDiscrepancyCsv(file) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiRequest(`/verification/discrepancies/import`, {
      method: 'POST',
      body: formData,
    }, true);
    return res.data;
  },

  /**
   * Staff: Manually reissue token
   */
  async reissueToken(payload) {
    const res = await apiRequest(`/verification/tokens/reissue`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }, true);
    return res.data;
  },

  async listBoardSources() {
    const res = await apiRequest('/verification/board-sources', { method: 'GET' }, true);
    return res.data;
  },

  async saveBoardSource(formData) {
    const res = await apiRequest('/verification/board-sources', { method: 'POST', body: formData }, true);
    return res.data;
  },

  async deactivateBoardSource(sourceId) {
    const res = await apiRequest(`/verification/board-sources/${sourceId}`, { method: 'DELETE' }, true);
    return res.data;
  },

  async downloadBoardGazette(sourceId) {
    return apiRequestFile(`/verification/board-sources/${sourceId}/gazette`);
  },

  async downloadStudentDocument(studentId, documentId) {
    return apiRequestFile(`/verification/students/${studentId}/documents/${documentId}/file`);
  },
};

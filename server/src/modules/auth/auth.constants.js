export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';
export const ROLE_NAMES = Object.freeze(['SUPER_ADMIN', 'ADMISSION_OFFICER', 'VERIFIER', 'AUDITOR']);

export const PERMISSIONS = Object.freeze({
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  CAMPAIGNS_MANAGE: 'marketing.campaigns.manage',
  DOCUMENTS_REVIEW: 'verification.documents.review',
  TOKENS_REISSUE: 'verification.tokens.reissue',
  MERIT_POLICIES_MANAGE: 'merit.policies.manage',
  MERIT_RUN: 'merit.run',
  MERIT_SNAPSHOTS_LOCK: 'merit.snapshots.lock',
  AUDIT_READ: 'audit.read',
  MERIT_READ: 'merit.read',
  CANDIDATES_READ: 'candidates.read',
});

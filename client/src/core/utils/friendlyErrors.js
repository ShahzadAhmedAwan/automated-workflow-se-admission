/**
 * User-Friendly Error Formatting Utility
 * Translates technical error codes, network exceptions, validation outputs,
 * and database errors into clear, understandable language for non-technical users.
 */

const KNOWN_CODE_MESSAGES = {
  AUTHENTICATION_REQUIRED: 'Please sign in to continue.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again to continue.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  CSRF_VALIDATION_FAILED: 'Your security token has expired. Please refresh the page and try again.',
  CSRF_INVALID: 'Your security token has expired. Please refresh the page and try again.',
  NOT_FOUND: 'The requested page or record could not be found.',
  USER_NOT_FOUND: 'User account was not found.',
  CAMPAIGN_NOT_FOUND: 'The selected marketing campaign was not found.',
  CAMPAIGN_REQUIRED: 'Please select a campaign before proceeding.',
  LEAD_NOT_FOUND: 'The prospective applicant record was not found.',
  STUDENT_NOT_FOUND: 'The student admission record was not found.',
  INVALID_CREDENTIALS: 'The email address or password you entered is incorrect.',
  CURRENT_PASSWORD_INVALID: 'The current password you entered is incorrect.',
  PASSWORD_UNCHANGED: 'Please choose a new password that is different from your current one.',
  EMAIL_ALREADY_EXISTS: 'An account with this email address already exists.',
  SELF_LOCKOUT_PREVENTED: 'You cannot deactivate or demote your own account.',
  LAST_SUPER_ADMIN: 'At least one active administrator must remain on the system.',
  INVALID_PHONE: 'Please enter a valid mobile number (e.g. 03001234567).',
  INVALID_PHONE_NUMBER: 'Please enter a valid mobile number (e.g. 03001234567).',
  DUPLICATE_ENTRY: 'A record with this information already exists in the system.',
  TOKEN_NOT_FOUND: 'This document upload link is invalid or does not exist.',
  TOKEN_EXPIRED: 'This document upload link has expired (48-hour submission window exceeded).',
  TOKEN_REVOKED: 'This upload link is no longer active because a newer one was issued.',
  TOKEN_ALREADY_USED: 'This upload link has already been used to submit documents.',
  FILE_TOO_LARGE: 'The selected file is too large. Please upload a file smaller than 10 MB.',
  PAYLOAD_TOO_LARGE: 'The submitted file or request is too large. Please reduce the size and try again.',
  INVALID_FILE_TYPE: 'Please select a valid CSV spreadsheet (.csv) or PDF document.',
  GAZETTE_REQUIRED: 'Please select and upload a valid PDF gazette file.',
  ROLL_NUMBER_MISSING: 'Candidate roll number is missing. Please enter or extract the roll number first.',
  BOARD_SOURCE_NOT_FOUND: 'The requested education board source was not found.',
  BOARD_SOURCE_EXISTS: 'A source for this education board and academic year already exists.',
  API_UNAVAILABLE: 'Unable to connect to the admissions server. Please check your internet connection or try again shortly.',
  SERVICE_UNAVAILABLE: 'The admissions database service is temporarily unavailable. Please try again in a few moments.',
  VALIDATION_ERROR: 'Please check your inputs and make sure all required fields are filled out.',
};

/**
 * Parses JSON error dumps or Zod arrays to extract human sentences.
 */
function extractFromPotentialJson(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const msgs = parsed
          .map((item) => item.message || item.error || (item.path ? `${item.path.join('.')}: invalid` : null))
          .filter(Boolean);
        if (msgs.length) return msgs.join(' ');
      }
      if (parsed && typeof parsed === 'object') {
        if (parsed.error?.message) return parsed.error.message;
        if (parsed.message) return parsed.message;
      }
    } catch {
      // Not JSON
    }
  }
  return null;
}

/**
 * Transforms any technical error into a simple, reassuring plain-English message for users.
 * @param {any} error The caught error (ApiError, Error, string, etc.)
 * @param {string} fallbackMessage A context-appropriate fallback if no specific message is available.
 * @returns {string} User-friendly error message.
 */
export function formatUserError(error, fallbackMessage = 'An unexpected error occurred. Please try again.') {
  if (!error) return fallbackMessage;

  // 1. Direct code lookup
  if (error.code && KNOWN_CODE_MESSAGES[error.code]) {
    return KNOWN_CODE_MESSAGES[error.code];
  }

  // 2. Extract raw message string
  let raw = '';
  if (typeof error === 'string') {
    raw = error;
  } else if (error.message && typeof error.message === 'string') {
    raw = error.message;
  } else if (error.error && typeof error.error === 'string') {
    raw = error.error;
  } else if (error.error?.message && typeof error.error.message === 'string') {
    raw = error.error.message;
  } else {
    raw = String(error);
  }

  // 3. Clean up common error wrappers
  raw = raw.replace(/^Error:\s*/i, '').replace(/^ApiError:\s*/i, '').trim();

  // 4. Try parsing JSON array / Zod issues inside message
  const fromJson = extractFromPotentialJson(raw);
  if (fromJson) {
    return fromJson;
  }

  // If starts with "Server error: [" or "[{"
  if (raw.includes('[') && raw.includes(']')) {
    const bracketMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (bracketMatch) {
      const parsed = extractFromPotentialJson(bracketMatch[0]);
      if (parsed) return parsed;
    }
  }

  // 5. Pattern matching for technical conditions
  const lower = raw.toLowerCase();

  // Network / server connection
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('load failed') ||
    lower.includes('the sign-in service cannot be reached') ||
    lower.includes('api_unavailable')
  ) {
    return 'Unable to reach the admissions server. Please check your internet connection or try again in a few moments.';
  }

  // Authentication & session
  if (lower.includes('session expired') || lower.includes('token expired') || lower.includes('unauthorized') || error.status === 401) {
    return 'Your session has expired. Please sign in again to continue.';
  }
  if (lower.includes('forbidden') || lower.includes('permission') || error.status === 403) {
    return 'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
  }
  if (lower.includes('csrf') || lower.includes('ebadcsrftoken')) {
    return 'Your security token has expired. Please refresh the page and try again.';
  }

  // Database duplicates / integrity
  if (lower.includes('er_dup_entry') || lower.includes('duplicate entry')) {
    return 'A record with this information already exists in the system.';
  }

  // AI & OCR provider limits
  if (lower.includes('503') || lower.includes('high demand') || lower.includes('unavailable')) {
    return 'The AI verification service is experiencing peak traffic. Please try again in a few moments, or review manually.';
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('resource_exhausted')) {
    return 'The AI service rate limit was reached. Please wait a few seconds before retrying.';
  }

  // Scraped / technical server terminal references
  if (lower.includes('check the api server terminal') || lower.includes('check the server terminal') || lower.includes('sqlstate') || lower.includes('syntax error')) {
    return 'A temporary system issue occurred. Please try again in a few moments, or refresh the page.';
  }

  // Multer / file upload
  if (lower.includes('limit_file_size') || lower.includes('file is too large')) {
    return 'The selected file is too large. Please upload a file smaller than 10 MB.';
  }
  if (lower.includes('only csv files are allowed')) {
    return 'Please select a valid CSV spreadsheet (.csv) to upload.';
  }

  // Clean sentence check: if the message does not look like raw code or stack trace, use it
  if (raw.length > 3 && raw.length < 300 && !raw.includes('\n') && !raw.includes('at ') && !raw.includes('{') && !raw.includes('}')) {
    return raw;
  }

  return fallbackMessage;
}

/**
 * Formats a clean notice object for ToastBanner or status banners.
 * @param {string} actionTitle Brief title describing what was attempted (e.g., 'Could not save campaign')
 * @param {any} error The caught error
 * @param {'error'|'warning'|'info'} [type='error']
 * @returns {{ type: string, message: string, detail: string }}
 */
export function formatErrorNotice(actionTitle, error, type = 'error') {
  const detail = formatUserError(error, 'An unexpected error occurred. Please try again.');
  return {
    type,
    message: actionTitle,
    detail: detail !== actionTitle ? detail : undefined,
  };
}

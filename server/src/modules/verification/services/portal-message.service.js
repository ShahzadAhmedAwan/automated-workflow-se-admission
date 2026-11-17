import { config } from '../../../core/config/env.js';
import { DOCUMENT_TYPES } from '../verification.constants.js';

export const DOCUMENT_DISPLAY_NAMES = Object.freeze({
  [DOCUMENT_TYPES.CNIC_FRONT]: 'CNIC / B-Form (Front Side)',
  [DOCUMENT_TYPES.CNIC_BACK]: 'CNIC / B-Form (Back Side)',
  [DOCUMENT_TYPES.FSC_MARKSHEET]: 'FSc / HSSC Intermediate Marksheet',
  [DOCUMENT_TYPES.MATRIC_MARKSHEET]: 'Matric / SSC Marksheet',
  [DOCUMENT_TYPES.DOMICILE]: 'State Domicile Certificate',
  [DOCUMENT_TYPES.EQUIVALENCE_CERTIFICATE]: 'IBCC Equivalence Certificate',
  [DOCUMENT_TYPES.OTHER]: 'Supplementary Educational Document',
});

/**
 * Format a raw document enum into a clean human-readable label
 * e.g. "CNIC_FRONT" -> "CNIC / B-Form (Front Side)"
 */
export function formatDocumentLabel(docType) {
  if (DOCUMENT_DISPLAY_NAMES[docType]) {
    return DOCUMENT_DISPLAY_NAMES[docType];
  }
  return String(docType || '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a compact, clickable public upload portal URL.
 * Uses the short /u/:token route which produces an ~58-character URL
 * that reliably avoids WhatsApp line-wrapping bugs.
 */
export function buildPortalUrl(rawToken) {
  const origin = config.APP_ORIGIN.replace(/\/+$/, '');
  if (!rawToken) return `${origin}/u`;
  return `${origin}/u/${encodeURIComponent(String(rawToken).trim())}`;
}

/**
 * Formats an array of document types into a clean WhatsApp-friendly bulleted list
 */
export function formatDocumentList(docTypes) {
  if (!Array.isArray(docTypes) || docTypes.length === 0) {
    return '- Required Admission Documents';
  }
  return docTypes.map((d) => `- ${formatDocumentLabel(d)}`).join('\n');
}

/**
 * Generates a structured, professional WhatsApp message for document upload requests.
 * Clean, emoji-free academic formatting with a dedicated clickable link.
 */
export function formatUploadRequestMessage({
  studentName = 'Candidate',
  allowedDocTypes = [],
  rawToken,
  uploadUrl,
  expiresInHours = 48,
  customNote = null,
  headerTitle = 'Document Upload Request',
}) {
  const finalUrl = uploadUrl || (rawToken ? buildPortalUrl(rawToken) : `${config.APP_ORIGIN}/u`);
  const docList = formatDocumentList(allowedDocTypes);

  const lines = [
    `*DEPARTMENT OF SOFTWARE ENGINEERING*`,
    `University of Azad Jammu & Kashmir (UAJK)`,
    ``,
    `*${headerTitle}*`,
    ``,
    `Dear *${studentName}*,`,
    ``,
    `Your document verification portal is active. Please upload clear copies (photo or scan) of the following required documents:`,
    ``,
    docList,
  ];

  if (customNote && customNote.trim()) {
    lines.push(``, `*Note from Admissions Office:*`, customNote.trim());
  }

  lines.push(
    ``,
    `*Portal Link:*`,
    finalUrl,
    ``,
    `*Validity:* ${expiresInHours} hours`,
    `*Accepted Formats:* JPEG, PNG, PDF (Max 5MB each)`,
    `*Note:* Single-use secure link. No account login or password required.`
  );

  return lines.join('\n');
}

/**
 * Formats a discrepancy alert message requesting document replacement
 */
export function formatDiscrepancyMessage({
  studentName = 'Candidate',
  docType,
  discrepancyReason,
  rawToken,
  uploadUrl,
  attemptCount = 1,
  maxAttempts = 3,
  expiresInHours = 48,
}) {
  const finalUrl = uploadUrl || (rawToken ? buildPortalUrl(rawToken) : `${config.APP_ORIGIN}/u`);
  const docLabel = docType ? formatDocumentLabel(docType) : 'Document';

  return [
    `*DEPARTMENT OF SOFTWARE ENGINEERING*`,
    `University of Azad Jammu & Kashmir (UAJK)`,
    ``,
    `*Admissions Verification Notice*`,
    ``,
    `Dear *${studentName}*,`,
    ``,
    `Our verification system encountered an issue with your submitted *${docLabel}*:`,
    ``,
    `*Reason:* ${discrepancyReason || 'Document could not be verified'}`,
    ``,
    `Please upload a clear, legible replacement document using your secure link below:`,
    ``,
    `*Re-upload Portal Link:*`,
    finalUrl,
    ``,
    `*Validity:* ${expiresInHours} hours (Attempt ${attemptCount} of ${maxAttempts})`,
    `*Note:* Ensure all 4 corners of the document and official stamps/signatures are clearly visible.`,
  ].join('\n');
}

/**
 * Formats an expiration deadline reminder message
 */
export function formatReminderMessage({
  studentName = 'Candidate',
  pendingDocTypes = [],
  rawToken,
  uploadUrl,
  hoursLeft = 24,
}) {
  const finalUrl = uploadUrl || (rawToken ? buildPortalUrl(rawToken) : `${config.APP_ORIGIN}/u`);
  const docList = formatDocumentList(pendingDocTypes);
  const hourText = hoursLeft === 1 ? '1 hour' : `${hoursLeft} hours`;

  return [
    `*DEPARTMENT OF SOFTWARE ENGINEERING*`,
    `University of Azad Jammu & Kashmir (UAJK)`,
    ``,
    `*Admissions Deadline Reminder*`,
    ``,
    `Dear *${studentName}*,`,
    ``,
    `This is a reminder that your document submission link for Software Engineering admissions expires in *${hourText}*.`,
    ``,
    `*Pending Required Documents:*`,
    docList,
    ``,
    `*Upload Portal Link:*`,
    finalUrl,
    ``,
    `*Important:* Please submit before the deadline closes so your application can be verified in time for the merit list.`,
  ].join('\n');
}

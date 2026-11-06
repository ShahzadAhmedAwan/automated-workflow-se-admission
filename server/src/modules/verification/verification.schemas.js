import { z } from 'zod';
import { DOCUMENT_TYPES } from './verification.constants.js';

const docTypeValues = Object.values(DOCUMENT_TYPES);

export const tokenParamSchema = z.object({
  token: z.string().trim().min(16).max(128),
});

export const submitDocumentsSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

export const reissueTokenSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  allowedDocTypes: z.array(z.enum(docTypeValues)).min(1),
  expiresInHours: z.coerce.number().int().min(1).max(168).default(48),
  reason: z.string().trim().max(500).optional(),
});

export const manualReviewActionSchema = z.object({
  studentId: z.coerce.number().int().positive(),
  documentId: z.coerce.number().int().positive().optional(),
  action: z.enum(['APPROVE', 'REJECT_AND_REISSUE', 'MARK_DISCREPANCY', 'OVERRIDE_MARKS']),
  reviewMethod: z.enum(['STAFF_PORTAL', 'STAFF_GAZETTE', 'STAFF_DOCUMENT']).optional(),
  fscObtainedMarks: z.coerce.number().int().min(0).max(1200).optional(),
  fscTotalMarks: z.coerce.number().int().min(100).max(1200).default(1100).optional(),
  matricObtainedMarks: z.coerce.number().int().min(0).max(1200).optional(),
  matricTotalMarks: z.coerce.number().int().min(100).max(1200).default(1100).optional(),
  discrepancyReason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (['APPROVE', 'OVERRIDE_MARKS'].includes(value.action) && !value.reviewMethod) {
    context.addIssue({ code: 'custom', path: ['reviewMethod'], message: 'Select how the result was verified.' });
  }
  if (['APPROVE', 'OVERRIDE_MARKS'].includes(value.action) && !value.notes?.trim()) {
    context.addIssue({ code: 'custom', path: ['notes'], message: 'Add a short verification note.' });
  }
  if (value.action === 'MARK_DISCREPANCY' && !value.discrepancyReason?.trim()) {
    context.addIssue({ code: 'custom', path: ['discrepancyReason'], message: 'Enter the discrepancy reason.' });
  }
  if (value.action === 'REJECT_AND_REISSUE' && !value.notes?.trim()) {
    context.addIssue({ code: 'custom', path: ['notes'], message: 'Enter the reason for reissue.' });
  }
});

export const discrepancyRowSchema = z.object({
  applicationNo: z.string().trim().max(50).optional().nullable(),
  cnic: z.string().trim().max(30).optional().nullable(),
  fullName: z.string().trim().min(1).max(200),
  fatherName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(8).max(30),
  email: z.string().trim().email().max(254).optional().nullable().or(z.literal('')),
  fscMarks: z.coerce.number().int().min(0).max(1200).optional().nullable(),
  matricMarks: z.coerce.number().int().min(0).max(1200).optional().nullable(),
  issues: z.string().trim().min(1), // e.g. "MATRIC_MARKSHEET; FSC_MARKSHEET"
});

export const bulkDiscrepancyImportSchema = z.object({
  students: z.array(discrepancyRowSchema).min(1).max(2000),
});

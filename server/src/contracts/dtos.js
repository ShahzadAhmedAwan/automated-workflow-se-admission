import { z } from 'zod';

const id = z.number().int().positive();
const normalizedPhone = z.string().regex(/^\d{8,15}$/);

export const eventDtos = Object.freeze({
  LEAD_QUALIFIED: z.object({
    leadId: id,
    fullName: z.string().trim().min(1).max(200),
    fatherName: z.string().trim().max(200).optional().nullable(),
    cnic: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(254).optional().nullable(),
    phoneNormalized: normalizedPhone,
    city: z.string().trim().max(120).optional().nullable(),
    priorDegree: z.string().trim().min(1).max(80).optional().nullable(),
    fscMarks: z.number().int().nonnegative(),
    hasMaths: z.boolean().optional().nullable(),
    eligibleFor: z.string().trim().max(100).optional().nullable(),
  }).passthrough(),
  WHATSAPP_MESSAGE: z.object({
    recipientPhone: normalizedPhone,
    messageType: z.enum(['TRANSACTIONAL', 'CAMPAIGN']),
    messageText: z.string().min(1).max(4000),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  PROCESS_OCR_DOCUMENT: z.object({
    documentId: id,
    studentId: id,
    docType: z.string().trim().min(1).max(80),
    r2Key: z.string().trim().min(1).max(1024),
    fileMime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  }).strict(),
  MIGRATE_GDRIVE: z.object({
    documentId: id,
    studentId: id,
    studentCnic: z.string().regex(/^\d{13}$/),
    filename: z.string().trim().min(1).max(255),
    r2Key: z.string().trim().min(1).max(1024),
    fileMime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  }).strict(),
  USER_WELCOME_EMAIL: z.object({
    userId: z.string().uuid(),
    email: z.string().email(),
    displayName: z.string().trim().min(1),
    role: z.string().min(1),
    initialPassword: z.string().min(1),
    loginUrl: z.string().url().optional(),
  }).strict(),
});

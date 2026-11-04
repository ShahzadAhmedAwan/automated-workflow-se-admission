import { z } from 'zod';

const id = z.number().int().positive();
const normalizedPhone = z.string().regex(/^\d{8,15}$/);

export const eventDtos = Object.freeze({
  LEAD_QUALIFIED: z.object({
    leadId: id,
    fullName: z.string().trim().min(1).max(200),
    phoneNormalized: normalizedPhone,
    city: z.string().trim().max(120),
    priorDegree: z.string().trim().min(1).max(80),
    fscMarks: z.number().int().nonnegative(),
    hasMaths: z.boolean(),
  }).strict(),
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
});

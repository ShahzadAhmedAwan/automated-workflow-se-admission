import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().trim().min(3).max(150),
  description: z.string().trim().max(500).optional().default(''),
}).strict();

export const leadPreviewSchema = z.object({
  campaignId: z.coerce.number().int().positive().optional(),
}).strict();

export const leadImportSchema = z.object({
  campaignId: z.number().int().positive(),
  leads: z.array(z.object({
    fullName: z.string().trim().min(1).max(200),
    phoneRaw: z.string().trim().min(7).max(40),
    phoneNormalized: z.string().regex(/^\d{8,15}$/),
    city: z.string().trim().max(120).optional().default(''),
    priorDegree: z.string().trim().max(80).optional().default(''),
    fatherName: z.string().trim().max(200).optional().nullable(),
    cnic: z.string().trim().max(30).optional().nullable(),
    email: z.string().trim().max(254).optional().nullable(),
    fscMarks: z.coerce.number().int().min(0).max(1100).optional().nullable(),
    hasMaths: z.boolean().optional().nullable(),
    eligibleFor: z.string().trim().max(100).optional().nullable(),
  })).min(1).max(5000),
}).strict();

export const updateLeadSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  fatherName: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().min(7).max(40).optional(),
  cnic: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().max(254).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  priorDegree: z.string().trim().max(80).optional().nullable(),
  fscMarks: z.coerce.number().int().min(0).max(1100).optional().nullable(),
  hasMaths: z.boolean().optional().nullable(),
  eligibleFor: z.string().trim().max(100).optional().nullable(),
  eligibilityStatus: z.enum(['PENDING', 'ELIGIBLE', 'INELIGIBLE']).optional(),
  ineligibilityReason: z.string().trim().max(100).optional().nullable(),
  conversationState: z.enum([
    'IDLE',
    'GREETING_SENT',
    'AWAITING_INTEREST',
    'AWAITING_NAME',
    'AWAITING_FATHER_NAME',
    'AWAITING_MARKS',
    'AWAITING_MATHS',
    'AWAITING_CNIC',
    'AWAITING_EMAIL',
    'QUALIFIED',
    'NOT_INTERESTED',
    'GENERAL_INQUIRY',
  ]).optional(),
}).strict();

export const listLeadsQuerySchema = z.object({
  campaignId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'ELIGIBLE', 'INELIGIBLE']).optional(),
  conversationState: z.string().trim().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const triggerCampaignSchema = z.object({
  jitterMinSeconds: z.number().int().min(5).max(60).default(12),
  jitterMaxSeconds: z.number().int().min(10).max(120).default(28),
  allowedStartHour: z.number().int().min(0).max(23).default(9),
  allowedEndHour: z.number().int().min(0).max(23).default(20),
  customGreeting: z.string().trim().max(1000).optional(),
  sendNow: z.boolean().optional().default(true),
  ignoreDaylight: z.boolean().optional().default(false),
}).strict();

export const incomingMessageWebhookSchema = z.object({
  from: z.string().trim().min(7),
  body: z.string().trim().min(1),
  timestamp: z.coerce.date().optional(),
}).strict();

export const singleLeadOutreachSchema = z.object({
  campaignId: z.coerce.number().int().positive({ message: 'Campaign selection is required.' }),
  fullName: z.string().trim().min(2).max(150),
  phone: z.string().trim().min(7).max(30),
  city: z.string().trim().max(120).optional().default(''),
  priorDegree: z.string().trim().max(80).optional().default(''),
  customGreeting: z.string().trim().max(1000).optional(),
}).strict();

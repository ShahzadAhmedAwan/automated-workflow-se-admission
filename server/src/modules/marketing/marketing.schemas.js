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
  })).min(1).max(5000),
}).strict();

export const triggerCampaignSchema = z.object({
  jitterMinSeconds: z.number().int().min(5).max(60).default(12),
  jitterMaxSeconds: z.number().int().min(10).max(120).default(28),
  allowedStartHour: z.number().int().min(0).max(23).default(9),
  allowedEndHour: z.number().int().min(0).max(23).default(20),
  customGreeting: z.string().trim().max(1000).optional(),
}).strict();

export const incomingMessageWebhookSchema = z.object({
  from: z.string().trim().min(7),
  body: z.string().trim().min(1),
  timestamp: z.coerce.date().optional(),
}).strict();

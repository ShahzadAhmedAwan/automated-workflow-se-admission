import { z } from 'zod';
import { ROLE_NAMES } from './auth.constants.js';

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
}).strict();

export const createUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
  role: z.enum(ROLE_NAMES),
  displayName: z.string().trim().min(1).max(120),
}).strict();

export const updateUserSchema = z.object({
  role: z.enum(ROLE_NAMES).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field must be supplied.');

export const userIdSchema = z.string().uuid();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/),
}).strict();

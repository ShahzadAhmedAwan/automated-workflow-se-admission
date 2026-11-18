import { z } from 'zod';

export const createPolicySchema = z.object({
  name: z.string().trim().min(3).max(150),
  version: z.string().trim().max(30).optional().default('1.0'),
  programCode: z.string().trim().max(40).optional().default('SE'),
  isActive: z.boolean().optional().default(true),
  matricWeightage: z.coerce.number().min(0).max(100).default(10),
  fscWeightage: z.coerce.number().min(0).max(100).default(40),
  entryTestWeightage: z.coerce.number().min(0).max(100).default(50),
  tieBreakerRules: z.array(z.string()).optional().default(['ENTRY_TEST', 'FSC', 'MATRIC', 'AGE']),
  quotaDefinitions: z.array(
    z.object({
      code: z.string().trim().min(1).max(80),
      title: z.string().trim().min(1).max(120),
      seats: z.coerce.number().int().min(0).max(500),
    })
  ).optional().default([
    { code: 'OPEN_MERIT', title: 'Open Merit', seats: 70 },
    { code: 'AJK_REGIONAL', title: 'AJK District Quota', seats: 15 },
    { code: 'SPORTS', title: 'Sports Quota', seats: 5 },
  ]),
}).strict().refine((data) => {
  const sum = Number(data.matricWeightage) + Number(data.fscWeightage) + Number(data.entryTestWeightage);
  return Math.abs(sum - 100) < 0.01;
}, {
  message: 'The sum of Matric, FSc, and Entry Test weightages must equal exactly 100%.',
  path: ['entryTestWeightage'],
});

export const updatePolicySchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  version: z.string().trim().max(30).optional(),
  programCode: z.string().trim().max(40).optional(),
  isActive: z.boolean().optional(),
  matricWeightage: z.coerce.number().min(0).max(100).optional(),
  fscWeightage: z.coerce.number().min(0).max(100).optional(),
  entryTestWeightage: z.coerce.number().min(0).max(100).optional(),
  tieBreakerRules: z.array(z.string()).optional(),
  quotaDefinitions: z.array(
    z.object({
      code: z.string().trim().min(1).max(80),
      title: z.string().trim().min(1).max(120),
      seats: z.coerce.number().int().min(0).max(500),
    })
  ).optional(),
}).strict();

export const seetLookupSchema = z.object({
  cnic: z.string().trim().min(7).max(30),
  simulate: z.boolean().optional().default(false),
}).strict();

export const saveSeetResultSchema = z.object({
  cnic: z.string().trim().min(7).max(30),
  rollNo: z.string().trim().max(50).optional().nullable(),
  candidateName: z.string().trim().max(200).optional().nullable(),
  fatherName: z.string().trim().max(200).optional().nullable(),
  marksObtained: z.coerce.number().min(0).max(200),
  totalMarks: z.coerce.number().min(1).max(200).optional().default(100),
  testDate: z.string().trim().max(40).optional().nullable(),
  sourceType: z.enum(['SEET_PORTAL', 'MANUAL_ENTRY']).optional().default('SEET_PORTAL'),
}).strict();

export const calculateMeritSchema = z.object({
  policyId: z.coerce.number().int().positive().optional(),
  snapshotTitle: z.string().trim().min(3).max(200).optional(),
  iterationNumber: z.coerce.number().int().min(1).max(20).optional().default(1),
  isDryRun: z.boolean().optional().default(false),
}).strict();

export const lockSnapshotSchema = z.object({
  snapshotId: z.coerce.number().int().positive(),
}).strict();

export const notifySelectedSchema = z.object({
  snapshotId: z.coerce.number().int().positive(),
  customMessage: z.string().trim().max(1000).optional(),
  duePaymentDate: z.string().trim().max(60).optional(),
}).strict();

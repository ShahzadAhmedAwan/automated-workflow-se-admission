import { Router } from 'express';
import multer from 'multer';
import { MeritController } from './controllers/merit.controller.js';
import { authenticate, requirePermission } from '../auth/index.js';
import { MERIT_PERMISSIONS } from './merit.constants.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max for PDF gazettes
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only official PDF gazette files are accepted.'));
    }
  },
});

export const meritRoutes = Router();

// Policies
meritRoutes.get(
  '/policies/active',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.getActivePolicy
);

meritRoutes.get(
  '/policies',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.listPolicies
);

meritRoutes.get(
  '/policies/:id',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.getPolicy
);

meritRoutes.post(
  '/policies',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.POLICIES_MANAGE),
  MeritController.createPolicy
);

meritRoutes.put(
  '/policies/:id',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.POLICIES_MANAGE),
  MeritController.updatePolicy
);

// SEET Portal Scraper & Result Sync
meritRoutes.post(
  '/seet/lookup',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.lookupSeet
);

meritRoutes.post(
  '/seet/save',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.POLICIES_MANAGE),
  MeritController.saveSeetResult
);

meritRoutes.post(
  '/seet/sync-verified',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.RUN),
  MeritController.syncVerifiedSeet
);

// Gazette Upload
meritRoutes.post(
  '/gazette/upload',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.RUN),
  upload.single('file'),
  MeritController.uploadGazette
);

// Merit Calculation & Snapshots
meritRoutes.post(
  '/calculate',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.RUN),
  MeritController.calculateMerit
);

meritRoutes.get(
  '/snapshots',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.listSnapshots
);

meritRoutes.get(
  '/snapshots/:id',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.getSnapshot
);

meritRoutes.get(
  '/snapshots/:id/export',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.READ),
  MeritController.exportSnapshot
);

meritRoutes.post(
  '/snapshots/:id/lock',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.SNAPSHOTS_LOCK),
  MeritController.lockSnapshot
);

meritRoutes.post(
  '/snapshots/:id/notify',
  authenticate,
  requirePermission(MERIT_PERMISSIONS.RUN),
  MeritController.notifySelected
);

import { Router } from 'express';
import multer from 'multer';
import { CampaignController } from './controllers/campaign.controller.js';
import { authenticate, requirePermission } from '../auth/index.js';
import { MARKETING_PERMISSIONS } from './marketing.constants.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed.'));
    }
  },
});

export const marketingRoutes = Router();

// Staff-protected campaign management endpoints
marketingRoutes.get(
  '/campaigns',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.listCampaigns
);

marketingRoutes.post(
  '/campaigns',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.createCampaign
);

marketingRoutes.get(
  '/campaigns/:id',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.getCampaign
);

// Two-stage bulk ingestion
marketingRoutes.post(
  '/leads/preview',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  upload.single('file'),
  CampaignController.previewLeads
);

marketingRoutes.post(
  '/leads/import',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.importLeads
);

// Outreach trigger
marketingRoutes.post(
  '/campaigns/:id/outreach',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.triggerOutreach
);

// Broadcast outreach to numbers file
marketingRoutes.post(
  '/broadcast',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  upload.single('file'),
  CampaignController.broadcastNumbers
);

// Incoming WhatsApp webhook (simulated or connected from Baileys)
marketingRoutes.post(
  '/webhook/incoming-message',
  CampaignController.handleIncomingMessage
);

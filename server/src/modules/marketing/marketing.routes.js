import { Router } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { config } from '../../core/config/env.js';
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

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
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

marketingRoutes.delete(
  '/campaigns/:id',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.deleteCampaign
);

// Lead management endpoints (View all students, edit in UI, details)
marketingRoutes.get(
  '/leads',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.listLeads
);

marketingRoutes.get(
  '/leads/:id',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.getLead
);

marketingRoutes.patch(
  '/leads/:id',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.updateLead
);

marketingRoutes.delete(
  '/leads/:id',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.deleteLead
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

// Single student manual outreach
marketingRoutes.post(
  '/leads/single',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.sendSingleLead
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

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.NODE_ENV === 'test' ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many incoming messages. Please slow down.' } },
});

function verifyWebhookSecret(req, res, next) {
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!secret) return next();
  const provided = req.headers['x-webhook-secret'] || req.query.secret;
  if (provided !== secret) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing webhook secret.' } });
  }
  next();
}

// Incoming WhatsApp webhook (simulated or connected from Baileys)
marketingRoutes.post(
  '/webhook/incoming-message',
  webhookLimiter,
  verifyWebhookSecret,
  CampaignController.handleIncomingMessage
);

// Staff-accessible WhatsApp session health status check
marketingRoutes.get(
  '/whatsapp/status',
  authenticate,
  CampaignController.getWhatsAppStatus
);

// Staff-accessible WhatsApp fresh QR retrieval
marketingRoutes.get(
  '/whatsapp/qr',
  authenticate,
  CampaignController.getWhatsAppQr
);

// Staff-accessible WhatsApp session reset (disconnects and generates fresh QR for new number)
marketingRoutes.post(
  '/whatsapp/reset',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.resetWhatsAppSession
);

// Staff-accessible WhatsApp custom number update
marketingRoutes.post(
  '/whatsapp/number',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.updateWhatsAppNumber
);

// AI Knowledge Base document retrieval and update
marketingRoutes.get(
  '/knowledge',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  CampaignController.getKnowledgeBase
);

marketingRoutes.post(
  '/knowledge',
  authenticate,
  requirePermission(MARKETING_PERMISSIONS.CAMPAIGNS_MANAGE),
  docUpload.single('file'),
  CampaignController.updateKnowledgeBase
);

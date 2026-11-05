import { CampaignService } from '../services/campaign.service.js';
import { parseAndPreviewLeads } from '../services/csv-parser.service.js';
import { LeadBotService } from '../services/lead-bot.service.js';
import {
  createCampaignSchema,
  leadImportSchema,
  triggerCampaignSchema,
  incomingMessageWebhookSchema,
} from '../marketing.schemas.js';
import { normalizePhoneNumber } from '../services/csv-parser.service.js';

export class CampaignController {
  static async createCampaign(req, res, next) {
    try {
      const payload = createCampaignSchema.parse(req.body);
      const campaign = await CampaignService.createCampaign({
        ...payload,
        createdBy: req.user?.id || null,
      });
      res.status(201).json({ status: 'success', data: campaign });
    } catch (err) {
      next(err);
    }
  }

  static async listCampaigns(req, res, next) {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const campaigns = await CampaignService.listCampaigns({ limit, offset });
      res.json({ status: 'success', data: campaigns });
    } catch (err) {
      next(err);
    }
  }

  static async getCampaign(req, res, next) {
    try {
      const campaign = await CampaignService.getCampaignById(Number(req.params.id));
      res.json({ status: 'success', data: campaign });
    } catch (err) {
      next(err);
    }
  }

  static async previewLeads(req, res, next) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'A CSV file is required under the "file" field.' });
      }
      const preview = await parseAndPreviewLeads(req.file.buffer);
      res.json({ status: 'success', data: preview });
    } catch (err) {
      next(err);
    }
  }

  static async importLeads(req, res, next) {
    try {
      const payload = leadImportSchema.parse(req.body);
      const result = await CampaignService.importLeads(payload.campaignId, payload.leads);
      res.status(201).json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  static async triggerOutreach(req, res, next) {
    try {
      const options = triggerCampaignSchema.parse(req.body || {});
      const result = await CampaignService.triggerOutreach(Number(req.params.id), options);
      res.json({ status: 'success', data: result });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Webhook or mock entry point for incoming WhatsApp messages
   */
  static async handleIncomingMessage(req, res, next) {
    try {
      const { from, body, timestamp } = incomingMessageWebhookSchema.parse(req.body);
      const normalizedPhone = normalizePhoneNumber(from);
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Invalid sender phone number.' });
      }

      const turnResult = await LeadBotService.processIncomingMessage({
        fromPhone: normalizedPhone,
        messageBody: body,
        rawTimestamp: timestamp || new Date(),
      });

      res.json({ status: 'success', data: turnResult });
    } catch (err) {
      next(err);
    }
  }
}

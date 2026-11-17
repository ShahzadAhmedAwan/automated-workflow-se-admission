import { pool } from '../../../core/db/pool.js';
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

  static async broadcastNumbers(req, res, next) {
    try {
      let fileContent = '';
      if (req.file && req.file.buffer) {
        fileContent = req.file.buffer;
      } else if (req.body?.content) {
        fileContent = req.body.content;
      } else if (Array.isArray(req.body?.numbers)) {
        fileContent = req.body.numbers.join('\n');
      } else {
        return res.status(400).json({ error: 'Provide a file upload or text content with phone numbers.' });
      }

      const result = await CampaignService.broadcastToNumbersFile(fileContent, {
        customMessage: req.body?.customMessage || null,
        campaignId: req.body?.campaignId ? Number(req.body.campaignId) : null,
      });
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

  /**
   * Health check: Returns live WhatsApp Baileys session connection status
   */
  static async getWhatsAppStatus(_req, res, next, db = pool) {
    try {
      const [rows] = await db.query(
        `SELECT setting_value, updated_at FROM sys_settings WHERE setting_key = 'whatsapp_session_status'`
      );

      if (rows && rows.length) {
        const val = typeof rows[0].setting_value === 'string'
          ? JSON.parse(rows[0].setting_value)
          : rows[0].setting_value;
        const updatedAt = new Date(val.updatedAt || rows[0].updated_at);
        const isStale = (Date.now() - updatedAt.getTime()) > 90 * 1000;

        if (!isStale) {
          const connected = val.status === 'CONNECTED';
          return res.json({
            status: 'success',
            data: {
              connected,
              status: val.status || (connected ? 'CONNECTED' : 'DISCONNECTED'),
              phone: val.phone || null,
              updatedAt: updatedAt.toISOString(),
              error: val.error || null,
            },
          });
        }
      }

      // Fallback: If sys_settings has no fresh heartbeat (e.g. running process was started
      // prior to status tracking code or temporary interval lag), inspect live database
      // activity signals from sys_baileys_auth and mkt_leads.
      let fallbackPhone = null;
      try {
        const [credsRows] = await db.query(
          `SELECT data_value, updated_at FROM sys_baileys_auth WHERE session_id = 'default' AND data_key = 'creds'`
        );
        if (credsRows && credsRows.length) {
          const creds = typeof credsRows[0].data_value === 'string'
            ? JSON.parse(credsRows[0].data_value)
            : credsRows[0].data_value;
          if (creds?.me?.id) {
            fallbackPhone = creds.me.id.split(':')[0].replace(/\D/g, '');
          }

          const [activityRows] = await db.query(
            `SELECT MAX(updated_at) AS last_active FROM (
               SELECT updated_at FROM sys_baileys_auth WHERE session_id = 'default'
               UNION ALL
               SELECT updated_at FROM mkt_leads
             ) AS t`
          );

          const lastActive = activityRows?.[0]?.last_active ? new Date(activityRows[0].last_active) : null;
          if (lastActive && (Date.now() - lastActive.getTime()) < 300 * 1000) {
            return res.json({
              status: 'success',
              data: {
                connected: true,
                status: 'CONNECTED',
                phone: fallbackPhone,
                updatedAt: lastActive.toISOString(),
                error: null,
              },
            });
          }
        }
      } catch {
        // Silently pass if sys_baileys_auth is not accessible or in a mock test
      }

      const lastKnown = rows && rows.length ? rows[0] : null;
      const lastVal = lastKnown ? (typeof lastKnown.setting_value === 'string' ? JSON.parse(lastKnown.setting_value) : lastKnown.setting_value) : null;

      res.json({
        status: 'success',
        data: {
          connected: false,
          status: lastVal?.status === 'NEEDS_QR' ? 'NEEDS_QR' : 'OFFLINE',
          phone: lastVal?.phone || fallbackPhone || null,
          updatedAt: lastKnown?.updated_at ? new Date(lastKnown.updated_at).toISOString() : null,
          error: lastVal?.error || null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}

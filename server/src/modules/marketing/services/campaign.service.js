import fs from 'node:fs';
import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import { CAMPAIGN_STATUS, CONVERSATION_STATE } from '../marketing.constants.js';
import { AppError } from '../../../core/errors/app-error.js';
import { normalizePhoneNumber } from './csv-parser.service.js';

export class CampaignService {
  /**
   * Create a new campaign
   */
  static async createCampaign({ name, description, createdBy }, db = pool) {
    const [result] = await db.execute(
      `INSERT INTO mkt_campaigns (name, description, created_by, status)
       VALUES (?, ?, ?, 'DRAFT')`,
      [name, description || null, createdBy || null]
    );
    return {
      id: result.insertId,
      name,
      description,
      status: CAMPAIGN_STATUS.DRAFT,
      totalLeads: 0,
    };
  }

  /**
   * List campaigns
   */
  static async listCampaigns({ limit = 50, offset = 0 } = {}, db = pool) {
    const [rows] = await db.query(
      `SELECT id, name, description, status, total_leads, sent_count, responded_count, eligible_count,
              created_by, created_at, updated_at
       FROM mkt_campaigns
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [Number(limit), Number(offset)]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      totalLeads: r.total_leads,
      sentCount: r.sent_count,
      respondedCount: r.responded_count,
      eligibleCount: r.eligible_count,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get single campaign details with statistics
   */
  static async getCampaignById(campaignId, db = pool) {
    const [rows] = await db.execute(
      `SELECT id, name, description, status, total_leads, sent_count, responded_count, eligible_count,
              created_by, created_at, updated_at
       FROM mkt_campaigns
       WHERE id = ?`,
      [campaignId]
    );
    if (!rows.length) {
      throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
    }
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      totalLeads: r.total_leads,
      sentCount: r.sent_count,
      respondedCount: r.responded_count,
      eligibleCount: r.eligible_count,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /**
   * Batch insert valid leads into mkt_leads under a campaign
   */
  static async importLeads(campaignId, leads, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Check campaign exists
      const [campaigns] = await connection.execute(
        `SELECT id, status FROM mkt_campaigns WHERE id = ? FOR UPDATE`,
        [campaignId]
      );
      if (!campaigns.length) {
        throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
      }

      const batchSize = 250;
      let insertedCount = 0;

      for (let i = 0; i < leads.length; i += batchSize) {
        const batch = leads.slice(i, i + batchSize);
        const values = [];
        const placeholders = batch.map((lead) => {
          values.push(
            campaignId,
            lead.fullName,
            lead.phoneRaw,
            lead.phoneNormalized,
            lead.city || null,
            lead.priorDegree || null,
            CONVERSATION_STATE.IDLE
          );
          return '(?, ?, ?, ?, ?, ?, ?)';
        });

        await connection.query(
          `INSERT INTO mkt_leads (campaign_id, full_name, phone_raw, phone_normalized, city, prior_degree, conversation_state)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        insertedCount += batch.length;
      }

      await connection.execute(
        `UPDATE mkt_campaigns SET total_leads = total_leads + ? WHERE id = ?`,
        [insertedCount, campaignId]
      );

      await connection.commit();
      return { insertedCount, campaignId };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Trigger WhatsApp Outreach campaign with randomized 12-28s jitter and daylight scheduling
   */
  static async triggerOutreach(campaignId, options = {}, db = pool) {
    const {
      jitterMinSeconds = 12,
      jitterMaxSeconds = 28,
      allowedStartHour = 9,
      allowedEndHour = 20,
      customGreeting = null,
      now = new Date(),
    } = options;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Fetch idle leads for this campaign
      const [leads] = await connection.query(
        `SELECT id, full_name, phone_normalized, prior_degree
         FROM mkt_leads
         WHERE campaign_id = ? AND conversation_state = 'IDLE'
         ORDER BY id ASC
         FOR UPDATE`,
        [campaignId]
      );

      if (!leads.length) {
        await connection.commit();
        return { scheduledCount: 0, message: 'No idle leads found to schedule.' };
      }

      // Schedule messages with daylight hours and randomized jitter
      let currentScheduleTime = new Date(now);

      // Adjust schedule start time if currently outside daylight window
      currentScheduleTime = CampaignService.adjustToDaylight(
        currentScheduleTime,
        allowedStartHour,
        allowedEndHour
      );

      const defaultGreeting = (name) =>
        `Assalam-o-Alaikum ${name}! This is an automated message from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK). Are you interested in applying here? Or would you like some information first about the university, department, eligibility, programs, or fee structure? (Reply *Yes* to apply, or ask any question!)`;

      let scheduledCount = 0;

      for (const lead of leads) {
        // Random jitter in seconds
        const jitterSeconds =
          Math.floor(Math.random() * (jitterMaxSeconds - jitterMinSeconds + 1)) +
          jitterMinSeconds;

        currentScheduleTime = new Date(currentScheduleTime.getTime() + jitterSeconds * 1000);
        currentScheduleTime = CampaignService.adjustToDaylight(
          currentScheduleTime,
          allowedStartHour,
          allowedEndHour
        );

        const greetingText = customGreeting
          ? customGreeting.replace(/{name}/gi, lead.full_name)
          : defaultGreeting(lead.full_name);

        // Enqueue WHATSAPP_MESSAGE job
        await dispatchJob({
          queueName: 'whatsapp_outreach',
          jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
          payload: {
            recipientPhone: lead.phone_normalized,
            messageType: 'CAMPAIGN',
            messageText: greetingText,
            metadata: {
              campaignId,
              leadId: lead.id,
              leadName: lead.full_name,
            },
          },
          availableAt: currentScheduleTime,
          connection,
        });

        // Update lead state to GREETING_SENT
        const initialHistory = [
          {
            direction: 'OUTBOUND',
            text: greetingText,
            timestamp: currentScheduleTime.toISOString(),
          },
        ];

        await connection.execute(
          `UPDATE mkt_leads
           SET conversation_state = 'GREETING_SENT',
               chat_history = ?,
               last_interaction_at = ?
           WHERE id = ?`,
          [JSON.stringify(initialHistory), currentScheduleTime, lead.id]
        );

        scheduledCount++;
      }

      // Update campaign status
      await connection.execute(
        `UPDATE mkt_campaigns
         SET status = 'ACTIVE',
             sent_count = sent_count + ?
         WHERE id = ?`,
        [scheduledCount, campaignId]
      );

      await connection.commit();
      return { scheduledCount, campaignId, status: CAMPAIGN_STATUS.ACTIVE };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Broadcast automated outreach text to a list of phone numbers from a text file or buffer
   */
  static async broadcastToNumbersFile(fileContentOrPath, options = {}, db = pool) {
    const {
      jitterMinSeconds = 12,
      jitterMaxSeconds = 28,
      allowedStartHour = 9,
      allowedEndHour = 20,
      customMessage = null,
      campaignId = null,
      now = new Date(),
    } = options;

    let textContent = '';
    if (typeof fileContentOrPath === 'string') {
      if (fs.existsSync(fileContentOrPath)) {
        textContent = fs.readFileSync(fileContentOrPath, 'utf8');
      } else {
        textContent = fileContentOrPath;
      }
    } else if (Buffer.isBuffer(fileContentOrPath)) {
      textContent = fileContentOrPath.toString('utf8');
    }

    const lines = textContent.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

    const parsedEntries = [];
    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      const rawPhone = parts[0];
      const fullName = parts[1] || 'Prospective Applicant';
      const city = parts[2] || null;

      const phoneNormalized = normalizePhoneNumber(rawPhone);
      if (phoneNormalized) {
        parsedEntries.push({ phoneRaw: rawPhone, phoneNormalized, fullName, city });
      }
    }

    if (!parsedEntries.length) {
      return { totalRead: lines.length, scheduledCount: 0, invalidCount: lines.length, message: 'No valid phone numbers found.' };
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const defaultBroadcastMessage = (name) =>
        `Assalam-o-Alaikum ${name !== 'Prospective Applicant' ? name : ''}! This is an automated message from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK).\n\n` +
        `Are you interested in applying here? Or would you like some information first about the university, department, eligibility, programs, fee structure, or courses?\n\n` +
        `• Reply *Yes* to apply\n` +
        `• Or ask any questions you have!`;

      let currentScheduleTime = new Date(now);
      currentScheduleTime = CampaignService.adjustToDaylight(currentScheduleTime, allowedStartHour, allowedEndHour);

      let scheduledCount = 0;

      for (const entry of parsedEntries) {
        // Check if lead already exists
        const [existing] = await connection.query(
          `SELECT id, conversation_state, full_name FROM mkt_leads WHERE phone_normalized = ? LIMIT 1 FOR UPDATE`,
          [entry.phoneNormalized]
        );

        let leadId;
        const targetName = (existing[0]?.full_name && existing[0].full_name !== 'Prospective Applicant')
          ? existing[0].full_name
          : entry.fullName;

        if (existing.length) {
          leadId = existing[0].id;
        } else {
          const [ins] = await connection.execute(
            `INSERT INTO mkt_leads (campaign_id, full_name, phone_raw, phone_normalized, city, conversation_state)
             VALUES (?, ?, ?, ?, ?, 'IDLE')`,
            [campaignId, entry.fullName, entry.phoneRaw, entry.phoneNormalized, entry.city]
          );
          leadId = ins.insertId;
        }

        // Random anti-ban jitter
        const jitterSeconds =
          Math.floor(Math.random() * (jitterMaxSeconds - jitterMinSeconds + 1)) + jitterMinSeconds;
        currentScheduleTime = new Date(currentScheduleTime.getTime() + jitterSeconds * 1000);
        currentScheduleTime = CampaignService.adjustToDaylight(currentScheduleTime, allowedStartHour, allowedEndHour);

        const messageText = customMessage
          ? customMessage.replace(/{name}/gi, targetName)
          : defaultBroadcastMessage(targetName);

        // Dispatch outbound job
        await dispatchJob({
          queueName: 'whatsapp_outreach',
          jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
          payload: {
            recipientPhone: entry.phoneNormalized,
            messageType: 'CAMPAIGN',
            messageText,
            metadata: {
              campaignId,
              leadId,
              leadName: targetName,
            },
          },
          availableAt: currentScheduleTime,
          connection,
        });

        // Set lead state to GREETING_SENT
        const historyEntry = [
          {
            direction: 'OUTBOUND',
            text: messageText,
            timestamp: currentScheduleTime.toISOString(),
          },
        ];

        await connection.execute(
          `UPDATE mkt_leads
           SET conversation_state = 'GREETING_SENT',
               chat_history = ?,
               last_interaction_at = ?
           WHERE id = ?`,
          [JSON.stringify(historyEntry), currentScheduleTime, leadId]
        );

        scheduledCount++;
      }

      await connection.commit();
      return {
        totalRead: lines.length,
        scheduledCount,
        invalidCount: lines.length - parsedEntries.length,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Adjusts a Date object forward to the next valid daylight window (e.g. 09:00 - 20:00)
   */
  static adjustToDaylight(date, startHour = 9, endHour = 20) {
    const d = new Date(date);
    const hour = d.getHours();

    if (hour < startHour) {
      d.setHours(startHour, 0, 0, 0);
    } else if (hour >= endHour) {
      d.setDate(d.getDate() + 1);
      d.setHours(startHour, 0, 0, 0);
    }
    return d;
  }
}

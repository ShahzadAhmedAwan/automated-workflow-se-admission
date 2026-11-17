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
        `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
        `University of Azad Jammu & Kashmir (UAJK)\n\n` +
        `Assalam-o-Alaikum ${name}! This is an automated message from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK).\n\n` +
        `Are you interested in applying here? Or would you like some information first regarding programs, eligibility, fee structure, or hostel facilities?\n\n` +
        `- Reply *Yes* to apply\n` +
        `- Or feel free to ask any question you have!`;

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
        `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
        `University of Azad Jammu & Kashmir (UAJK)\n\n` +
        `Assalam-o-Alaikum ${name !== 'Prospective Applicant' && name ? name : ''}!\n\n` +
        `This is an automated message from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK).\n\n` +
        `Are you interested in applying here? Or would you like some information first about the university, department, eligibility, programs, fee structure, or courses?\n\n` +
        `- Reply *Yes* to apply\n` +
        `- Or ask any questions you have!`;

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
          // Never re-spam candidates who explicitly opted out or already completed qualification
          if (['NOT_INTERESTED', 'QUALIFIED'].includes(existing[0].conversation_state)) {
            continue;
          }
          leadId = existing[0].id;
        } else {
          // Check if student is already enrolled/verified in Admissions
          try {
            const [enrolled] = await connection.query(
              `SELECT id, overall_status FROM adm_students WHERE phone_normalized = ? LIMIT 1`,
              [entry.phoneNormalized]
            );
            if (enrolled.length && enrolled[0].overall_status === 'VERIFIED') {
              continue;
            }
          } catch {
            // Non-blocking in mock environments
          }

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
   * Send WhatsApp greeting to a single student on-demand and register them in mkt_leads
   */
  static async sendSingleLeadOutreach(
    {
      campaignId = null,
      fullName,
      phone,
      city = '',
      priorDegree = '',
      customGreeting = null,
    },
    db = pool
  ) {
    const phoneNormalized = normalizePhoneNumber(phone);
    if (!phoneNormalized) {
      throw new AppError(400, 'INVALID_PHONE_NUMBER', 'Please provide a valid mobile or WhatsApp phone number.');
    }

    const connection = typeof db.getConnection === 'function' ? await db.getConnection() : db;
    const shouldRelease = typeof db.getConnection === 'function' && typeof connection.release === 'function';

    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
      }

      let targetCampaignId = campaignId;
      if (!targetCampaignId) {
        const [cRows] = await connection.query(
          `SELECT id FROM mkt_campaigns ORDER BY id DESC LIMIT 1`
        );
        if (cRows && cRows.length) {
          targetCampaignId = cRows[0].id;
        } else {
          const [newC] = await connection.execute(
            `INSERT INTO mkt_campaigns (name, description, status)
             VALUES ('Direct Outreach', 'Individual student direct outreach', 'ACTIVE')`
          );
          targetCampaignId = newC.insertId;
        }
      }

      // Check if lead already exists
      const [existingLeads] = await connection.query(
        `SELECT id, conversation_state FROM mkt_leads WHERE phone_normalized = ? LIMIT 1`,
        [phoneNormalized]
      );

      let leadId;
      if (existingLeads && existingLeads.length) {
        leadId = existingLeads[0].id;
        await connection.execute(
          `UPDATE mkt_leads
           SET full_name = ?,
               phone_raw = ?,
               city = COALESCE(NULLIF(?, ''), city),
               prior_degree = COALESCE(NULLIF(?, ''), prior_degree),
               conversation_state = 'GREETING_SENT',
               last_interaction_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`,
          [fullName, phone, city, priorDegree, leadId]
        );
      } else {
        const [insertResult] = await connection.execute(
          `INSERT INTO mkt_leads (campaign_id, full_name, phone_raw, phone_normalized, city, prior_degree, conversation_state, last_interaction_at)
           VALUES (?, ?, ?, ?, ?, ?, 'GREETING_SENT', CURRENT_TIMESTAMP(3))`,
          [targetCampaignId, fullName, phone, phoneNormalized, city || null, priorDegree || null]
        );
        leadId = insertResult.insertId;
        await connection.execute(
          `UPDATE mkt_campaigns SET total_leads = total_leads + 1 WHERE id = ?`,
          [targetCampaignId]
        );
      }

      const defaultGreeting = (name) =>
        `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
        `University of Azad Jammu & Kashmir (UAJK)\n\n` +
        `Assalam-o-Alaikum ${name}! This is an automated message from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK).\n\n` +
        `Are you interested in applying here? Or would you like some information first regarding programs, eligibility, fee structure, or hostel facilities?\n\n` +
        `- Reply *Yes* to apply\n` +
        `- Or feel free to ask any question you have!`;

      const greetingText = customGreeting && customGreeting.trim()
        ? customGreeting.replace(/{name}/gi, fullName)
        : defaultGreeting(fullName);

      // Dispatch immediately
      await dispatchJob({
        queueName: 'whatsapp_outreach',
        jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
        payload: {
          recipientPhone: phoneNormalized,
          messageType: 'CAMPAIGN',
          messageText: greetingText,
          metadata: {
            campaignId: targetCampaignId,
            leadId,
            leadName: fullName,
            directOutreach: true,
          },
        },
        availableAt: new Date(),
        connection,
      });

      const initialHistory = [
        {
          direction: 'OUTBOUND',
          text: greetingText,
          timestamp: new Date().toISOString(),
        },
      ];

      await connection.execute(
        `UPDATE mkt_leads
         SET chat_history = ?
         WHERE id = ?`,
        [JSON.stringify(initialHistory), leadId]
      );

      await connection.execute(
        `UPDATE mkt_campaigns SET sent_count = sent_count + 1 WHERE id = ?`,
        [targetCampaignId]
      );

      if (typeof connection.commit === 'function') {
        await connection.commit();
      }

      return {
        leadId,
        fullName,
        phoneNormalized,
        campaignId: targetCampaignId,
        status: 'GREETING_QUEUED',
        message: `WhatsApp greeting dispatched to ${fullName} (${phoneNormalized}).`,
      };
    } catch (err) {
      if (typeof connection.rollback === 'function') {
        await connection.rollback();
      }
      throw err;
    } finally {
      if (shouldRelease) {
        connection.release();
      }
    }
  }

  /**
   * Adjusts a Date object forward to the next valid daylight window (e.g. 09:00 - 20:00).
   * Respects target timezone (defaults to Asia/Karachi in non-test environments or when specified).
   */
  static adjustToDaylight(date, startHour = 9, endHour = 20, timeZone = null) {
    const d = new Date(date);
    const targetTz = timeZone || (process.env.NODE_ENV === 'test' ? null : 'Asia/Karachi');

    if (targetTz) {
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: targetTz,
        hour: 'numeric',
        hour12: false,
      });
      const hourStr = formatter.format(d);
      const hour = parseInt(hourStr, 10);

      if (hour < startHour) {
        const diffHours = startHour - hour;
        d.setTime(d.getTime() + diffHours * 3600 * 1000);
        d.setMinutes(0, 0, 0);
      } else if (hour >= endHour) {
        const diffHours = (24 - hour) + startHour;
        d.setTime(d.getTime() + diffHours * 3600 * 1000);
        d.setMinutes(0, 0, 0);
      }
      return d;
    }

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

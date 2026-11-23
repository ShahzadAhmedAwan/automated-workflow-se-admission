import fs from 'node:fs';
import path from 'node:path';
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
      `SELECT c.id, c.name, c.description, c.status,
              COUNT(l.id) AS total_leads,
              SUM(CASE WHEN l.conversation_state != 'IDLE' THEN 1 ELSE 0 END) AS sent_count,
              SUM(CASE WHEN l.conversation_state NOT IN ('IDLE', 'GREETING_SENT') THEN 1 ELSE 0 END) AS responded_count,
              SUM(CASE WHEN l.eligibility_status = 'ELIGIBLE' OR l.conversation_state = 'QUALIFIED' THEN 1 ELSE 0 END) AS eligible_count,
              c.created_by, c.created_at, c.updated_at
       FROM mkt_campaigns c
       LEFT JOIN mkt_leads l ON l.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT ? OFFSET ?`,
      [Number(limit), Number(offset)]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      totalLeads: Number(r.total_leads || 0),
      sentCount: Number(r.sent_count || 0),
      respondedCount: Number(r.responded_count || 0),
      eligibleCount: Number(r.eligible_count || 0),
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Get single campaign details with statistics
   */
  static async getCampaignById(campaignId, db = pool) {
    const [rows] = await db.query(
      `SELECT c.id, c.name, c.description, c.status,
              COUNT(l.id) AS total_leads,
              SUM(CASE WHEN l.conversation_state != 'IDLE' THEN 1 ELSE 0 END) AS sent_count,
              SUM(CASE WHEN l.conversation_state NOT IN ('IDLE', 'GREETING_SENT') THEN 1 ELSE 0 END) AS responded_count,
              SUM(CASE WHEN l.eligibility_status = 'ELIGIBLE' OR l.conversation_state = 'QUALIFIED' THEN 1 ELSE 0 END) AS eligible_count,
              c.created_by, c.created_at, c.updated_at
       FROM mkt_campaigns c
       LEFT JOIN mkt_leads l ON l.campaign_id = c.id
       WHERE c.id = ?
       GROUP BY c.id`,
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
      totalLeads: Number(r.total_leads || 0),
      sentCount: Number(r.sent_count || 0),
      respondedCount: Number(r.responded_count || 0),
      eligibleCount: Number(r.eligible_count || 0),
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
          const isEligible = lead.fscMarks && (Number(lead.fscMarks) >= 550 || Number(lead.fscMarks) >= 50) && lead.hasMaths !== false;
          values.push(
            campaignId,
            lead.fullName,
            lead.fatherName || null,
            lead.phoneRaw,
            lead.phoneNormalized,
            lead.cnic || null,
            lead.email || null,
            lead.city || null,
            lead.priorDegree || null,
            lead.fscMarks !== undefined && lead.fscMarks !== null ? lead.fscMarks : null,
            lead.hasMaths !== undefined && lead.hasMaths !== null ? (lead.hasMaths ? 1 : 0) : null,
            lead.eligibleFor || (isEligible ? 'SE' : null),
            isEligible ? CONVERSATION_STATE.QUALIFIED : CONVERSATION_STATE.IDLE
          );
          return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
        });

        await connection.query(
          `INSERT INTO mkt_leads (
             campaign_id, full_name, father_name, phone_raw, phone_normalized,
             cnic, email, city, prior_degree, fsc_marks, has_maths, eligible_for, conversation_state
           ) VALUES ${placeholders.join(', ')}`,
          values
        );
        insertedCount += batch.length;

        // Auto-provision candidates into adm_students for eligible leads
        for (const lead of batch) {
          const isEligible = lead.fscMarks && (Number(lead.fscMarks) >= 550 || Number(lead.fscMarks) >= 50) && lead.hasMaths !== false;
          if (isEligible && lead.phoneNormalized) {
            try {
              await connection.query(
                `INSERT INTO adm_students
                   (full_name, father_name, phone_normalized, cnic, email, city, prior_degree, eligible_for, fsc_obtained_marks, overall_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DOCS_REQUESTED')
                 ON DUPLICATE KEY UPDATE
                   full_name = VALUES(full_name),
                   father_name = COALESCE(VALUES(father_name), father_name),
                   cnic = COALESCE(VALUES(cnic), cnic),
                   fsc_obtained_marks = COALESCE(VALUES(fsc_obtained_marks), fsc_obtained_marks)`,
                [
                  lead.fullName,
                  lead.fatherName || null,
                  lead.phoneNormalized,
                  lead.cnic || null,
                  lead.email || null,
                  lead.city || null,
                  lead.priorDegree || null,
                  lead.eligibleFor || 'SE',
                  lead.fscMarks,
                ]
              );
            } catch (admissionsSyncErr) {
              // Non-blocking if table is temporarily busy
            }
          }
        }
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
   * List all student leads across campaigns with full profile data, filters, and linked admissions info
   */
  static async listLeads({ campaignId, status, conversationState, search, limit = 50, offset = 0 } = {}, db = pool) {
    const whereClauses = [];
    const params = [];

    if (campaignId) {
      whereClauses.push('l.campaign_id = ?');
      params.push(Number(campaignId));
    }
    if (status) {
      whereClauses.push('l.eligibility_status = ?');
      params.push(status);
    }
    if (conversationState) {
      whereClauses.push('l.conversation_state = ?');
      params.push(conversationState);
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClauses.push('(l.full_name LIKE ? OR l.father_name LIKE ? OR l.phone_normalized LIKE ? OR l.phone_raw LIKE ? OR l.cnic LIKE ? OR l.email LIKE ? OR l.city LIKE ?)');
      params.push(q, q, q, q, q, q, q);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
    const safeOffset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(offset) || 0)));

    const [rows] = await db.query(
      `SELECT l.id, l.campaign_id, c.name AS campaign_name, l.full_name, l.father_name,
              l.phone_raw, l.phone_normalized, l.cnic, l.email, l.city, l.prior_degree,
              l.fsc_marks, l.has_maths, l.eligible_for, l.eligibility_status, l.ineligibility_reason,
              l.conversation_state, l.last_interaction_at, l.created_at, l.updated_at,
              s.id AS student_id, s.application_no, s.overall_status AS admissions_status
       FROM mkt_leads l
       LEFT JOIN mkt_campaigns c ON c.id = l.campaign_id
       LEFT JOIN adm_students s ON (s.lead_id = l.id OR s.phone_normalized = l.phone_normalized)
       ${whereSql}
       ORDER BY l.id DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      params
    );

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM mkt_leads l ${whereSql}`,
      params
    );

    const [summaryRows] = await db.query(
      `SELECT 
         COUNT(*) AS total_leads,
         SUM(CASE WHEN eligibility_status = 'ELIGIBLE' OR conversation_state = 'QUALIFIED' THEN 1 ELSE 0 END) AS qualified_count,
         SUM(CASE WHEN eligibility_status = 'INELIGIBLE' OR conversation_state = 'NOT_INTERESTED' THEN 1 ELSE 0 END) AS ineligible_count,
         SUM(CASE WHEN eligibility_status = 'PENDING' AND conversation_state != 'QUALIFIED' AND conversation_state != 'NOT_INTERESTED' THEN 1 ELSE 0 END) AS pending_count
       FROM mkt_leads`
    );

    const summary = {
      total: Number(summaryRows[0]?.total_leads || 0),
      qualified: Number(summaryRows[0]?.qualified_count || 0),
      ineligible: Number(summaryRows[0]?.ineligible_count || 0),
      pending: Number(summaryRows[0]?.pending_count || 0),
    };

    return {
      items: rows.map((r) => ({
        id: r.id,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name || 'Unassigned / Direct',
        fullName: r.full_name,
        fatherName: r.father_name,
        phoneRaw: r.phone_raw,
        phoneNormalized: r.phone_normalized,
        cnic: r.cnic,
        email: r.email,
        city: r.city,
        priorDegree: r.prior_degree,
        fscMarks: r.fsc_marks,
        hasMaths: r.has_maths === null ? null : Boolean(r.has_maths),
        eligibleFor: r.eligible_for,
        eligibilityStatus: r.eligibility_status,
        ineligibilityReason: r.ineligibility_reason,
        conversationState: r.conversation_state,
        lastInteractionAt: r.last_interaction_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        admissionsStudentId: r.student_id || null,
        admissionsAppNo: r.application_no || null,
        admissionsStatus: r.admissions_status || null,
      })),
      total: Number(countRows[0]?.total || 0),
      limit: safeLimit,
      offset: safeOffset,
      summary,
    };
  }

  /**
   * Get single lead details with chat history
   */
  static async getLeadById(leadId, db = pool) {
    const [rows] = await db.query(
      `SELECT l.id, l.campaign_id, c.name AS campaign_name, l.full_name, l.father_name,
              l.phone_raw, l.phone_normalized, l.cnic, l.email, l.city, l.prior_degree,
              l.fsc_marks, l.has_maths, l.eligible_for, l.eligibility_status, l.ineligibility_reason,
              l.conversation_state, l.chat_history, l.last_interaction_at, l.created_at, l.updated_at,
              s.id AS student_id, s.application_no, s.overall_status AS admissions_status
       FROM mkt_leads l
       LEFT JOIN mkt_campaigns c ON c.id = l.campaign_id
       LEFT JOIN adm_students s ON (s.lead_id = l.id OR s.phone_normalized = l.phone_normalized)
       WHERE l.id = ?`,
      [Number(leadId)]
    );
    if (!rows.length) {
      throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
    }
    const r = rows[0];
    return {
      id: r.id,
      campaignId: r.campaign_id,
      campaignName: r.campaign_name || 'Unassigned / Direct',
      fullName: r.full_name,
      fatherName: r.father_name,
      phoneRaw: r.phone_raw,
      phoneNormalized: r.phone_normalized,
      cnic: r.cnic,
      email: r.email,
      city: r.city,
      priorDegree: r.prior_degree,
      fscMarks: r.fsc_marks,
      hasMaths: r.has_maths === null ? null : Boolean(r.has_maths),
      eligibleFor: r.eligible_for,
      eligibilityStatus: r.eligibility_status,
      ineligibilityReason: r.ineligibility_reason,
      conversationState: r.conversation_state,
      chatHistory: typeof r.chat_history === 'string' ? JSON.parse(r.chat_history) : r.chat_history || [],
      lastInteractionAt: r.last_interaction_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      admissionsStudentId: r.student_id || null,
      admissionsAppNo: r.application_no || null,
      admissionsStatus: r.admissions_status || null,
    };
  }

  /**
   * Update student lead information from UI and sync with admissions if linked
   */
  static async updateLead(leadId, updates, actorId = null, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [existing] = await connection.query(
        `SELECT * FROM mkt_leads WHERE id = ? FOR UPDATE`,
        [Number(leadId)]
      );
      if (!existing.length) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
      }
      const cur = existing[0];

      const fields = [];
      const values = [];

      if (updates.fullName !== undefined) {
        fields.push('full_name = ?');
        values.push(updates.fullName);
      }
      if (updates.fatherName !== undefined) {
        fields.push('father_name = ?');
        values.push(updates.fatherName || null);
      }
      if (updates.phone !== undefined) {
        const norm = normalizePhoneNumber(updates.phone);
        if (!norm) {
          throw new AppError(400, 'INVALID_PHONE', 'Invalid mobile phone number format.');
        }
        fields.push('phone_raw = ?', 'phone_normalized = ?');
        values.push(updates.phone, norm);
      }
      if (updates.cnic !== undefined) {
        fields.push('cnic = ?');
        values.push(updates.cnic || null);
      }
      if (updates.email !== undefined) {
        fields.push('email = ?');
        values.push(updates.email || null);
      }
      if (updates.city !== undefined) {
        fields.push('city = ?');
        values.push(updates.city || null);
      }
      if (updates.priorDegree !== undefined) {
        fields.push('prior_degree = ?');
        values.push(updates.priorDegree || null);
      }
      if (updates.fscMarks !== undefined) {
        fields.push('fsc_marks = ?');
        values.push(updates.fscMarks !== null ? Number(updates.fscMarks) : null);
      }
      if (updates.hasMaths !== undefined) {
        fields.push('has_maths = ?');
        values.push(updates.hasMaths !== null ? (updates.hasMaths ? 1 : 0) : null);
      }
      if (updates.eligibleFor !== undefined) {
        fields.push('eligible_for = ?');
        values.push(updates.eligibleFor || null);
      }
      if (updates.eligibilityStatus !== undefined) {
        fields.push('eligibility_status = ?');
        values.push(updates.eligibilityStatus);
      }
      if (updates.ineligibilityReason !== undefined) {
        fields.push('ineligibility_reason = ?');
        values.push(updates.ineligibilityReason || null);
      }
      if (updates.conversationState !== undefined) {
        fields.push('conversation_state = ?');
        values.push(updates.conversationState);
      }

      if (fields.length > 0) {
        values.push(Number(leadId));
        await connection.query(
          `UPDATE mkt_leads SET ${fields.join(', ')} WHERE id = ?`,
          values
        );
      }

      // Sync with adm_students if student record exists
      const normPhone = updates.phone ? normalizePhoneNumber(updates.phone) : cur.phone_normalized;
      const [studentRows] = await connection.query(
        `SELECT id FROM adm_students WHERE lead_id = ? OR phone_normalized = ? LIMIT 1`,
        [Number(leadId), cur.phone_normalized]
      );

      const resolvedFullName = updates.fullName !== undefined ? updates.fullName : cur.full_name;
      const resolvedFatherName = updates.fatherName !== undefined ? updates.fatherName : cur.father_name;
      const resolvedCnic = updates.cnic !== undefined ? updates.cnic : cur.cnic;
      const resolvedEmail = updates.email !== undefined ? updates.email : cur.email;
      const resolvedCity = updates.city !== undefined ? updates.city : cur.city;
      const resolvedPriorDegree = updates.priorDegree !== undefined ? updates.priorDegree : cur.prior_degree;
      const resolvedFscMarks = updates.fscMarks !== undefined ? updates.fscMarks : cur.fsc_marks;
      const resolvedEligibleFor = updates.eligibleFor !== undefined ? updates.eligibleFor : cur.eligible_for;

      if (studentRows.length > 0) {
        await connection.query(
          `UPDATE adm_students
           SET full_name = ?,
               father_name = COALESCE(?, father_name),
               phone_normalized = ?,
               cnic = COALESCE(?, cnic),
               email = COALESCE(?, email),
               city = COALESCE(?, city),
               prior_degree = COALESCE(?, prior_degree),
               eligible_for = COALESCE(?, eligible_for),
               fsc_obtained_marks = COALESCE(?, fsc_obtained_marks)
           WHERE id = ?`,
          [
            resolvedFullName,
            resolvedFatherName,
            normPhone,
            resolvedCnic,
            resolvedEmail,
            resolvedCity,
            resolvedPriorDegree,
            resolvedEligibleFor,
            resolvedFscMarks,
            studentRows[0].id,
          ]
        );
      } else if (
        (updates.conversationState === 'QUALIFIED' || updates.eligibilityStatus === 'ELIGIBLE') &&
        (cur.conversation_state !== 'QUALIFIED' && cur.eligibility_status !== 'ELIGIBLE')
      ) {
        // Auto-provision candidate record in adm_students if newly qualified
        await connection.query(
          `INSERT INTO adm_students
             (lead_id, full_name, father_name, phone_normalized, cnic, email, city, prior_degree, eligible_for, fsc_obtained_marks, overall_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DOCS_REQUESTED')
           ON DUPLICATE KEY UPDATE overall_status = VALUES(overall_status)`,
          [
            Number(leadId),
            resolvedFullName,
            resolvedFatherName,
            normPhone,
            resolvedCnic,
            resolvedEmail,
            resolvedCity,
            resolvedPriorDegree,
            resolvedEligibleFor,
            resolvedFscMarks,
          ]
        );
      }

      await connection.commit();
      return await CampaignService.getLeadById(leadId, db);
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Delete a campaign, all its leads, associated students, uploaded docs, and outbox jobs
   */
  static async deleteCampaign(campaignId, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Find all leads belonging to this campaign
      const [leads] = await connection.query(
        'SELECT id, phone_normalized FROM mkt_leads WHERE campaign_id = ?',
        [Number(campaignId)]
      );
      const leadIds = leads.map((l) => l.id);

      if (leadIds.length > 0) {
        const placeholders = leadIds.map(() => '?').join(',');

        // 1. Find associated students
        const [students] = await connection.query(
          `SELECT id FROM adm_students WHERE lead_id IN (${placeholders})`,
          leadIds
        );
        const studentIds = students.map((s) => s.id);

        if (studentIds.length > 0) {
          const sPlaceholders = studentIds.map(() => '?').join(',');

          // Clean up disk documents
          const [docRows] = await connection.query(
            `SELECT storage_key FROM adm_student_documents WHERE student_id IN (${sPlaceholders})`,
            studentIds
          );

          for (const doc of docRows) {
            if (doc.storage_key) {
              const possiblePaths = [
                path.resolve(process.cwd(), 'data', 'uploads', doc.storage_key),
                path.resolve(process.cwd(), 'data', doc.storage_key),
                path.resolve(process.cwd(), 'server', 'data', 'uploads', doc.storage_key),
                path.resolve(process.cwd(), doc.storage_key),
              ];
              for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                  try { fs.unlinkSync(p); } catch {}
                }
              }
            }
          }

          // Delete students (cascades to tokens, documents, merit entries)
          await connection.query(
            `DELETE FROM adm_students WHERE id IN (${sPlaceholders})`,
            studentIds
          );
        }

        // Cancel pending outbox jobs for these leads
        for (const lead of leads) {
          if (lead.phone_normalized) {
            const clean = lead.phone_normalized.replace(/\D/g, '');
            const suffix = clean.length >= 9 ? clean.slice(-9) : clean;
            await connection.query(
              'DELETE FROM outbox_jobs WHERE payload LIKE ?',
              [`%${suffix}%`]
            );
          }
        }

        // Delete leads
        await connection.query(
          `DELETE FROM mkt_leads WHERE id IN (${placeholders})`,
          leadIds
        );
      }

      // Delete the campaign itself
      const [res] = await connection.query(
        'DELETE FROM mkt_campaigns WHERE id = ?',
        [Number(campaignId)]
      );

      if (!res.affectedRows) {
        throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
      }

      await connection.commit();
      return { success: true, campaignId: Number(campaignId) };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async deleteLead(leadId, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [leads] = await connection.query(
        'SELECT id, campaign_id, phone_normalized FROM mkt_leads WHERE id = ?',
        [Number(leadId)]
      );
      if (!leads.length) {
        throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
      }
      const lead = leads[0];

      // Delete associated candidate student if exists
      const [students] = await connection.query(
        'SELECT id FROM adm_students WHERE lead_id = ?',
        [lead.id]
      );
      if (students.length > 0) {
        const studentIds = students.map((s) => s.id);
        const placeholders = studentIds.map(() => '?').join(',');

        const [docRows] = await connection.query(
          `SELECT storage_key FROM adm_student_documents WHERE student_id IN (${placeholders})`,
          studentIds
        );
        for (const doc of docRows) {
          if (doc.storage_key) {
            const possiblePaths = [
              path.resolve(process.cwd(), 'data', 'uploads', doc.storage_key),
              path.resolve(process.cwd(), 'data', doc.storage_key),
              path.resolve(process.cwd(), 'server', 'data', 'uploads', doc.storage_key),
              path.resolve(process.cwd(), doc.storage_key),
            ];
            for (const p of possiblePaths) {
              if (fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch {}
              }
            }
          }
        }

        await connection.query(
          `DELETE FROM adm_students WHERE id IN (${placeholders})`,
          studentIds
        );
      }

      // Cancel outbox jobs for this lead
      if (lead.phone_normalized) {
        const clean = lead.phone_normalized.replace(/\D/g, '');
        const suffix = clean.length >= 9 ? clean.slice(-9) : clean;
        await connection.query(
          'DELETE FROM outbox_jobs WHERE payload LIKE ?',
          [`%${suffix}%`]
        );
      }

      // Delete the lead
      await connection.query('DELETE FROM mkt_leads WHERE id = ?', [lead.id]);

      // If the campaign now has 0 leads, delete the empty campaign!
      if (lead.campaign_id) {
        const [remaining] = await connection.query(
          'SELECT COUNT(*) AS cnt FROM mkt_leads WHERE campaign_id = ?',
          [lead.campaign_id]
        );
        if (remaining[0].cnt === 0) {
          await connection.query('DELETE FROM mkt_campaigns WHERE id = ?', [lead.campaign_id]);
        }
      }

      await connection.commit();
      return { success: true, leadId: Number(leadId) };
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
        `Assalam-o-Alaikum ${name}! Welcome to the Department of Software Engineering at UAJK (Chehla Campus).\n\n` +
        `We are offering the following undergraduate degree programs:\n` +
        `- *B.Sc. Software Engineering* (Accredited by PEC - Pakistan Engineering Council)\n` +
        `- *B.Sc. Software Engineering Technology* (Accredited by NTC - National Technology Council)\n` +
        `- *B.Sc. Computer Engineering Technology* (Accredited by NTC - National Technology Council)\n\n` +
        `Are you interested in knowing more?\n\n` +
        `- Reply *Yes* to know more and check your eligibility\n` +
        `- Or feel free to ask any question you have regarding programs, eligibility, fee structure, or hostel facilities!`;

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
        `Welcome to the Department of Software Engineering at UAJK (Chehla Campus).\n\n` +
        `We are offering the following undergraduate degree programs:\n` +
        `- *B.Sc. Software Engineering* (Accredited by PEC - Pakistan Engineering Council)\n` +
        `- *B.Sc. Software Engineering Technology* (Accredited by NTC - National Technology Council)\n` +
        `- *B.Sc. Computer Engineering Technology* (Accredited by NTC - National Technology Council)\n\n` +
        `Are you interested in knowing more?\n\n` +
        `- Reply *Yes* to know more and check your eligibility\n` +
        `- Or feel free to ask any question you have regarding programs, eligibility, fee structure, or hostel facilities!`;

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
        `Assalam-o-Alaikum ${name}! Welcome to the Department of Software Engineering at UAJK (Chehla Campus).\n\n` +
        `We are offering the following undergraduate degree programs:\n` +
        `- *B.Sc. Software Engineering* (Accredited by PEC - Pakistan Engineering Council)\n` +
        `- *B.Sc. Software Engineering Technology* (Accredited by NTC - National Technology Council)\n` +
        `- *B.Sc. Computer Engineering Technology* (Accredited by NTC - National Technology Council)\n\n` +
        `Are you interested in knowing more?\n\n` +
        `- Reply *Yes* to know more and check your eligibility\n` +
        `- Or feel free to ask any question you have regarding programs, eligibility, fee structure, or hostel facilities!`;

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

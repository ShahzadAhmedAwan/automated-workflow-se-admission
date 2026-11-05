import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  CONVERSATION_STATE,
  ELIGIBILITY_STATUS,
  INELIGIBILITY_REASON,
} from '../marketing.constants.js';

export class LeadBotService {
  /**
   * Helper to detect affirmative responses (Yes, Yup, Han, Ji, interested, etc.)
   */
  static isAffirmative(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const affirmatives = [
      'yes', 'yup', 'yeah', 'yep', 'han', 'jee', 'ji', 'sure', 'interested',
      'y', 'ha', 'bilkul', 'zaroor', 'in', 'ok', 'okay', 'yes please', '1'
    ];
    return affirmatives.includes(clean) || /^(yes|han|ji|yep|yup|interested)\b/i.test(clean);
  }

  /**
   * Helper to detect negative responses (No, Nope, Nahi, Na, etc.)
   */
  static isNegative(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const negatives = [
      'no', 'nope', 'nah', 'nahi', 'nae', 'not interested', 'n', 'no thanks', '2'
    ];
    return negatives.includes(clean) || /^(no|nahi|nope|not interested)\b/i.test(clean);
  }

  /**
   * Parses obtained marks and total marks or percentage from user input
   * e.g. "420/550", "850/1100", "75%", "850", "450 out of 550"
   */
  static parseMarks(text) {
    if (!text) return null;
    const clean = text.trim().replace(/,/g, '');

    // Pattern: 420/550 or 420 / 550 or 420 out of 550
    const ratioMatch = clean.match(/(\d{2,4})\s*(?:\/|\bout\s+of\b)\s*(\d{2,4})/i);
    if (ratioMatch) {
      const obtained = parseFloat(ratioMatch[1]);
      const total = parseFloat(ratioMatch[2]);
      if (total > 0 && obtained <= total) {
        return {
          obtained: Math.round(obtained),
          total: Math.round(total),
          percentage: (obtained / total) * 100,
        };
      }
    }

    // Pattern: 75% or 75.5%
    const percentMatch = clean.match(/(\d{2}(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1]);
      if (pct >= 0 && pct <= 100) {
        return {
          obtained: Math.round(pct * 11), // estimated on 1100
          total: 1100,
          percentage: pct,
        };
      }
    }

    // Bare number: if > 100 assume out of 1100 (Pakistani standard) or out of 550 (Part 1)
    const numMatch = clean.match(/\b(\d{3,4})\b/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (num <= 550) {
        // Likely Part 1 out of 550
        return { obtained: num, total: 550, percentage: (num / 550) * 100 };
      } else if (num <= 1100) {
        // Likely Complete FSc out of 1100
        return { obtained: num, total: 1100, percentage: (num / 1100) * 100 };
      }
    }

    return null;
  }

  /**
   * Main turn processor for incoming applicant WhatsApp messages
   * Follows the deterministic state machine specified in the implementation plan:
   * GREETING_SENT / IDLE -> AWAITING_INTEREST -> AWAITING_MARKS -> AWAITING_MATHS -> QUALIFIED / INELIGIBLE
   */
  static async processIncomingMessage({ fromPhone, messageBody, rawTimestamp = new Date() }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Find lead by normalized phone
      const [leads] = await connection.query(
        `SELECT id, campaign_id, full_name, phone_normalized, city, prior_degree,
                fsc_marks, has_maths, eligibility_status, conversation_state, chat_history
         FROM mkt_leads
         WHERE phone_normalized = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [fromPhone]
      );

      if (!leads.length) {
        // Unsolicited incoming lead - auto-create lead entry
        const [insertRes] = await connection.execute(
          `INSERT INTO mkt_leads (full_name, phone_raw, phone_normalized, conversation_state)
           VALUES ('Prospective Applicant', ?, ?, 'AWAITING_INTEREST')`,
          [fromPhone, fromPhone]
        );
        const newLeadId = insertRes.insertId;

        const reply = "Assalam-o-Alaikum! Welcome to Software Engineering Admissions. Are you interested in applying for Fall 2026? (Reply Yes/No)";

        await LeadBotService.saveTurnAndQueueReply(
          connection,
          newLeadId,
          fromPhone,
          messageBody,
          reply,
          CONVERSATION_STATE.AWAITING_INTEREST,
          [],
          rawTimestamp
        );

        await connection.commit();
        return { reply, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_INTEREST };
      }

      const lead = leads[0];
      const currentState = lead.conversation_state;
      let history = [];
      try {
        const rawHistory = typeof lead.chat_history === 'string'
          ? JSON.parse(lead.chat_history)
          : lead.chat_history;
        history = Array.isArray(rawHistory) ? rawHistory : [];
      } catch {
        history = [];
      }

      let nextState = currentState;
      let replyText = '';
      let qualificationChanged = false;
      let isEligible = lead.eligibility_status === ELIGIBILITY_STATUS.ELIGIBLE;
      let ineligibilityReason = lead.ineligibility_reason;
      let marksObtained = lead.fsc_marks;
      let hasMaths = lead.has_maths;

      switch (currentState) {
        case CONVERSATION_STATE.IDLE:
        case CONVERSATION_STATE.GREETING_SENT: {
          // Evaluating interest
          if (LeadBotService.isAffirmative(messageBody)) {
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText = "Great! What was your obtained score in FSc/ICS Part 1 or Complete? (e.g., 420/550 or 850/1100)";
          } else if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText = "Thank you for letting us know. Best of luck with your future endeavors!";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else {
            // Unclear reply
            replyText = "Please confirm if you are interested in Software Engineering admissions for Fall 2026 by replying *Yes* or *No*.";
          }
          break;
        }

        case CONVERSATION_STATE.AWAITING_INTEREST: {
          if (LeadBotService.isAffirmative(messageBody)) {
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText = "Great! What was your obtained score in FSc/ICS Part 1 or Complete? (e.g., 420/550 or 850/1100)";
          } else if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText = "Thank you for letting us know. Best of luck with your future endeavors!";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else {
            replyText = "Please reply with *Yes* if you are interested in applying, or *No* if you are not.";
          }
          break;
        }

        case CONVERSATION_STATE.AWAITING_MARKS: {
          const parsed = LeadBotService.parseMarks(messageBody);
          if (!parsed) {
            replyText = "We couldn't quite read your marks. Please send your obtained and total marks (for example: *420/550* or *850/1100*).";
          } else {
            marksObtained = parsed.obtained;
            if (parsed.percentage < 50.0) {
              // Less than 50% minimum threshold
              nextState = CONVERSATION_STATE.NOT_INTERESTED;
              qualificationChanged = true;
              isEligible = false;
              ineligibilityReason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
              replyText = `We regret to inform you that the minimum requirement for Software Engineering is 50% marks (your score: ${parsed.percentage.toFixed(1)}%). Unfortunately, you are not eligible for this program.`;
            } else {
              // Eligible on marks, now check Mathematics
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText = `Noted: ${parsed.percentage.toFixed(1)}% marks. Did you study Mathematics as a major subject in FSc/ICS/A-Levels? (Reply *Yes* or *No*)`;
            }
          }
          break;
        }

        case CONVERSATION_STATE.AWAITING_MATHS: {
          if (LeadBotService.isAffirmative(messageBody)) {
            hasMaths = true;
            nextState = CONVERSATION_STATE.QUALIFIED;
            qualificationChanged = true;
            isEligible = true;
            replyText = "Congratulations! You meet the initial eligibility criteria for Software Engineering (Fall 2026). Our Admissions Team will issue your official document intake portal link shortly.";
          } else if (LeadBotService.isNegative(messageBody)) {
            hasMaths = false;
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NO_MATHEMATICS;
            replyText = "Software Engineering requires Mathematics as an essential prerequisite. Since you have not studied Mathematics, you are not eligible for this specific program. We wish you the best in your chosen field!";
          } else {
            replyText = "Please reply with *Yes* if you studied Mathematics, or *No* if you did not.";
          }
          break;
        }

        case CONVERSATION_STATE.QUALIFIED: {
          replyText = "Your eligibility has already been confirmed! You will receive your document verification and upload link very soon. If you have any urgent questions, please feel free to ask.";
          break;
        }

        case CONVERSATION_STATE.NOT_INTERESTED: {
          replyText = "Thank you for your response. Your application file is currently closed. If you wish to re-evaluate, please contact the admissions office.";
          break;
        }

        default: {
          replyText = "Hello! If you are interested in Software Engineering admissions, please reply *Yes*.";
          nextState = CONVERSATION_STATE.AWAITING_INTEREST;
        }
      }

      // Save updated state and enqueue outbound reply
      await LeadBotService.saveTurnAndQueueReply(
        connection,
        lead.id,
        fromPhone,
        messageBody,
        replyText,
        nextState,
        history,
        rawTimestamp,
        {
          fscMarks: marksObtained,
          hasMaths,
          eligibilityStatus: isEligible
            ? ELIGIBILITY_STATUS.ELIGIBLE
            : (ineligibilityReason ? ELIGIBILITY_STATUS.INELIGIBLE : lead.eligibility_status),
          ineligibilityReason,
        }
      );

      // If newly qualified, publish LEAD_QUALIFIED event to outbox_jobs for Module 3 handoff
      if (qualificationChanged && isEligible) {
        await dispatchJob({
          queueName: 'admissions_intake',
          jobType: EVENT_TYPES.LEAD_QUALIFIED,
          payload: {
            leadId: lead.id,
            fullName: lead.full_name,
            phoneNormalized: lead.phone_normalized,
            city: lead.city || '',
            priorDegree: lead.prior_degree || 'FSc Pre-Engineering',
            fscMarks: marksObtained || 0,
            hasMaths: true,
          },
          connection,
        });

        // Increment campaign eligible count if linked to a campaign
        if (lead.campaign_id) {
          await connection.execute(
            `UPDATE mkt_campaigns SET eligible_count = eligible_count + 1 WHERE id = ?`,
            [lead.campaign_id]
          );
        }
      }

      await connection.commit();
      return {
        leadId: lead.id,
        reply: replyText,
        state: nextState,
        eligible: isEligible,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Helper to append to chat history and enqueue the outbound WhatsApp reply
   */
  static async saveTurnAndQueueReply(
    connection,
    leadId,
    phoneNormalized,
    inboundText,
    replyText,
    nextState,
    history,
    timestamp,
    extraFields = {}
  ) {
    const safeHistory = Array.isArray(history) ? history : [];
    const updatedHistory = [
      ...safeHistory,
      { direction: 'INBOUND', text: inboundText, timestamp: new Date(timestamp).toISOString() },
      { direction: 'OUTBOUND', text: replyText, timestamp: new Date().toISOString() },
    ];

    const updates = [
      'conversation_state = ?',
      'chat_history = ?',
      'last_interaction_at = CURRENT_TIMESTAMP(3)',
    ];
    const params = [nextState, JSON.stringify(updatedHistory)];

    if (extraFields.fscMarks !== undefined) {
      updates.push('fsc_marks = ?');
      params.push(extraFields.fscMarks);
    }
    if (extraFields.hasMaths !== undefined) {
      updates.push('has_maths = ?');
      params.push(extraFields.hasMaths);
    }
    if (extraFields.eligibilityStatus !== undefined) {
      updates.push('eligibility_status = ?');
      params.push(extraFields.eligibilityStatus);
    }
    if (extraFields.ineligibilityReason !== undefined) {
      updates.push('ineligibility_reason = ?');
      params.push(extraFields.ineligibilityReason);
    }

    params.push(leadId);

    await connection.execute(
      `UPDATE mkt_leads SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Enqueue outbound reply immediately
    await dispatchJob({
      queueName: 'whatsapp_replies',
      jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
      payload: {
        recipientPhone: phoneNormalized,
        messageType: 'TRANSACTIONAL',
        messageText: replyText,
        metadata: { leadId, state: nextState },
      },
      connection,
    });
  }
}

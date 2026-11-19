import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  CONVERSATION_STATE,
  ELIGIBILITY_STATUS,
  INELIGIBILITY_REASON,
  PROGRAM_ELIGIBILITY,
} from '../marketing.constants.js';
import { AIKnowledgeService } from './ai-knowledge.service.js';

export class LeadBotService {
  /**
   * Helper to detect greeting messages
   */
  static isGreeting(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const greetings = [
      'hello', 'hi', 'hey', 'salam', 'aoa', 'assalam', 'assalam o alaikum',
      'assalam-o-alaikum', 'assalamu alaikum', 'start', 'help', 'info',
      'admissions', 'admission'
    ];
    return (
      greetings.includes(clean) ||
      /^(hi|hello|hey|salam|aoa|assalam)\b/i.test(clean)
    );
  }

  /**
   * Helper to detect affirmative responses (Yes, Yup, Han, Ji, interested, etc.)
   */
  static isAffirmative(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const affirmatives = [
      'yes', 'yup', 'yeah', 'yep', 'han', 'jee', 'ji', 'sure', 'interested',
      'y', 'ha', 'bilkul', 'zaroor', 'in', 'ok', 'okay', 'yes please', '1',
      'apply', 'want to apply', 'i want to apply', 'interested in applying',
      'know more', 'want to know more', 'more info', 'tell me more', 'interested in knowing more'
    ];
    return (
      affirmatives.includes(clean) ||
      /^(yes|han|ji|yep|yup|interested|definitely)\b/i.test(clean) ||
      /\b(know more|tell me more|more details|more info)\b/i.test(clean)
    );
  }

  /**
   * Helper to detect negative / opt-out responses (No, Nope, Nahi, I don't want to, Not interested, etc.)
   */
  static isNegative(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const negatives = [
      'no', 'nope', 'nah', 'nahi', 'nae', 'not interested', 'n', 'no thanks',
      'not now', 'later', 'never', '2', "don't want", "dont want",
      "i don't want to", "i dont want to", "i don't want", "i dont want",
      "stop", "stop texting", "stop messaging", "don't message", "dont message",
      "no need", "nahi chahiye", "nahi karna", "nahi karni", "cancel", "quit"
    ];
    return (
      negatives.includes(clean) ||
      /\b(not interested|don'?t want|stop (texting|messaging)|no thanks|no need|nahi chahiye|nahi karna|leave me|unsubscribe|cancel)\b/i.test(
        clean
      ) ||
      /^(no|nahi|nope|nah)\b/i.test(clean)
    );
  }

  /**
   * Validates if a text is a plausible full name or father's name
   */
  static isValidName(text) {
    if (!text) return false;
    const clean = text.trim();
    // Cannot be a pure question or numbers
    if (clean.length < 2 || clean.length > 80) return false;
    if (AIKnowledgeService.isQuestion(clean)) return false;
    if (/^\d+$/.test(clean)) return false;
    // Must contain letters
    return /^[a-zA-Z\s.']{2,80}$/.test(clean);
  }

  /**
   * Validates and normalizes Pakistani 13-digit CNIC / Form-B
   */
  static parseCnic(text) {
    if (!text) return null;
    const digits = text.replace(/\D/g, '');
    if (digits.length === 13) {
      return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
    }
    return null;
  }

  /**
   * Validates and extracts email address
   */
  static parseEmail(text) {
    if (!text) return null;
    const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return match ? match[0].toLowerCase() : null;
  }

  /**
   * Parses obtained marks and total marks or percentage from user input
   * e.g. "890/1100", "420/550", "850 out of 1100", "750/900", "500", "900", "60%"
   */
  static parseMarks(text) {
    if (!text) return null;
    const clean = text.trim().replace(/,/g, '');

    // Guard: Do not treat phone numbers or CNIC as marks
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length >= 7 && !clean.includes('/') && !clean.toLowerCase().includes('out of')) {
      return null;
    }

    // Pattern 1: Ratio format like 890/1100, 420/550, 420 out of 550, 750/900, 800/1000
    const ratioMatch = clean.match(/(\d{1,5})\s*(?:\/|\bout\s+of\b)\s*(\d{1,5})/i);
    if (ratioMatch) {
      const obtained = parseFloat(ratioMatch[1]);
      const total = parseFloat(ratioMatch[2]);

      if (total <= 0) {
        return {
          error: 'INVALID_TOTAL',
          obtained: Math.round(obtained),
          total: Math.round(total),
        };
      }

      if (obtained > total) {
        return {
          error: 'OBTAINED_EXCEEDS_TOTAL',
          obtained: Math.round(obtained),
          total: Math.round(total),
        };
      }

      return {
        obtained: Math.round(obtained),
        total: Math.round(total),
        percentage: (obtained / total) * 100,
      };
    }

    // Pattern 2: Percentage format like 60%, 75%, 75.5%, 100%, 120%
    const percentMatch = clean.match(/(?:^|[^\d])(\d{1,3}(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      const pct = parseFloat(percentMatch[1]);
      if (pct > 100) {
        return {
          error: 'PERCENTAGE_EXCEEDS_100',
          percentage: pct,
        };
      }
      if (pct >= 0 && pct <= 100) {
        return {
          isPartial: true,
          type: 'PERCENTAGE_ONLY',
          percentage: pct,
        };
      }
    }

    // If string contained an explicit separator ('/' or 'out of' or '%'),
    // do NOT fall through to bare number regex.
    if (/[\/%]|\bout\s+of\b/i.test(clean)) {
      return null;
    }

    // Pattern 3: Bare number like 500, 900
    const numMatch = clean.match(/\b(\d{2,5})\b/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (num >= 50 && num <= 5000) {
        return {
          isPartial: true,
          type: 'OBTAINED_ONLY',
          obtained: num,
        };
      }
    }

    return null;
  }

  /**
   * Parses total marks when a user responds with just total marks (e.g. "1100", "550", "total 1100", "out of 1100")
   */
  static parseTotalMarks(text) {
    if (!text) return null;
    const clean = text.trim().replace(/,/g, '');

    // If ratio like "890/1100" is sent, parseMarks handles it
    if (/\//.test(clean)) return null;

    // Pattern 1: Explicit keywords e.g. "total 1100", "total is 1100", "out of 1100", "kul marks 1100"
    const keywordMatch = clean.match(/(?:total(?:\s+marks)?|out\s+of|kul(?:\s+number|\s+marks)?)\s*(?:is|hain|are|:|=)?\s*(\d{2,5})/i);
    if (keywordMatch) {
      const total = parseInt(keywordMatch[1], 10);
      return total > 0 ? total : null;
    }

    // Pattern 2: Standalone number e.g. "1100", "550", "1100 total", "it was 1100"
    const numMatch = clean.match(/\b(\d{2,5})\b/);
    if (numMatch) {
      const total = parseInt(numMatch[1], 10);
      if (total >= 50 && total <= 5000) {
        return total;
      }
    }

    return null;
  }

  /**
   * Helper to return standard re-prompt text for an intake state
   */
  static getPromptForState(state, lead = {}) {
    switch (state) {
      case CONVERSATION_STATE.AWAITING_NAME:
        return "Could you please tell me your *Full Name*?";
      case CONVERSATION_STATE.AWAITING_FATHER_NAME:
        return "Could you please tell me your *Father's Name*?";
      case CONVERSATION_STATE.AWAITING_MARKS:
        if (lead.fsc_marks) {
          return "Could you please let us know your *Total Marks* (e.g. out of *1100* or *550*)?";
        }
        return "What was your score in FSc / ICS / DAE (Part 1 or 2)? (Please provide obtained and total marks, e.g. *890/1100* or *420/550*)";
      case CONVERSATION_STATE.AWAITING_MATHS:
        return "Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)";
      case CONVERSATION_STATE.AWAITING_CNIC:
        return "Please provide your 13-digit CNIC or Form-B number (e.g. *12345-1234567-1*).";
      case CONVERSATION_STATE.AWAITING_EMAIL:
        return "Please provide your active *Email Address* (e.g. *applicant@example.com*).";
      default:
        return "Please let us know how we can assist you.";
    }
  }

  /**
   * Helper to detect correction / edit / mistake intent in English and Roman Urdu
   */
  static isCorrectionIntent(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const patterns = [
      /\b(mistake|ghalti|galti|galati|ghlti|wrong|galat|ghalat)\b/i,
      /\b(correct|correction|edit|change|update|modify|replace|reset)\b/i,
      /\b(wanna correct|want to correct|can i change|kuch change|theek karna|sahi karna|durust)\b/i,
      /\b(by mistake|mistakenly|glat likh|ghalat likh|wrong entry|i made a mistake|i did a mistake)\b/i,
      /\b(change marks|change name|change cnic|change email|change father|change group)\b/i,
    ];
    return patterns.some((p) => p.test(clean));
  }

  /**
   * Helper to format standard or updated confirmation summary
   */
  static formatConfirmationMessage({ fullName, fatherName, cnic, email, marks, isUpdated = false }) {
    const title = isUpdated ? "*Admissions Pre-Registration Updated*" : "*Admissions Pre-Registration Confirmed*";
    const greeting = isUpdated
      ? `Your details have been successfully updated, *${fullName || 'Candidate'}*.`
      : `Congratulations *${fullName || 'Candidate'}*,\n\nYour admission interest for the Department of Software Engineering at UAJK has been successfully recorded.`;
    const summaryTitle = isUpdated ? "*Updated Application Summary:*" : "*Application Summary:*";

    return (
      `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
      `University of Azad Jammu & Kashmir (UAJK)\n\n` +
      `${title}\n\n` +
      `${greeting}\n\n` +
      `${summaryTitle}\n` +
      `- Candidate: ${fullName || 'Candidate'}\n` +
      `- Father's Name: ${fatherName || 'On Record'}\n` +
      `- CNIC/B-Form: ${cnic || 'On Record'}\n` +
      `- Email: ${email || 'On Record'}\n` +
      `- FSc Marks: ${marks || 'Recorded'}\n\n` +
      `Our admissions office will process your profile and issue your document verification portal link shortly.\n` +
      `If you have any questions regarding hostel, fees, or entry test, feel free to ask anytime.`
    );
  }

  /**
   * Helper to return the interactive correction options menu
   */
  static getCorrectionMenuText() {
    return (
      "No problem at all! You can easily update your information.\n\n" +
      "What would you like to correct?\n" +
      "1. Full Name\n" +
      "2. Father's Name\n" +
      "3. Marks (FSc / ICS / DAE)\n" +
      "4. Academic Group (Pre-Eng / ICS / Pre-Med / DAE)\n" +
      "5. CNIC / Form-B\n" +
      "6. Email Address\n" +
      "7. All Details (Start over from scratch)\n\n" +
      "Please reply with the number (1-7) or tell me what was wrong (for example: reply *3* or *Marks* to correct your score, or send your correct details directly)."
    );
  }

  /**
   * Main turn processor for incoming applicant WhatsApp messages
   * Deterministic, graceful multi-case qualification engine
   */
  static async processIncomingMessage({ fromPhone, messageBody, rawTimestamp = new Date(), queueReply = true }, db = pool) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Find lead by normalized phone
      const [leads] = await connection.query(
        `SELECT id, campaign_id, full_name, father_name, phone_normalized, cnic, email,
                city, prior_degree, fsc_marks, has_maths, eligible_for, eligibility_status,
                conversation_state, chat_history
         FROM mkt_leads
         WHERE phone_normalized = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [fromPhone]
      );

      const standardGreeting =
        "*DEPARTMENT OF SOFTWARE ENGINEERING*\n" +
        "University of Azad Jammu & Kashmir (UAJK)\n\n" +
        "Assalam-o-Alaikum! Welcome to the Department of Software Engineering at UAJK (Chehla Campus).\n\n" +
        "We are offering the following undergraduate degree programs:\n" +
        "- *B.Sc. Software Engineering* (Accredited by PEC - Pakistan Engineering Council)\n" +
        "- *B.Sc. Software Engineering Technology* (Accredited by NTC - National Technology Council)\n" +
        "- *B.Sc. Computer Engineering Technology* (Accredited by NTC - National Technology Council)\n\n" +
        "Are you interested in knowing more?\n\n" +
        "- Reply *Yes* to know more and check your eligibility\n" +
        "- Or feel free to ask any question you have regarding programs, eligibility, fee structure, or hostel facilities!";

      // If new unsolicited lead
      if (!leads.length) {
        const [insertRes] = await connection.execute(
          `INSERT INTO mkt_leads (full_name, phone_raw, phone_normalized, conversation_state)
           VALUES ('Prospective Applicant', ?, ?, 'AWAITING_INTEREST')`,
          [fromPhone, fromPhone]
        );
        const newLeadId = insertRes.insertId;

        // If the very first message is already asking a question (Case 3)
        if (AIKnowledgeService.isQuestion(messageBody)) {
          const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, []);
          const reply =
            `${aiAnswer}\n\n` +
            `Are you interested in knowing more? (Reply *Yes* to check your eligibility, or feel free to ask any other questions)`;

          await LeadBotService.saveTurnAndQueueReply(
            connection,
            newLeadId,
            fromPhone,
            messageBody,
            reply,
            CONVERSATION_STATE.AWAITING_INTEREST,
            [],
            rawTimestamp,
            {},
            { queueReply }
          );

          await connection.commit();
          return { reply, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_INTEREST };
        }

        // If the very first message has marks (e.g. 890/1100, 500, 900, 60%)
        const firstMsgMarks = LeadBotService.parseMarks(messageBody);
        if (firstMsgMarks) {
          if (firstMsgMarks.error) {
            let reply = "Please provide your valid marks as obtained/total (for example: *890/1100* or *420/550*).";
            if (firstMsgMarks.error === 'OBTAINED_EXCEEDS_TOTAL') {
              reply = `The obtained marks (*${firstMsgMarks.obtained}*) cannot exceed total marks (*${firstMsgMarks.total}*).\n\nPlease provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else if (firstMsgMarks.error === 'PERCENTAGE_EXCEEDS_100') {
              reply = `Percentage (*${firstMsgMarks.percentage}%*) cannot exceed 100%.\n\nPlease provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            }
            await LeadBotService.saveTurnAndQueueReply(
              connection, newLeadId, fromPhone, messageBody, reply,
              CONVERSATION_STATE.AWAITING_MARKS, [], rawTimestamp, {}, { queueReply }
            );
            await connection.commit();
            return { reply, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_MARKS };
          } else if (firstMsgMarks.isPartial) {
            let reply = '';
            if (firstMsgMarks.type === 'OBTAINED_ONLY') {
              reply = `Noted: *${firstMsgMarks.obtained}* marks. Could you please also let us know your *Total Marks*?\n*(For example: out of 1100, 550, or whatever your total was)*`;
            } else {
              reply = `Noted: *${firstMsgMarks.percentage}%*. Could you please also let us know your obtained and total marks?\n*(For example: 660/1100 or 330/550, or what was your total score?)*`;
            }
            await LeadBotService.saveTurnAndQueueReply(
              connection, newLeadId, fromPhone, messageBody, reply,
              CONVERSATION_STATE.AWAITING_MARKS, [], rawTimestamp,
              { fscMarks: firstMsgMarks.type === 'OBTAINED_ONLY' ? firstMsgMarks.obtained : null },
              { queueReply }
            );
            await connection.commit();
            return { reply, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_MARKS };
          } else {
            const pct = firstMsgMarks.percentage;
            if (pct < 50.0) {
              const reply =
                `Thank you for sharing your marks. The minimum requirement for Engineering & Technology programs at UAJK is 50% (your score: ${pct.toFixed(1)}%).\n\n` +
                `Unfortunately, you do not meet the minimum threshold for SE, SET, or CET. If you wish to learn about other programs or have questions, feel free to ask anytime!`;
              await LeadBotService.saveTurnAndQueueReply(
                connection, newLeadId, fromPhone, messageBody, reply,
                CONVERSATION_STATE.NOT_INTERESTED, [], rawTimestamp,
                {
                  fscMarks: firstMsgMarks.obtained,
                  eligibilityStatus: ELIGIBILITY_STATUS.INELIGIBLE,
                  ineligibilityReason: INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50,
                  eligibleFor: PROGRAM_ELIGIBILITY.NONE,
                },
                { queueReply }
              );
              await connection.commit();
              return { reply, leadId: newLeadId, state: CONVERSATION_STATE.NOT_INTERESTED };
            } else {
              const elg = pct >= 60.0 ? PROGRAM_ELIGIBILITY.SE_SET_CET : PROGRAM_ELIGIBILITY.SET_CET;
              const reply = `Thank you! Noted: *${pct.toFixed(1)}%* marks (${firstMsgMarks.obtained}/${firstMsgMarks.total}).\n\nTo check your program eligibility and register your admission inquiry, what is your *Full Name*?`;
              await LeadBotService.saveTurnAndQueueReply(
                connection, newLeadId, fromPhone, messageBody, reply,
                CONVERSATION_STATE.AWAITING_NAME, [], rawTimestamp,
                { fscMarks: firstMsgMarks.obtained, eligibleFor: elg },
                { queueReply }
              );
              await connection.commit();
              return { reply, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_NAME };
            }
          }
        }

        // Standard welcome greeting
        await LeadBotService.saveTurnAndQueueReply(
          connection,
          newLeadId,
          fromPhone,
          messageBody,
          standardGreeting,
          CONVERSATION_STATE.AWAITING_INTEREST,
          [],
          rawTimestamp,
          {},
          { queueReply }
        );

        await connection.commit();
        return { reply: standardGreeting, leadId: newLeadId, state: CONVERSATION_STATE.AWAITING_INTEREST };
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
      let fullName = lead.full_name;
      let fatherName = lead.father_name;
      let cnic = lead.cnic;
      let email = lead.email;
      let eligibleFor = lead.eligible_for;
      let priorDegree = lead.prior_degree;

      switch (currentState) {
        // ---------------------------------------------------------------------
        // Initial Interest & Greetings
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.IDLE:
        case CONVERSATION_STATE.GREETING_SENT:
        case CONVERSATION_STATE.AWAITING_INTEREST: {
          const marksInMsg = LeadBotService.parseMarks(messageBody);

          // If student explicitly says No / not interested
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs, eligibility, or courses, please feel free to ask anytime!";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          }
          // If student writes marks in the first question (e.g. 890/1100, 800/1000, 500, 900, 60%)
          else if (marksInMsg) {
            if (marksInMsg.error) {
              if (marksInMsg.error === 'OBTAINED_EXCEEDS_TOTAL') {
                replyText =
                  `The obtained marks (*${marksInMsg.obtained}*) cannot exceed total marks (*${marksInMsg.total}*).\n\n` +
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
              } else if (marksInMsg.error === 'PERCENTAGE_EXCEEDS_100') {
                replyText =
                  `Percentage (*${marksInMsg.percentage}%*) cannot exceed 100%.\n\n` +
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
              } else {
                replyText =
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
              }
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
            } else if (marksInMsg.isPartial) {
              if (marksInMsg.type === 'OBTAINED_ONLY') {
                marksObtained = marksInMsg.obtained;
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText =
                  `Noted: *${marksInMsg.obtained}* marks. Could you please also let us know your *Total Marks*?\n` +
                  `*(For example: out of 1100, 550, or whatever your total was)*`;
              } else if (marksInMsg.type === 'PERCENTAGE_ONLY') {
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText =
                  `Noted: *${marksInMsg.percentage}%*. Could you please also let us know your obtained and total marks?\n` +
                  `*(For example: 660/1100 or 330/550, or what was your total score?)*`;
              }
            } else {
              // Full ratio in first question (e.g. 890/1100, 800/1000)
              marksObtained = marksInMsg.obtained;

              const cleanMsg = messageBody.toLowerCase();
              if (
                cleanMsg.includes('pre-medical') ||
                cleanMsg.includes('pre medical') ||
                cleanMsg.includes('pre-med') ||
                cleanMsg.includes('medical')
              ) {
                priorDegree = 'Pre-Medical';
                hasMaths = false;
              } else if (cleanMsg.includes('ics')) {
                priorDegree = 'ICS';
                hasMaths = true;
              } else if (cleanMsg.includes('pre-eng')) {
                priorDegree = 'FSc Pre-Engineering';
                hasMaths = true;
              } else if (cleanMsg.includes('dae')) {
                priorDegree = 'DAE';
                hasMaths = true;
              }

              if (marksInMsg.percentage < 50.0) {
                nextState = CONVERSATION_STATE.NOT_INTERESTED;
                qualificationChanged = true;
                isEligible = false;
                ineligibilityReason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
                eligibleFor = PROGRAM_ELIGIBILITY.NONE;
                replyText =
                  `Thank you for sharing your marks. The minimum requirement for Engineering & Technology programs at UAJK is 50% (your score: ${marksInMsg.percentage.toFixed(1)}%).\n\n` +
                  `Unfortunately, you do not meet the minimum threshold for SE, SET, or CET. If you wish to learn about other programs or have questions, feel free to ask anytime!`;
              } else {
                eligibleFor = marksInMsg.percentage >= 60.0 ? PROGRAM_ELIGIBILITY.SE_SET_CET : PROGRAM_ELIGIBILITY.SET_CET;

                const hasKnownName =
                  fullName &&
                  fullName.trim() &&
                  !fullName.toLowerCase().includes('prospective applicant');

                if (hasKnownName) {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = `Thank you, *${fullName}*! Noted: *${marksInMsg.percentage.toFixed(1)}%* marks (${marksInMsg.obtained}/${marksInMsg.total}).\n\nTo check your program eligibility and register your inquiry, what is your *Father's Name*?`;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_NAME;
                  replyText = `Thank you! Noted: *${marksInMsg.percentage.toFixed(1)}%* marks (${marksInMsg.obtained}/${marksInMsg.total}).\n\nTo check your program eligibility and register your inquiry, what is your *Full Name*?`;
                }
              }
            }
          }
          // Case 1: Student says Yes / interested
          else if (LeadBotService.isAffirmative(messageBody)) {
            const hasKnownName =
              fullName &&
              fullName.trim() &&
              !fullName.toLowerCase().includes('prospective applicant');

            if (hasKnownName) {
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
              replyText = `Great to have you with us, *${fullName}*! To register your admission inquiry, what is your *Father's Name*?`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_NAME;
              replyText = "Great! Let's get your admission inquiry registered. What is your *Full Name*?";
            }
          }
          // Case 3: Student asks a question or random inquiry
          else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `Are you interested in knowing more? (Reply *Yes* to check your eligibility, or feel free to ask any other questions)`;
            nextState = CONVERSATION_STATE.AWAITING_INTEREST;
          }
          // Student sends a greeting
          else if (LeadBotService.isGreeting(messageBody)) {
            replyText = standardGreeting;
            nextState = CONVERSATION_STATE.AWAITING_INTEREST;
          }
          // Fallback clarification
          else {
            replyText =
              "Assalam-o-Alaikum! We are offering B.Sc. Software Engineering (PEC accredited), SET (NTC accredited), and CET (NTC accredited).\n\n" +
              "Are you interested in knowing more? Reply with *Yes* to check your eligibility, or feel free to ask any question you have!";
            nextState = CONVERSATION_STATE.AWAITING_INTEREST;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 1: Candidate Full Name
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_NAME: {
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your admission registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME)}`;
            nextState = CONVERSATION_STATE.AWAITING_NAME;
          } else if (LeadBotService.isValidName(messageBody)) {
            fullName = messageBody.trim();
            if (fatherName && cnic && email && marksObtained) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else if (fatherName && marksObtained) {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText =
                `Thank you, *${fullName}*!\n\n` +
                `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
            } else if (fatherName) {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Thank you, *${fullName}*! What was your score in FSc / ICS / DAE (Part 1 or Complete)?\n` +
                `*(Please provide obtained and total marks, e.g. 890/1100 or 420/550)*`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
              replyText = `Thank you, *${fullName}*! What is your *Father's Name*?`;
            }
          } else {
            replyText =
              "Please enter a valid full name (alphabetic characters only, e.g. *Muhammad Ali*).\n\n" +
              "If you have a question instead, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_NAME;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 2: Father Name
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_FATHER_NAME: {
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME)}`;
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
          } else if (LeadBotService.isValidName(messageBody)) {
            fatherName = messageBody.trim();
            if (cnic && email && marksObtained) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else if (marksObtained) {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText =
                `Thank you, *${fullName}*!\n\n` +
                `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted. What was your score in FSc / ICS / DAE (Part 1 or Complete)?\n` +
                `*(Please provide obtained and total marks, e.g. 890/1100 or 420/550)*`;
            }
          } else {
            replyText =
              "Please enter a valid Father's name (letters only, e.g. *Tariq Mahmood*).\n\n" +
              "If you have a question, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 3: FSc Marks
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_MARKS: {
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
            break;
          }

          const lastOutbound = history.filter((h) => h.direction === 'OUTBOUND').slice(-1)[0]?.text || '';
          const wasAskedTotalMarks =
            lastOutbound.includes('Total Marks') ||
            lastOutbound.includes('total marks');

          const parsed = LeadBotService.parseMarks(messageBody);
          const parsedTotalOnly = wasAskedTotalMarks ? LeadBotService.parseTotalMarks(messageBody) : null;

          // If student was asked for total marks, and replied with just the total number (e.g. "1100", "550", "1000", "total 1100")
          if (wasAskedTotalMarks && parsedTotalOnly && (!parsed || parsed.isPartial)) {
            const total = parsedTotalOnly;
            let obtained = lead.fsc_marks || null;
            let percentage = null;

            if (obtained !== null && obtained !== undefined) {
              if (obtained > total) {
                replyText =
                  `The obtained marks (*${obtained}*) cannot exceed total marks (*${total}*).\n\n` +
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                break;
              }
              percentage = (obtained / total) * 100;
            } else {
              const lastInbound = history.filter((h) => h.direction === 'INBOUND').slice(-1)[0]?.text || '';
              const pctMatch = lastInbound.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
              if (pctMatch) {
                const pct = parseFloat(pctMatch[1]);
                obtained = Math.round((pct / 100) * total);
                percentage = pct;
              }
            }

            if (obtained !== null && percentage !== null) {
              marksObtained = obtained;

              if (percentage < 50.0) {
                nextState = CONVERSATION_STATE.NOT_INTERESTED;
                qualificationChanged = true;
                isEligible = false;
                ineligibilityReason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
                eligibleFor = PROGRAM_ELIGIBILITY.NONE;
                replyText =
                  `Thank you for sharing your marks. The minimum requirement for Engineering & Technology programs at UAJK is 50% (your score: ${percentage.toFixed(1)}%).\n\n` +
                  `Unfortunately, you do not meet the minimum threshold for SE, SET, or CET. If you wish to learn about other programs or have questions, feel free to ask anytime!`;
              } else {
                eligibleFor = percentage >= 60.0 ? PROGRAM_ELIGIBILITY.SE_SET_CET : PROGRAM_ELIGIBILITY.SET_CET;

                const hasKnownName =
                  fullName &&
                  fullName.trim() &&
                  !fullName.toLowerCase().includes('prospective applicant');

                if (!hasKnownName) {
                  nextState = CONVERSATION_STATE.AWAITING_NAME;
                  replyText = `Thank you! Noted: *${percentage.toFixed(1)}%* marks (${obtained}/${total}).\n\nTo continue your admission registration, what is your *Full Name*?`;
                } else if (!fatherName) {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = `Thank you, *${fullName}*! Noted: *${percentage.toFixed(1)}%* marks (${obtained}/${total}).\n\nWhat is your *Father's Name*?`;
                } else if (cnic && email && (hasMaths !== null || lead.has_maths !== null)) {
                  nextState = CONVERSATION_STATE.QUALIFIED;
                  qualificationChanged = true;
                  isEligible = true;
                  replyText = LeadBotService.formatConfirmationMessage({
                    fullName,
                    fatherName,
                    cnic,
                    email,
                    marks: marksObtained,
                    isUpdated: true,
                  });
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_MATHS;
                  replyText =
                    `Noted: *${percentage.toFixed(1)}%* marks (${obtained}/${total}).\n\n` +
                    `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
                }
              }
              break;
            }
          }

          // If user provided mathematically invalid marks
          if (parsed?.error) {
            if (parsed.error === 'OBTAINED_EXCEEDS_TOTAL') {
              replyText =
                `The obtained marks (*${parsed.obtained}*) cannot exceed total marks (*${parsed.total}*).\n\n` +
                `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else if (parsed.error === 'PERCENTAGE_EXCEEDS_100') {
              replyText =
                `Percentage (*${parsed.percentage}%*) cannot exceed 100%.\n\n` +
                `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else if (parsed.error === 'INVALID_TOTAL') {
              replyText =
                `Total marks must be greater than zero.\n\n` +
                `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else {
              replyText =
                `Please provide your valid marks as obtained/total (for example: *890/1100* or *420/550*).`;
            }
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else if (parsed?.isPartial) {
            // Student wrote 500, 900, or 60%
            if (parsed.type === 'OBTAINED_ONLY') {
              marksObtained = parsed.obtained;
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted: *${parsed.obtained}* marks. Could you please also let us know your *Total Marks*?\n` +
                `*(For example: out of 1100, 550, or whatever your total was)*`;
            } else if (parsed.type === 'PERCENTAGE_ONLY') {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted: *${parsed.percentage}%*. Could you please also let us know your obtained and total marks?\n` +
                `*(For example: 660/1100 or 330/550, or what was your total score?)*`;
            }
          } else if (!parsed && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To check your program eligibility:* What was your score in FSc / ICS / DAE (Part 1 or 2)? (e.g. *890/1100* or *420/550*)`;
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else if (!parsed) {
            replyText =
              "We couldn't quite read your marks. Please provide your obtained and total marks (for example: *890/1100* or *420/550*).\n\n" +
              "If you have a question about eligibility or fees, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else {
            // Full ratio parsed (e.g. 890/1100 or a different total)
            marksObtained = parsed.obtained;

            // Check if study group was mentioned alongside marks
            const cleanMarksMsg = messageBody.toLowerCase();
            if (
              cleanMarksMsg.includes('pre-medical') ||
              cleanMarksMsg.includes('pre medical') ||
              cleanMarksMsg.includes('pre-med') ||
              cleanMarksMsg.includes('medical')
            ) {
              priorDegree = 'Pre-Medical';
              hasMaths = false;
            } else if (cleanMarksMsg.includes('ics')) {
              priorDegree = 'ICS';
              hasMaths = true;
            } else if (cleanMarksMsg.includes('pre-eng')) {
              priorDegree = 'FSc Pre-Engineering';
              hasMaths = true;
            } else if (cleanMarksMsg.includes('dae')) {
              priorDegree = 'DAE';
              hasMaths = true;
            }

            // Check eligibility threshold
            if (parsed.percentage < 50.0) {
              nextState = CONVERSATION_STATE.NOT_INTERESTED;
              qualificationChanged = true;
              isEligible = false;
              ineligibilityReason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
              eligibleFor = PROGRAM_ELIGIBILITY.NONE;
              replyText =
                `Thank you for sharing your marks. The minimum requirement for Engineering & Technology programs at UAJK is 50% (your score: ${parsed.percentage.toFixed(1)}%).\n\n` +
                `Unfortunately, you do not meet the minimum threshold for SE, SET, or CET. If you wish to learn about other programs or have questions, feel free to ask anytime!`;
            } else {
              if (parsed.percentage >= 60.0) {
                eligibleFor = PROGRAM_ELIGIBILITY.SE_SET_CET;
              } else {
                eligibleFor = PROGRAM_ELIGIBILITY.SET_CET;
              }

              const hasKnownName =
                fullName &&
                fullName.trim() &&
                !fullName.toLowerCase().includes('prospective applicant');

              if (!hasKnownName) {
                nextState = CONVERSATION_STATE.AWAITING_NAME;
                replyText = `Thank you! Noted: *${parsed.percentage.toFixed(1)}%* marks (${parsed.obtained}/${parsed.total}).\n\nTo continue your admission registration, what is your *Full Name*?`;
              } else if (!fatherName) {
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                replyText = `Thank you, *${fullName}*! Noted: *${parsed.percentage.toFixed(1)}%* marks (${parsed.obtained}/${parsed.total}).\n\nWhat is your *Father's Name*?`;
              } else if (cnic && email && (hasMaths !== null || lead.has_maths !== null)) {
                nextState = CONVERSATION_STATE.QUALIFIED;
                qualificationChanged = true;
                isEligible = true;
                replyText = LeadBotService.formatConfirmationMessage({
                  fullName,
                  fatherName,
                  cnic,
                  email,
                  marks: marksObtained,
                  isUpdated: true,
                });
              } else {
                nextState = CONVERSATION_STATE.AWAITING_MATHS;
                replyText =
                  `Noted: *${parsed.percentage.toFixed(1)}%* marks (${parsed.obtained}/${parsed.total}).\n\n` +
                  `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
              }
            }
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 4: Mathematics / Academic Background
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_MATHS: {
          const clean = messageBody.trim().toLowerCase();

          // Explicit opt-out / rejection
          if (
            /\b(not interested|don'?t want|stop (texting|messaging)|leave me|unsubscribe|cancel|quit)\b/i.test(
              clean
            )
          ) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else if (
            clean.includes('pre-medical') ||
            clean.includes('pre medical') ||
            clean.includes('pre-med') ||
            clean.includes('medical') ||
            clean.includes('bio')
          ) {
            hasMaths = false;
            priorDegree = 'Pre-Medical';
            if (cnic && email && marksObtained && fatherName) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText =
                "Noted! Up to 40% of seats in B.Sc. Software Engineering (SE) are offered to Pre-Medical candidates under PEC policy, and you are fully eligible for Software Engineering Technology (SET) & Computer Engineering Technology (CET) (with an additional deficiency Mathematics course in the 1st semester).\n\n" +
                "Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
            }
          } else if (
            clean.includes('arts') ||
            clean.includes('humanities') ||
            clean.includes('commerce') ||
            clean.includes('icom') ||
            clean.includes('i.com') ||
            /\b(fa|f\.a)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NO_MATHEMATICS;
            eligibleFor = PROGRAM_ELIGIBILITY.NONE;
            replyText =
              "Thank you for sharing your background. Engineering and Computing Technology programs (SE, SET, CET) require an FSc Pre-Engineering, ICS, Pre-Medical, or DAE background.\n\n" +
              "Unfortunately, candidates with Arts, Humanities, or Commerce backgrounds are not eligible for these programs. If you would like information about other university departments or programs, feel free to ask anytime!";
          } else if (
            LeadBotService.isAffirmative(messageBody) ||
            clean.includes('pre-eng') ||
            clean.includes('ics') ||
            clean.includes('dae') ||
            clean.includes('math')
          ) {
            hasMaths = true;
            if (clean.includes('ics')) priorDegree = 'ICS';
            else if (clean.includes('dae')) priorDegree = 'DAE';
            else priorDegree = 'FSc Pre-Engineering';

            if (cnic && email && marksObtained && fatherName) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText =
                "Great! Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
            }
          } else if (LeadBotService.isNegative(messageBody)) {
            hasMaths = false;
            priorDegree = 'Pre-Medical';
            if (cnic && email && marksObtained && fatherName) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText =
                "Noted! Up to 40% of seats in B.Sc. Software Engineering (SE) are offered to Pre-Medical candidates under PEC policy, and you are fully eligible for Software Engineering Technology (SET) & Computer Engineering Technology (CET) (with an additional deficiency Mathematics course in the 1st semester).\n\n" +
                "Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
            }
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS)}`;
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
          } else {
            replyText =
              "Please let us know your study background (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, *DAE*) or reply *Yes* if you studied Mathematics.\n\n" +
              "If you have a question, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 5: CNIC / Form-B
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_CNIC: {
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
            break;
          }

          const parsedCnic = LeadBotService.parseCnic(messageBody);

          if (!parsedCnic && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your registration:* Please provide your 13-digit CNIC or Form-B number (e.g. *12345-1234567-1*).`;
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
          } else if (parsedCnic) {
            cnic = parsedCnic;
            if (email && marksObtained && fatherName) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              isEligible = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else {
              nextState = CONVERSATION_STATE.AWAITING_EMAIL;
              replyText =
                "Thank you! Finally, please provide your *active Email Address* for official admission updates and portal access:";
            }
          } else {
            replyText =
              "Please provide a valid 13-digit Pakistani CNIC or Form-B number (for example: *12345-1234567-1*).\n\n" +
              "If you have a question, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 6: Email Address & Qualification Completion
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.AWAITING_EMAIL: {
          if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
            break;
          }

          const parsedEmail = LeadBotService.parseEmail(messageBody);

          if (!parsedEmail && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To complete your registration:* Please provide your Email Address (e.g. *applicant@example.com*).`;
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
          } else if (parsedEmail) {
            email = parsedEmail;
            nextState = CONVERSATION_STATE.QUALIFIED;
            qualificationChanged = true;
            isEligible = true;

            // Default eligibleFor if not already set
            if (!eligibleFor || eligibleFor === PROGRAM_ELIGIBILITY.NONE) {
              eligibleFor = PROGRAM_ELIGIBILITY.SE_SET_CET;
            }

            replyText = LeadBotService.formatConfirmationMessage({
              fullName,
              fatherName,
              cnic,
              email,
              marks: marksObtained,
              isUpdated: Boolean(lead.email && lead.conversation_state === CONVERSATION_STATE.AWAITING_EMAIL && history.length > 8),
            });
          } else {
            replyText =
              "Please provide a valid email address (for example: *applicant@example.com*).\n\n" +
              "If you have a question, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 7: Candidate Already Qualified - Mistake Correction & Inquiries
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.QUALIFIED: {
          const clean = messageBody.trim().toLowerCase();

          // Check direct field value submissions
          const marksInMsg = LeadBotService.parseMarks(messageBody);
          const cnicInMsg = LeadBotService.parseCnic(messageBody);
          const emailInMsg = LeadBotService.parseEmail(messageBody);

          // 1. Candidate sends marks directly (e.g. "950", "920/1100", "420/550", "marks 920", "ghalti se 550 likh diya marks 920 hain")
          if (
            marksInMsg &&
            (LeadBotService.isCorrectionIntent(messageBody) ||
              clean.includes('mark') ||
              clean.includes('score') ||
              clean.includes('fsc') ||
              /^\d{2,4}(\/\d{2,4})?%?$/.test(clean) ||
              /\b(out of|\/)\b/i.test(clean))
          ) {
            if (marksInMsg.error) {
              if (marksInMsg.error === 'OBTAINED_EXCEEDS_TOTAL') {
                replyText =
                  `The obtained marks (*${marksInMsg.obtained}*) cannot exceed total marks (*${marksInMsg.total}*).\n\n` +
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
              } else if (marksInMsg.error === 'PERCENTAGE_EXCEEDS_100') {
                replyText =
                  `Percentage (*${marksInMsg.percentage}%*) cannot exceed 100%.\n\n` +
                  `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
              } else {
                replyText =
                  `Please provide your valid marks as obtained/total (for example: *890/1100* or *420/550*).`;
              }
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
            } else if (marksInMsg.isPartial) {
              if (marksInMsg.type === 'OBTAINED_ONLY') {
                marksObtained = marksInMsg.obtained;
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText =
                  `Noted: *${marksInMsg.obtained}* marks. Could you please also let us know your *Total Marks*?\n` +
                  `*(For example: out of 1100, 550, or whatever your total was)*`;
              } else if (marksInMsg.type === 'PERCENTAGE_ONLY') {
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText =
                  `Noted: *${marksInMsg.percentage}%*. Could you please also let us know your obtained and total marks?\n` +
                  `*(For example: 660/1100 or 330/550, or what was your total score?)*`;
              }
            } else if (marksInMsg.percentage < 50.0) {
              marksObtained = marksInMsg.obtained;
              nextState = CONVERSATION_STATE.NOT_INTERESTED;
              qualificationChanged = true;
              isEligible = false;
              ineligibilityReason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
              eligibleFor = PROGRAM_ELIGIBILITY.NONE;
              replyText =
                `Thank you for sharing your updated marks. The minimum requirement for Engineering & Technology programs at UAJK is 50% (your score: ${marksInMsg.percentage.toFixed(1)}%).\n\n` +
                `Unfortunately, you do not meet the minimum threshold for SE, SET, or CET. If you wish to learn about other programs or have questions, feel free to ask anytime!`;
            } else {
              marksObtained = marksInMsg.obtained;
              eligibleFor =
                marksInMsg.percentage >= 60.0
                  ? PROGRAM_ELIGIBILITY.SE_SET_CET
                  : PROGRAM_ELIGIBILITY.SET_CET;
              qualificationChanged = true;
              isEligible = true;
              nextState = CONVERSATION_STATE.QUALIFIED;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            }
            break;
          }

          // 2. Candidate sends CNIC directly (e.g. "12345-6576665-4", "cnic 12345-6576665-4")
          if (
            cnicInMsg &&
            (LeadBotService.isCorrectionIntent(messageBody) ||
              clean.includes('cnic') ||
              clean.includes('b-form') ||
              clean.includes('form-b') ||
              /^\d{13}$|^\d{5}-\d{7}-\d{1}$/.test(clean))
          ) {
            cnic = cnicInMsg;
            qualificationChanged = true;
            isEligible = true;
            nextState = CONVERSATION_STATE.QUALIFIED;
            replyText = LeadBotService.formatConfirmationMessage({
              fullName,
              fatherName,
              cnic,
              email,
              marks: marksObtained,
              isUpdated: true,
            });
            break;
          }

          // 3. Candidate sends Email directly (e.g. "noting@gmail.com", "email noting@gmail.com")
          if (
            emailInMsg &&
            (LeadBotService.isCorrectionIntent(messageBody) ||
              clean.includes('email') ||
              clean.includes('mail') ||
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
          ) {
            email = emailInMsg;
            qualificationChanged = true;
            isEligible = true;
            nextState = CONVERSATION_STATE.QUALIFIED;
            replyText = LeadBotService.formatConfirmationMessage({
              fullName,
              fatherName,
              cnic,
              email,
              marks: marksObtained,
              isUpdated: true,
            });
            break;
          }

          // 4. Candidate provides Name directly (e.g. "name is Java Script", "change name to Java Script")
          const directNameMatch = messageBody.match(/(?:(?:my\s+)?name|naam)\s*(?:is|hai|to|:|=)\s*([a-zA-Z\s.']{2,80})/i);
          if (directNameMatch && LeadBotService.isValidName(directNameMatch[1])) {
            fullName = directNameMatch[1].trim();
            qualificationChanged = true;
            isEligible = true;
            nextState = CONVERSATION_STATE.QUALIFIED;
            replyText = LeadBotService.formatConfirmationMessage({
              fullName,
              fatherName,
              cnic,
              email,
              marks: marksObtained,
              isUpdated: true,
            });
            break;
          }

          // 5. Candidate provides Father's Name directly (e.g. "father name is Tariq", "abbu ka naam Tariq")
          const directFatherMatch = messageBody.match(/(?:father|walid|abbu)\s*(?:(?:'s\s+)?name|naam)?\s*(?:is|hai|to|:|=)\s*([a-zA-Z\s.']{2,80})/i);
          if (directFatherMatch && LeadBotService.isValidName(directFatherMatch[1])) {
            fatherName = directFatherMatch[1].trim();
            qualificationChanged = true;
            isEligible = true;
            nextState = CONVERSATION_STATE.QUALIFIED;
            replyText = LeadBotService.formatConfirmationMessage({
              fullName,
              fatherName,
              cnic,
              email,
              marks: marksObtained,
              isUpdated: true,
            });
            break;
          }

          // 6. Candidate selects specific field to edit (Option 1 to 7 or field keywords)
          if (
            clean === '1' ||
            clean === 'name' ||
            clean === 'full name' ||
            /\b(change|correct|edit|update|wrong)\b.*\b(name|naam)\b/i.test(clean) ||
            /\b(name|naam)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_NAME;
            replyText = "No problem! What is your correct *Full Name*?";
            break;
          }

          if (
            clean === '2' ||
            clean === 'father' ||
            clean === 'father name' ||
            clean === "father's name" ||
            /\b(change|correct|edit|update|wrong)\b.*\b(father|walid|abbu)\b/i.test(clean) ||
            /\b(father|walid|abbu)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            replyText = "No problem! What is your correct *Father's Name*?";
            break;
          }

          if (
            clean === '3' ||
            clean === 'marks' ||
            clean === 'score' ||
            clean === 'fsc' ||
            clean === 'fsc marks' ||
            /\b(change|correct|edit|update|wrong)\b.*\b(mark|marks|score|fsc)\b/i.test(clean) ||
            /\b(mark|marks|score|fsc)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText = "No problem! What was your score in FSc / ICS / DAE (Part 1 or 2)? (Please provide obtained and total marks, e.g. *890/1100* or *420/550*)";
            break;
          }

          if (
            clean === '4' ||
            clean === 'group' ||
            clean === 'academic group' ||
            clean === 'maths' ||
            clean === 'pre-medical' ||
            /\b(change|correct|edit|update|wrong)\b.*\b(group|math|maths|subject|pre-med|pre-eng)\b/i.test(clean) ||
            /\b(group|math|maths|subject|pre-med|pre-eng)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
            replyText = "No problem! Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)";
            break;
          }

          if (
            clean === '5' ||
            clean === 'cnic' ||
            clean === 'b-form' ||
            clean === 'form b' ||
            clean === 'form-b' ||
            /\b(change|correct|edit|update|wrong)\b.*\b(cnic|b-form|form-b|bform|id card|shanakhti)\b/i.test(clean) ||
            /\b(cnic|b-form|form-b|bform|id card|shanakhti)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
            replyText = "No problem! Please provide your correct 13-digit CNIC or Form-B number (e.g. *12345-1234567-1*).";
            break;
          }

          if (
            clean === '6' ||
            clean === 'email' ||
            clean === 'email address' ||
            /\b(change|correct|edit|update|wrong)\b.*\b(email|mail)\b/i.test(clean) ||
            /\b(email|mail)\b.*\b(change|correct|edit|update|wrong|ghalat|galat)\b/i.test(clean)
          ) {
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
            replyText = "No problem! Please provide your correct active *Email Address* (e.g. *applicant@example.com*).";
            break;
          }

          if (
            clean === '7' ||
            clean === 'all' ||
            clean === 'start over' ||
            clean === 'everything' ||
            /\b(restart|start over|re-enter|all details|dobara)\b/i.test(clean)
          ) {
            fullName = 'Prospective Applicant';
            fatherName = null;
            marksObtained = null;
            hasMaths = null;
            cnic = null;
            email = null;
            priorDegree = null;
            nextState = CONVERSATION_STATE.AWAITING_NAME;
            replyText = "Let's restart your admission registration from scratch. What is your *Full Name*?";
            break;
          }

          // 7. General statement of mistake or desire to correct (e.g. "I did a mistake", "ghalti ho gaii", "I wanna correct something")
          if (LeadBotService.isCorrectionIntent(messageBody)) {
            nextState = CONVERSATION_STATE.QUALIFIED;
            replyText = LeadBotService.getCorrectionMenuText();
            break;
          }

          // 8. General Question / FAQ Inquiries
          if (AIKnowledgeService.isQuestion(messageBody)) {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          } else {
            // Polite acknowledgment of pre-registration status
            replyText =
              "Your admission interest is confirmed! If you would like to correct any information, reply with *Correction* or tell us what you'd like to update.\n\n" +
              "If you have any questions regarding fees, hostels, or entry test, feel free to ask anytime!";
          }
          break;
        }

        case CONVERSATION_STATE.NOT_INTERESTED: {
          const marksInMsg = LeadBotService.parseMarks(messageBody);

          if (marksInMsg?.error) {
            if (marksInMsg.error === 'OBTAINED_EXCEEDS_TOTAL') {
              replyText =
                `The obtained marks (*${marksInMsg.obtained}*) cannot exceed total marks (*${marksInMsg.total}*).\n\n` +
                `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else if (marksInMsg.error === 'PERCENTAGE_EXCEEDS_100') {
              replyText =
                `Percentage (*${marksInMsg.percentage}%*) cannot exceed 100%.\n\n` +
                `Please provide your valid obtained and total marks (for example: *890/1100* or *420/550*).`;
            } else {
              replyText =
                `Please provide your valid marks as obtained/total (for example: *890/1100* or *420/550*).`;
            }
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            break;
          }

          if (marksInMsg?.isPartial) {
            if (marksInMsg.type === 'OBTAINED_ONLY') {
              marksObtained = marksInMsg.obtained;
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted: *${marksInMsg.obtained}* marks. Could you please also let us know your *Total Marks*?\n` +
                `*(For example: out of 1100, 550, or whatever your total was)*`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted: *${marksInMsg.percentage}%*. Could you please also let us know your obtained and total marks?\n` +
                `*(For example: 660/1100 or 330/550, or what was your total score?)*`;
            }
            break;
          }

          // If candidate previously disqualified updates their marks to >= 50%
          if (marksInMsg && !marksInMsg.error && !marksInMsg.isPartial && marksInMsg.percentage >= 50.0) {
            marksObtained = marksInMsg.obtained;
            isEligible = true;
            ineligibilityReason = null;
            eligibleFor = marksInMsg.percentage >= 60.0 ? PROGRAM_ELIGIBILITY.SE_SET_CET : PROGRAM_ELIGIBILITY.SET_CET;
            if (cnic && email && fatherName) {
              nextState = CONVERSATION_STATE.QUALIFIED;
              qualificationChanged = true;
              replyText = LeadBotService.formatConfirmationMessage({
                fullName,
                fatherName,
                cnic,
                email,
                marks: marksObtained,
                isUpdated: true,
              });
            } else {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText =
                `Updated your marks to *${marksInMsg.percentage.toFixed(1)}%* (${marksObtained}/${marksInMsg.total}).\n\n` +
                `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
            }
          } else if (LeadBotService.isCorrectionIntent(messageBody)) {
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText = "No problem at all! Let's update your marks. What was your score in FSc / ICS / DAE? (Please provide obtained and total marks, e.g. *890/1100* or *420/550*).";
          } else if (LeadBotService.isAffirmative(messageBody)) {
            if (fullName) {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText = `Welcome back ${fullName}! What was your score in FSc / ICS / DAE? (e.g. *890/1100* or *420/550*).`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_NAME;
              replyText = "Welcome back! Let's get your admission inquiry registered. What is your *Full Name*?";
            }
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          } else {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          }
          break;
        }

        case CONVERSATION_STATE.GENERAL_INQUIRY: {
          if (AIKnowledgeService.isQuestion(messageBody)) {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          } else {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          }
          break;
        }

        default: {
          replyText = standardGreeting;
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
          fullName,
          fatherName,
          cnic,
          email,
          priorDegree,
          fscMarks: marksObtained,
          hasMaths,
          eligibleFor,
          eligibilityStatus: isEligible
            ? ELIGIBILITY_STATUS.ELIGIBLE
            : (ineligibilityReason ? ELIGIBILITY_STATUS.INELIGIBLE : lead.eligibility_status),
          ineligibilityReason,
        },
        { queueReply }
      );

      // If newly qualified, publish LEAD_QUALIFIED event to outbox_jobs for Module 3 handoff
      if (qualificationChanged && isEligible) {
        await dispatchJob({
          queueName: 'admissions_intake',
          jobType: EVENT_TYPES.LEAD_QUALIFIED,
          payload: {
            leadId: lead.id,
            fullName: fullName || lead.full_name,
            fatherName: fatherName || '',
            cnic: cnic || '',
            email: email || '',
            phoneNormalized: lead.phone_normalized,
            city: lead.city || '',
            priorDegree: priorDegree || lead.prior_degree || 'FSc Pre-Engineering',
            fscMarks: marksObtained || 0,
            hasMaths: hasMaths !== null ? hasMaths : true,
            eligibleFor: eligibleFor || PROGRAM_ELIGIBILITY.SE_SET_CET,
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
        eligibleFor,
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
    extraFields = {},
    options = { queueReply: true }
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

    if (extraFields.fullName !== undefined) {
      updates.push('full_name = ?');
      params.push(extraFields.fullName);
    }
    if (extraFields.fatherName !== undefined) {
      updates.push('father_name = ?');
      params.push(extraFields.fatherName);
    }
    if (extraFields.cnic !== undefined) {
      updates.push('cnic = ?');
      params.push(extraFields.cnic);
    }
    if (extraFields.email !== undefined) {
      updates.push('email = ?');
      params.push(extraFields.email);
    }
    if (extraFields.priorDegree !== undefined) {
      updates.push('prior_degree = ?');
      params.push(extraFields.priorDegree);
    }
    if (extraFields.fscMarks !== undefined) {
      updates.push('fsc_marks = ?');
      params.push(extraFields.fscMarks);
    }
    if (extraFields.hasMaths !== undefined) {
      updates.push('has_maths = ?');
      params.push(extraFields.hasMaths);
    }
    if (extraFields.eligibleFor !== undefined) {
      updates.push('eligible_for = ?');
      params.push(extraFields.eligibleFor);
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

    // Enqueue outbound reply if enabled (defaults to true for webhook/async flows, false when directly sent via socket)
    if (options.queueReply !== false) {
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
}

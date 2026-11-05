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
      'apply', 'want to apply', 'i want to apply', 'interested in applying'
    ];
    return (
      affirmatives.includes(clean) ||
      /^(yes|han|ji|yep|yup|interested|definitely)\b/i.test(clean)
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
          obtained: Math.round(pct * 11),
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
        return { obtained: num, total: 550, percentage: (num / 550) * 100 };
      } else if (num <= 1100) {
        return { obtained: num, total: 1100, percentage: (num / 1100) * 100 };
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
        return "What was your score in FSc / ICS / DAE (Part 1 or 2)? (e.g. *420/550* or *850/1100*)";
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
   * Main turn processor for incoming applicant WhatsApp messages
   * Deterministic, graceful multi-case qualification engine
   */
  static async processIncomingMessage({ fromPhone, messageBody, rawTimestamp = new Date() }, db = pool) {
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
        "Assalam-o-Alaikum! Welcome to the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK), Chehla Campus.\n\n" +
        "Are you interested in applying here? Or would you like some information first about the university, department, eligibility, programs, fee structure, or courses?\n\n" +
        "• Reply *Yes* to register your admission interest\n" +
        "• Or feel free to ask any question you have!";

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
            `Would you like to register your admission interest with us for Fall 2026? (Reply *Yes* to begin registration)`;

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

        // Standard welcome greeting
        await LeadBotService.saveTurnAndQueueReply(
          connection,
          newLeadId,
          fromPhone,
          messageBody,
          standardGreeting,
          CONVERSATION_STATE.AWAITING_INTEREST,
          [],
          rawTimestamp
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
          // Case 1: Student says Yes / interested
          if (LeadBotService.isAffirmative(messageBody)) {
            // Check if full name is already known (e.g. from campaign import)
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
          // Case 2: Student says No / not interested
          else if (LeadBotService.isNegative(messageBody)) {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            replyText =
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
              "If you ever have any questions about university programs, eligibility, or courses, please feel free to ask anytime!";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          }
          // Case 3: Student asks a question or random inquiry
          else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `Would you like to register your admission interest for the Department of Software Engineering? (Reply *Yes* to start registration)`;
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
              "Assalam-o-Alaikum! Please reply with *Yes* if you are interested in applying, or feel free to ask any question about UAJK Software Engineering admissions.";
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `👉 *To continue your admission registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME)}`;
            nextState = CONVERSATION_STATE.AWAITING_NAME;
          } else if (LeadBotService.isValidName(messageBody)) {
            fullName = messageBody.trim();
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            replyText = `Thank you, *${fullName}*! What is your *Father's Name*?`;
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `👉 *To continue your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME)}`;
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
          } else if (LeadBotService.isValidName(messageBody)) {
            fatherName = messageBody.trim();
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText =
              `Noted. What was your score in FSc / ICS / DAE (Part 1 or Complete)?\n` +
              `*(For example: 420/550, 850/1100, or 75%)*`;
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
              "If you ever have any questions about university programs or need guidance in the future, feel free to reach out anytime.";
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NOT_INTERESTED;
            break;
          }

          const parsed = LeadBotService.parseMarks(messageBody);

          // If user asked a question instead of providing marks
          if (!parsed && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `👉 *To check your program eligibility:* What was your score in FSc / ICS / DAE (Part 1 or 2)? (e.g. *420/550* or *850/1100*)`;
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else if (!parsed) {
            replyText =
              "We couldn't quite read your marks. Please provide your obtained and total marks (for example: *420/550* or *850/1100* or *75%*).\n\n" +
              "If you have a question about eligibility or fees, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else {
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
              // Record eligible programs silently in the backend:
              // >= 60% -> SE, SET, CET
              // 50% - 59.9% -> SET, CET
              if (parsed.percentage >= 60.0) {
                eligibleFor = PROGRAM_ELIGIBILITY.SE_SET_CET;
              } else {
                eligibleFor = PROGRAM_ELIGIBILITY.SET_CET;
              }

              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText =
                `Noted: *${parsed.percentage.toFixed(1)}%* marks.\n\n` +
                `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
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
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
            replyText =
              "Noted! Up to 40% of seats in B.Sc. Software Engineering (SE) are offered to Pre-Medical candidates under PEC policy, and you are fully eligible for Software Engineering Technology (SET) & Computer Engineering Technology (CET) (with an additional deficiency Mathematics course in the 1st semester).\n\n" +
              "Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
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

            nextState = CONVERSATION_STATE.AWAITING_CNIC;
            replyText =
              "Great! Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
          } else if (LeadBotService.isNegative(messageBody)) {
            hasMaths = false;
            priorDegree = 'Pre-Medical';
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
            replyText =
              "Noted! Up to 40% of seats in B.Sc. Software Engineering (SE) are offered to Pre-Medical candidates under PEC policy, and you are fully eligible for Software Engineering Technology (SET) & Computer Engineering Technology (CET) (with an additional deficiency Mathematics course in the 1st semester).\n\n" +
              "Next, please provide your *13-digit CNIC or Form-B number* (e.g. *12345-1234567-1*):";
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `👉 *To continue:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS)}`;
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
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
              `👉 *To continue your registration:* Please provide your 13-digit CNIC or Form-B number (e.g. *12345-1234567-1*).`;
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
          } else if (parsedCnic) {
            cnic = parsedCnic;
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
            replyText =
              "Thank you! Finally, please provide your *active Email Address* for official admission updates and portal access:";
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career! 🌟\n\n" +
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
              `👉 *To complete your registration:* Please provide your Email Address (e.g. *applicant@example.com*).`;
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

            replyText =
              `🎉 Congratulations *${fullName || 'Candidate'}*!\n\n` +
              `Your admission interest for the Department of Software Engineering at UAJK has been successfully recorded.\n\n` +
              `📋 *Application Summary:*\n` +
              `• *Candidate:* ${fullName}\n` +
              `• *Father's Name:* ${fatherName || 'On Record'}\n` +
              `• *CNIC/B-Form:* ${cnic}\n` +
              `• *Email:* ${email}\n` +
              `• *FSc Marks:* ${marksObtained || 'Recorded'}\n\n` +
              `Our admissions desk will contact you and send your document verification portal link shortly.\n` +
              `If you have any questions regarding hostel, fees, or entry test, feel free to ask anytime!`;
          } else {
            replyText =
              "Please provide a valid email address (for example: *applicant@example.com*).\n\n" +
              "If you have a question, feel free to ask!";
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
          }
          break;
        }

        // ---------------------------------------------------------------------
        // Step 7: Already Qualified or Inactive - Answer Any Inquiries Gracefully
        // ---------------------------------------------------------------------
        case CONVERSATION_STATE.QUALIFIED:
        case CONVERSATION_STATE.NOT_INTERESTED:
        case CONVERSATION_STATE.GENERAL_INQUIRY: {
          // If asking a question
          if (AIKnowledgeService.isQuestion(messageBody)) {
            replyText = await AIKnowledgeService.answerQuestion(messageBody, history);
          } else if (LeadBotService.isAffirmative(messageBody) && currentState === CONVERSATION_STATE.NOT_INTERESTED) {
            // Student changed their mind and wants to apply now
            nextState = CONVERSATION_STATE.AWAITING_NAME;
            replyText = "Welcome back! Let's get your admission inquiry registered. What is your *Full Name*?";
          } else {
            // General polite acknowledgment + FAQ guidance
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
        }
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

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

    // Pattern 1: Ratio format like 420/550, 850/1100, 420 out of 550, 550/500
    const ratioMatch = clean.match(/(\d{1,4})\s*(?:\/|\bout\s+of\b)\s*(\d{1,4})/i);
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

      // Total marks in Intermediate (FSc/ICS) must be 550 (Part 1) or 1100 (Part 2)
      if (total !== 550 && total !== 1100) {
        return {
          error: 'INVALID_TOTAL_MARKS',
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

    // Pattern 2: Percentage format like 75%, 75.5%, 100%, 120%
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
          obtained: Math.round(pct * 11),
          total: 1100,
          percentage: pct,
        };
      }
    }

    // If string contained an explicit separator ('/' or 'out of' or '%'),
    // do NOT fall through to bare number regex.
    if (/[\/%]|\bout\s+of\b/i.test(clean)) {
      return null;
    }

    // Pattern 3: Bare number
    const numMatch = clean.match(/\b(\d{2,4})\b/);
    if (numMatch) {
      const num = parseInt(numMatch[1], 10);
      if (num > 1100) {
        return {
          error: 'MARKS_EXCEEDS_MAX',
          obtained: num,
        };
      }
      if (num >= 100 && num <= 550) {
        return { obtained: num, total: 550, percentage: (num / 550) * 100 };
      } else if (num > 550 && num <= 1100) {
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
        "Are you interested in applying here? Or would you like some information first regarding programs, eligibility, fee structure, or hostel facilities?\n\n" +
        "- Reply *Yes* to register your admission interest\n" +
        "- Or feel free to ask any question you have!";

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
            rawTimestamp,
            {},
            { queueReply }
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
              "Thank you for letting us know! We completely understand and respect your decision. Best of luck with your future studies and career!\n\n" +
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
            } else {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted. What was your score in FSc / ICS / DAE (Part 1 or Complete)?\n` +
                `*(For example: 420/550, 850/1100, or 75%)*`;
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

          const parsed = LeadBotService.parseMarks(messageBody);

          // If user provided mathematically invalid marks (e.g. 550/500, >100%, 420/900, or >1100)
          if (parsed?.error) {
            if (parsed.error === 'INVALID_TOTAL_MARKS') {
              replyText =
                `Total marks for Intermediate (FSc/ICS) can only be *550* (Part 1) or *1100* (Part 2 / Full).\n\n` +
                `Please provide your valid marks as obtained/total (for example: *420/550* or *850/1100*).`;
            } else if (parsed.error === 'OBTAINED_EXCEEDS_TOTAL') {
              replyText =
                `The obtained marks (*${parsed.obtained}*) cannot exceed total marks (*${parsed.total}*).\n\n` +
                `Please provide your valid obtained and total marks (for example: *420/550* or *850/1100*).`;
            } else if (parsed.error === 'PERCENTAGE_EXCEEDS_100') {
              replyText =
                `Percentage (*${parsed.percentage}%*) cannot exceed 100%.\n\n` +
                `Please provide your valid obtained and total marks (for example: *420/550* or *850/1100*).`;
            } else if (parsed.error === 'MARKS_EXCEEDS_MAX') {
              replyText =
                `The marks you entered (*${parsed.obtained}*) exceed standard intermediate total marks (1100).\n\n` +
                `Please provide your marks in the format obtained/total (for example: *420/550* or *850/1100*).`;
            } else {
              replyText =
                `Total marks must be either *550* or *1100*. Please provide your valid marks (for example: *420/550* or *850/1100*).`;
            }
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
          } else if (!parsed && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To check your program eligibility:* What was your score in FSc / ICS / DAE (Part 1 or 2)? (e.g. *420/550* or *850/1100*)`;
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

              // If candidate already completed other details (e.g. updating marks after qualification)
              if (cnic && email && fatherName && (hasMaths !== null || lead.has_maths !== null)) {
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
                  `Noted: *${parsed.percentage.toFixed(1)}%* marks.\n\n` +
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
              if (marksInMsg.error === 'INVALID_TOTAL_MARKS') {
                replyText =
                  `Total marks for Intermediate (FSc/ICS) can only be *550* (Part 1) or *1100* (Part 2 / Full).\n\n` +
                  `Please provide your valid marks as obtained/total (for example: *420/550* or *850/1100*).`;
              } else if (marksInMsg.error === 'OBTAINED_EXCEEDS_TOTAL') {
                replyText =
                  `The obtained marks (*${marksInMsg.obtained}*) cannot exceed total marks (*${marksInMsg.total}*).\n\n` +
                  `Please provide your valid obtained and total marks (for example: *420/550* or *850/1100*).`;
              } else if (marksInMsg.error === 'PERCENTAGE_EXCEEDS_100') {
                replyText =
                  `Percentage (*${marksInMsg.percentage}%*) cannot exceed 100%.\n\n` +
                  `Please provide your valid obtained and total marks (for example: *420/550* or *850/1100*).`;
              } else {
                replyText =
                  `Total marks must be either *550* or *1100*. Please provide your valid marks (for example: *420/550* or *850/1100*).`;
              }
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
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
            replyText = "No problem! What was your score in FSc / ICS / DAE (Part 1 or 2)? (e.g. *420/550* or *850/1100*)";
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

          // If candidate sent invalid marks format (e.g. total != 550 and != 1100, or obtained > total)
          if (marksInMsg?.error) {
            if (marksInMsg.error === 'INVALID_TOTAL_MARKS') {
              replyText =
                `Total marks for Intermediate (FSc/ICS) can only be *550* (Part 1) or *1100* (Part 2 / Full).\n\n` +
                `Please provide your valid marks as obtained/total (for example: *420/550* or *850/1100*).`;
            } else if (marksInMsg.error === 'OBTAINED_EXCEEDS_TOTAL') {
              replyText =
                `The obtained marks (*${marksInMsg.obtained}*) cannot exceed total marks (*${marksInMsg.total}*).\n\n` +
                `Please provide your valid obtained and total marks (for example: *420/550* or *850/1100*).`;
            } else {
              replyText =
                `Total marks must be either *550* or *1100*. Please provide your valid marks (for example: *420/550* or *850/1100*).`;
            }
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            break;
          }

          // If candidate previously disqualified updates their marks to >= 50%
          if (marksInMsg && !marksInMsg.error && marksInMsg.percentage >= 50.0) {
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
                `Updated your marks to *${marksInMsg.percentage.toFixed(1)}%* (${marksObtained}).\n\n` +
                `Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)`;
            }
          } else if (LeadBotService.isCorrectionIntent(messageBody)) {
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            replyText = "No problem at all! Let's update your marks. What were your obtained marks in FSc / ICS? (Total marks can only be *550* or *1100*, e.g. *420/550* or *850/1100*).";
          } else if (LeadBotService.isAffirmative(messageBody)) {
            if (fullName) {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText = `Welcome back ${fullName}! What was your score in FSc / ICS? (e.g. *420/550* or *850/1100*).`;
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

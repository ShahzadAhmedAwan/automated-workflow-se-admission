import { pool } from '../../../core/db/pool.js';
import { dispatchJob } from '../../../core/queue/outboxBus.js';
import { EVENT_TYPES } from '../../../contracts/event-types.js';
import {
  CONVERSATION_STATE,
  ELIGIBILITY_STATUS,
  INELIGIBILITY_REASON,
  PROGRAM_ELIGIBILITY,
} from '../marketing.constants.js';
import { AIKnowledgeService, stripEmojis } from './ai-knowledge.service.js';

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
    if (clean.includes('?') || clean.includes('؟')) return false;
    if (AIKnowledgeService.isQuestion(clean)) return false;
    if (/^\d+$/.test(clean)) return false;

    // Reject correction intent: if it's a correction request, it is NOT a name!
    if (LeadBotService.isCorrectionIntent(clean)) return false;

    // Reject intent verbs and request phrases (including typos like chnage, fther)
    const intentPhrasePattern = /\b(wanna|want|wnt|would\s+like|need|can\s+i|please|plz|change|chnage|chagne|chaneg|chng|correct|correction|cor+ect|edit|update|updat|modify|replace|reset|delete|remove|fix|enter|reenter|write|rewrite|again)\b/i;
    if (intentPhrasePattern.test(clean)) return false;

    // Reject Roman Urdu intent and relational words
    const urduIntentPattern = /\b(badalna|badal|theek|thik|sahi|durust|ghalti|galti|galat|ghalat|glat|dobara|dubara|karna|karni|krna|krni|chahiye|chahye|mera|meri|apna|apni|mujhe|hoga|hogi|hain|hein|hai|batao|batayein|bta|bata|lena|leni|zarrori|zaruri|zaroori)\b/i;
    if (urduIntentPattern.test(clean)) return false;

    // Reject field names when standalone or in phrases (including typos fther, fathr, fathe)
    const fieldWordsPattern = /\b(father|fther|fathr|fathe|fthr|walid|walad|abbu|abu|mother|valida|ammi|marks|score|fsc|matric|cnic|email|mail|group|subject)\b/i;
    if (fieldWordsPattern.test(clean)) return false;

    // Reject non-name admissions or interrogative words
    const nonNamePattern = /\b(name|naam|full name|fee|fees|hostel|hostels|admission|admissions|apply|criteria|eligibility|eligible|test|entry|entrance|percentage|merit|campus|chehla|uajk|university|program|programs|degree|engineering|technology|pre[- ]?med|pre[- ]?eng|ics|dae|challan|scholarship|scholarships|document|documents|deadline|schedule|class|classes|syllabus|contact|helpline|coordinator|math|mathematics|maths|kya|kab|kahan|kidhar|kitna|kitni|kitne|kaise|kaisay|konsa|konsi|kon|koun|kyu|kion)\b/i;
    if (nonNamePattern.test(clean)) return false;

    // Maximum word count for a personal name: 1 to 5 words
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length > 5) return false;

    // Must contain letters
    return /^[a-zA-Z\s.'-]{2,80}$/.test(clean);
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
   * Classifies an academic study background from student input
   * Gracefully accepts short answers like "pre eng", "eng", "engineering", "pre med", "med", "medical", etc.
   */
  static classifyAcademicGroup(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim().toLowerCase();

    // 1. Ineligible groups
    if (
      clean.includes('arts') ||
      clean.includes('humanities') ||
      clean.includes('commerce') ||
      clean.includes('icom') ||
      clean.includes('i.com') ||
      /\b(fa|f\.a)\b/i.test(clean)
    ) {
      return { group: 'Ineligible', hasMaths: false, eligible: false };
    }

    // 2. Pre-Medical variations (accepts: pre med, pre-med, med, medical, pre medical, doctor, bio, biology)
    if (
      /\b(pre[- ]?med|pre[- ]?medical|medical|med|bio|biology|doctor)\b/i.test(clean)
    ) {
      return { group: 'Pre-Medical', hasMaths: false, eligible: true };
    }

    // 3. Pre-Engineering variations (accepts: pre eng, pre-eng, eng, engineering, pre engg, pre-engineering, non-med)
    if (
      /\b(pre[- ]?eng|pre[- ]?engg|pre[- ]?engineering|engineering|engg|eng|non[- ]?med|non[- ]?medical)\b/i.test(clean)
    ) {
      return { group: 'FSc Pre-Engineering', hasMaths: true, eligible: true };
    }

    // 4. ICS variations (ics, comp, computer, computer science, cs)
    if (
      /\b(ics|i\.c\.s|comp|computer|computer science|cs)\b/i.test(clean)
    ) {
      return { group: 'ICS', hasMaths: true, eligible: true };
    }

    // 5. DAE variations (dae, diploma, associate engineer)
    if (
      /\b(dae|d\.a\.e|diploma)\b/i.test(clean)
    ) {
      return { group: 'DAE', hasMaths: true, eligible: true };
    }

    // 6. Generic math indicators
    if (/\b(math|maths|mathematics)\b/i.test(clean) || LeadBotService.isAffirmative(clean)) {
      return { group: 'FSc Pre-Engineering', hasMaths: true, eligible: true };
    }

    return null;
  }

  /**
   * Helper to determine if an input is a direct group declaration rather than an inquiry about that group
   */
  static isDirectGroupDeclaration(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();
    if (clean.includes('?') || clean.includes('؟')) return false;

    // If it contains inquiry words or phrases, it's an inquiry, not a direct declaration
    const inquiryWords = /\b(can|could|will|would|is|are|how|what|why|kya|kab|kahan|kidhar|kitna|kitni|kitne|kitnay|kaise|kaisay|konsa|konsi|kon|koun|kar sakte|kr skte|kr sakty|kar sakti|mil sakta|mil sakti|quota|policy|fees|fee|hostel|test|criteria|eligible|eligibility|merit|deadline|batao|batayein|bta|chahiye|chahye|detail|details|info|information|apply|admission|admissions)\b/i;
    if (inquiryWords.test(clean)) return false;

    // Plain academic groups
    const pureGroups = [
      'pre-medical', 'pre medical', 'pre-med', 'pre med', 'medical', 'med', 'biology', 'bio',
      'pre-engineering', 'pre engineering', 'pre-eng', 'pre eng', 'engineering', 'eng', 'engg', 'non-med', 'non medical',
      'ics', 'i.c.s', 'computer science', 'cs', 'comp',
      'dae', 'd.a.e', 'diploma',
      'arts', 'humanities', 'commerce', 'icom', 'fa',
      'math', 'maths', 'mathematics',
      'yes', 'han', 'ji', 'jee', 'yup', 'yeah',
      'no', 'nahi', 'nah'
    ];

    if (pureGroups.includes(clean)) return true;

    // Short declarations like "fsc pre medical", "studied pre-engineering", "i did ics", "my group was pre-med"
    if (
      /^(i\s+(did|studied|have|completed)|my\s+(group|field|background)\s+(was|is))\s+[a-z\s-]+$/i.test(clean) &&
      !inquiryWords.test(clean)
    ) {
      return true;
    }

    // Short phrase (at most 3 words) matching classifyAcademicGroup
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 3 && !inquiryWords.test(clean) && LeadBotService.classifyAcademicGroup(clean)) {
      return true;
    }

    return false;
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
        return "Please provide your active *Email Address* (e.g. *applicant@example.com*) for official portal access.";
      default:
        return "Please let us know how we can assist you.";
    }
  }

  /**
   * Helper to detect correction / edit / mistake intent in English and Roman Urdu
   * Handles typos such as chnage, fther, etc.
   */
  static isCorrectionIntent(text) {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    const patterns = [
      /\b(mistake|ghalti|galti|galati|ghlti|wrong|galat|ghalat)\b/i,
      /\b(correct|correction|cor+ect|edit|change|chnage|chenge|chagne|chaneg|chng|update|updat|updte|modify|replace|reset)\b/i,
      /\b(wanna|want to|wnt to|can i|need to|could i|plz|please)\s+(correct|correction|change|chnage|chenge|edit|update|replace|modify)\b/i,
      /\b(wanna\s+chnage|wanna\s+change|want\s+to\s+chnage|want\s+to\s+change)\b/i,
      /\b(theek karna|sahi karna|durust|badalna|badal do|tabdeel)\b/i,
      /\b(by mistake|mistakenly|glat likh|ghalat likh|wrong entry|i made a mistake|i did a mistake)\b/i,
      /\b(change|chnage|chenge|correct|edit|update)\s+(my\s+)?(marks?|name|naam|cnic|email|mail|father|fther|fathr|fathe|walid|abbu|group)\b/i,
      /\b(write (my )?name again|dobara naam|name change|naam badalna|naam dobara)\b/i,
      /\b(can i write|can i enter|can i re[- ]?enter|dubara likh|dobara likh)\b/i,
    ];
    return patterns.some((p) => p.test(clean));
  }

  /**
   * Identifies the specific target field for correction from user input (English & Roman Urdu)
   * Prioritizes Father's Name over Full Name so phrases like "change father name" or "chnage fther name" never match "name"
   */
  static detectCorrectionField(text) {
    if (!text) return null;
    const clean = text.trim().toLowerCase();

    // 1. All details / Start over
    if (
      clean === '7' ||
      clean === 'all' ||
      clean === 'start over' ||
      clean === 'everything' ||
      /\b(restart|start over|re-enter|all details|all info|scratch|dobara shuru|shuru se)\b/i.test(clean)
    ) {
      return 'ALL';
    }

    // 2. Father's Name (CHECK FIRST before candidate name to avoid "father name" matching "name")
    if (
      clean === '2' ||
      clean === 'father' ||
      clean === 'fther' ||
      clean === 'father name' ||
      clean === "father's name" ||
      clean === 'fther name' ||
      /\b(father|fther|fathr|fathe|fthr|walid|walad|abbu|abu|baba|papa|walidiyat)\b/i.test(clean)
    ) {
      return 'FATHER_NAME';
    }

    // 3. Full Name (ONLY if father terms are NOT present)
    const hasFatherTerm = /\b(father|fther|fathr|fathe|fthr|walid|walad|abbu|abu|baba|papa|walidiyat)\b/i.test(clean);
    if (!hasFatherTerm) {
      if (
        clean === '1' ||
        clean === 'name' ||
        clean === 'full name' ||
        clean === 'my name' ||
        clean === 'naam' ||
        clean === 'mera naam' ||
        /\b(write (my )?name again|can i (change|chnage|write|enter|re[- ]?enter) (my )?name|change (my )?name|chnage (my )?name|correct (my )?name|naam (change|chnage|galat|ghalat|dobara|dubara)|mera naam|apna naam|candidate name|student name)\b/i.test(clean) ||
        (/\b(change|chnage|chenge|correct|edit|update|wrong)\b/i.test(clean) && /\b(name|naam)\b/i.test(clean))
      ) {
        return 'FULL_NAME';
      }
    }

    // 4. Marks / Score
    if (
      clean === '3' ||
      clean === 'marks' ||
      clean === 'mark' ||
      clean === 'score' ||
      clean === 'fsc' ||
      clean === 'fsc marks' ||
      /\b(mark|marks|score|fsc|matric|dae|ics marks|obtained marks)\b/i.test(clean)
    ) {
      return 'MARKS';
    }

    // 5. Academic Group / Maths
    if (
      clean === '4' ||
      clean === 'group' ||
      clean === 'academic group' ||
      clean === 'maths' ||
      clean === 'math' ||
      clean === 'pre-medical' ||
      clean === 'pre-engineering' ||
      /\b(group|math|maths|mathematics|subject|pre-med|pre-eng)\b/i.test(clean)
    ) {
      return 'ACADEMIC_GROUP';
    }

    // 6. CNIC / Form-B
    if (
      clean === '5' ||
      clean === 'cnic' ||
      clean === 'b-form' ||
      clean === 'form b' ||
      clean === 'form-b' ||
      clean === 'bform' ||
      /\b(cnic|b-form|form-b|bform|bay form|b form|id card|shanakhti)\b/i.test(clean)
    ) {
      return 'CNIC';
    }

    // 7. Email Address
    if (
      clean === '6' ||
      clean === 'email' ||
      clean === 'email address' ||
      clean === 'mail' ||
      clean === 'gmail' ||
      /\b(email|mail|e-mail|gmail)\b/i.test(clean)
    ) {
      return 'EMAIL';
    }

    return null;
  }

  /**
   * Extracts direct father name value if student provides it in the message
   * e.g. "father name is Tariq Mahmood", "change father name to Muhammad Ali", "abbu ka naam Tariq hai", "fther name Tariq"
   */
  static extractDirectFatherName(text) {
    if (!text) return null;
    const clean = text.trim();

    // Pattern 1: (wanna change/chnage...) father/fther/walid/abbu name to <NAME>
    const changeToMatch = clean.match(/(?:(?:wanna|want\s+to|can\s+i|plz|please)?\s*(?:change|chnage|chenge|correct|edit|update)\s*(?:my\s*)?(?:father(?:'s)?|fther(?:'s)?|walid|abbu)\s*(?:name|naam)?\s*(?:to|is|=|:)\s*)([a-zA-Z\s.']{2,80})/i);
    if (changeToMatch && LeadBotService.isValidName(changeToMatch[1])) {
      return changeToMatch[1].trim();
    }

    // Pattern 2: father/fther/walid/abbu (name/naam) (is/to/:/hai/=) <NAME>
    const directMatch = clean.match(/(?:father|fther|walid|abbu)\s*(?:(?:'s\s+)?name|naam)?\s*(?:is|hai|to|:|=)\s*([a-zA-Z\s.']{2,80})/i);
    if (directMatch && LeadBotService.isValidName(directMatch[1])) {
      return directMatch[1].trim();
    }

    // Pattern 3: father/fther/walid/abbu (name/naam) <NAME> (space separated e.g. "fther name Tariq Mahmood")
    const spaceMatch = clean.match(/(?:father|fther|walid|abbu)\s*(?:'s)?\s*(?:name|naam)\s+([a-zA-Z\s.']{2,80})/i);
    if (spaceMatch && LeadBotService.isValidName(spaceMatch[1])) {
      return spaceMatch[1].trim();
    }

    return null;
  }

  /**
   * Extracts direct candidate full name value if student provides it in the message
   * e.g. "my name is Shahzad", "change name to Shahzad Awan", "name Ali"
   */
  static extractDirectFullName(text) {
    if (!text) return null;
    const clean = text.trim();

    // If father terms are mentioned, this is not a candidate direct name
    if (/\b(father|fther|fathr|fathe|fthr|walid|abbu|baba|papa)\b/i.test(clean)) {
      return null;
    }

    // Pattern 1: (wanna change/chnage...) name to <NAME>
    const changeToMatch = clean.match(/(?:(?:wanna|want\s+to|can\s+i|plz|please)?\s*(?:change|chnage|chenge|correct|edit|update)\s*(?:my\s*)?(?:full\s*)?name\s*(?:to|is|=|:)\s*)([a-zA-Z\s.']{2,80})/i);
    if (changeToMatch && LeadBotService.isValidName(changeToMatch[1])) {
      return changeToMatch[1].trim();
    }

    // Pattern 2: (my) name/naam (is/to/:/hai/=) <NAME>
    const directMatch = clean.match(/(?:(?:my\s+)?(?:full\s*)?name|naam)\s*(?:is|hai|to|:|=)\s*([a-zA-Z\s.']{2,80})/i);
    if (directMatch && LeadBotService.isValidName(directMatch[1])) {
      return directMatch[1].trim();
    }

    // Pattern 3: (my) full name/naam <NAME>
    const spaceMatch = clean.match(/(?:(?:my\s+)?(?:full\s*)?name|naam)\s+([a-zA-Z\s.']{2,80})/i);
    if (spaceMatch && LeadBotService.isValidName(spaceMatch[1])) {
      return spaceMatch[1].trim();
    }

    return null;
  }

  /**
   * Resolves correction intent and entity field using rule-based and Gemini classification
   */
  static async resolveCorrectionIntent(messageText) {
    if (!messageText) return null;
    const clean = messageText.trim();
    if (!clean) return null;

    // 1. Direct father name provided
    const directFather = LeadBotService.extractDirectFatherName(clean);
    if (directFather) {
      return {
        field: 'FATHER_NAME',
        directValue: directFather,
        confidence: 0.98,
      };
    }

    // 2. Direct full name provided
    const directName = LeadBotService.extractDirectFullName(clean);
    if (directName) {
      return {
        field: 'FULL_NAME',
        directValue: directName,
        confidence: 0.98,
      };
    }

    // 3. Deterministic field detection
    const detectedField = LeadBotService.detectCorrectionField(clean);
    if (detectedField) {
      return {
        field: detectedField,
        directValue: null,
        confidence: 0.95,
      };
    }

    // 4. If correction intent exists or Gemini API can classify ambiguous queries
    if (LeadBotService.isCorrectionIntent(clean)) {
      try {
        const geminiResult = await AIKnowledgeService.classifyCorrectionWithGemini(clean);
        if (geminiResult && geminiResult.field && geminiResult.field !== 'NONE') {
          return {
            field: geminiResult.field,
            directValue: geminiResult.directValue || null,
            confidence: 0.9,
          };
        }
      } catch (err) {
        // Fallback silently
      }

      return {
        field: 'UNKNOWN',
        directValue: null,
        confidence: 0.5,
      };
    }

    return null;
  }

  /**
   * Helper to format unified confirmation and review summary
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
      `- CNIC / B-Form: ${cnic || 'On Record'}\n` +
      `- Email: ${email || 'On Record'}\n` +
      `- FSc Marks: ${marks || 'Recorded'}\n\n` +
      `If any information needs correction, please let us know.\n\n` +
      `*Next Step:*\n` +
      `Your official document upload portal link will be sent to you in 1 minute.\n\n` +
      `If you have any questions regarding hostel, fees, or entry test, feel free to ask anytime!`
    );
  }

  /**
   * Helper to return the interactive correction options menu
   */
  static getCorrectionMenuText() {
    return (
      "You can easily update your information.\n\n" +
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

        // If the very first message is expressing intent to ask a question (Requirement 6)
        if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
          const reply = "Yes, please ask your question! What would you like to know?";
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
          // Student explicitly indicates they want to ask a question (Requirement 6)
          else if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_INTEREST;
          }
          // Case 1: Student says Yes / interested
          else if (LeadBotService.isAffirmative(messageBody)) {
            const hasKnownName =
              fullName &&
              fullName.trim() &&
              !fullName.toLowerCase().includes('prospective applicant');

            if (hasKnownName) {
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
              replyText = `Great to have you with us, *${fullName}*!\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
            } else {
              nextState = CONVERSATION_STATE.AWAITING_NAME;
              replyText = `Great! Let's get your admission inquiry registered.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
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
            break;
          }

          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_NAME;
            break;
          }

          // Check if candidate is asking to change or correct another field (e.g. father name, marks)
          const correctionInName = await LeadBotService.resolveCorrectionIntent(messageBody);
          if (correctionInName && correctionInName.field && correctionInName.field !== 'FULL_NAME') {
            if (correctionInName.field === 'FATHER_NAME') {
              if (correctionInName.directValue) {
                fatherName = correctionInName.directValue;
                replyText = `Thank you! Father's Name recorded as *${fatherName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
                nextState = CONVERSATION_STATE.AWAITING_NAME;
              } else {
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                replyText = "Please provide your correct *Father's Name*.";
              }
              break;
            } else if (correctionInName.field === 'MARKS') {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
              break;
            } else if (correctionInName.field === 'CNIC') {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
              break;
            } else if (correctionInName.field === 'EMAIL') {
              nextState = CONVERSATION_STATE.AWAITING_EMAIL;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
              break;
            } else if (correctionInName.field === 'ACADEMIC_GROUP') {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
              break;
            }
          }

          if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your admission registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
            nextState = CONVERSATION_STATE.AWAITING_NAME;
            break;
          }

          const directName = LeadBotService.extractDirectFullName(messageBody);
          const candidateName = directName || (LeadBotService.isValidName(messageBody) ? messageBody.trim() : null);

          if (candidateName) {
            fullName = candidateName;
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
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
            } else if (fatherName) {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Thank you, *${fullName}*!\n\n` +
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
            } else {
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
              replyText = `Thank you, *${fullName}*!\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
            }
          } else {
            // Conversational grace: if student said something conversational, answer via AI first
            const clean = messageBody.trim();
            if (clean.length >= 3 && /[a-zA-Z]/.test(clean)) {
              const aiAnswer = await AIKnowledgeService.answerQuestion(clean, history);
              replyText =
                `${aiAnswer}\n\n` +
                `*To continue your admission registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
              nextState = CONVERSATION_STATE.AWAITING_NAME;
            } else {
              replyText =
                "Please enter a valid full name (alphabetic characters only, e.g. *Muhammad Ali*).\n\n" +
                "If you have a question instead, feel free to ask!";
              nextState = CONVERSATION_STATE.AWAITING_NAME;
            }
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
            break;
          }

          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            break;
          }

          // Check if candidate is asking to change or correct another field (e.g. name, marks)
          const correctionInFather = await LeadBotService.resolveCorrectionIntent(messageBody);
          if (correctionInFather && correctionInFather.field && correctionInFather.field !== 'FATHER_NAME') {
            if (correctionInFather.field === 'FULL_NAME') {
              if (correctionInFather.directValue) {
                fullName = correctionInFather.directValue;
                replyText = `Thank you! Full Name updated to *${fullName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
              } else {
                nextState = CONVERSATION_STATE.AWAITING_NAME;
                replyText = "Please provide your correct *Full Name*.";
              }
              break;
            } else if (correctionInFather.field === 'MARKS') {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
              break;
            } else if (correctionInFather.field === 'CNIC') {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
              break;
            } else if (correctionInFather.field === 'EMAIL') {
              nextState = CONVERSATION_STATE.AWAITING_EMAIL;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
              break;
            } else if (correctionInFather.field === 'ACADEMIC_GROUP') {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
              break;
            }
          }

          if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
            nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            break;
          }

          const directFather = LeadBotService.extractDirectFatherName(messageBody);
          const candidateFather = directFather || (LeadBotService.isValidName(messageBody) ? messageBody.trim() : null);

          if (candidateFather) {
            fatherName = candidateFather;
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
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
            } else {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText =
                `Noted.\n\n` +
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
            }
          } else {
            const clean = messageBody.trim();
            if (clean.length >= 3 && /[a-zA-Z]/.test(clean)) {
              const aiAnswer = await AIKnowledgeService.answerQuestion(clean, history);
              replyText =
                `${aiAnswer}\n\n` +
                `*To continue your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            } else {
              replyText =
                "Please enter a valid Father's name (letters only, e.g. *Tariq Mahmood*).\n\n" +
                "If you have a question, feel free to ask!";
              nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
            }
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

          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_MARKS;
            break;
          }

          // Check if student wants to correct or redirect to another field (e.g. father's name or full name)
          const correctionInMarks = await LeadBotService.resolveCorrectionIntent(messageBody);
          if (correctionInMarks && correctionInMarks.field && correctionInMarks.field !== 'MARKS') {
            if (correctionInMarks.field === 'FATHER_NAME') {
              if (correctionInMarks.directValue) {
                fatherName = correctionInMarks.directValue;
                replyText = `Thank you! Father's Name updated to *${fatherName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead)}`;
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
              } else {
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                replyText = "Please provide your correct *Father's Name*.";
              }
              break;
            } else if (correctionInMarks.field === 'FULL_NAME') {
              if (correctionInMarks.directValue) {
                fullName = correctionInMarks.directValue;
                replyText = `Thank you! Full Name updated to *${fullName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead)}`;
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
              } else {
                nextState = CONVERSATION_STATE.AWAITING_NAME;
                replyText = "Please provide your correct *Full Name*.";
              }
              break;
            } else if (correctionInMarks.field === 'CNIC') {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
              break;
            } else if (correctionInMarks.field === 'EMAIL') {
              nextState = CONVERSATION_STATE.AWAITING_EMAIL;
              replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
              break;
            }
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
                  replyText = `Thank you! Noted: *${percentage.toFixed(1)}%* marks (${obtained}/${total}).\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
                } else if (!fatherName) {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = `Thank you, *${fullName}*! Noted: *${percentage.toFixed(1)}%* marks (${obtained}/${total}).\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
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
                    LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
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
              `*To check your program eligibility:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead)}`;
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
                replyText = `Thank you! Noted: *${parsed.percentage.toFixed(1)}%* marks (${parsed.obtained}/${parsed.total}).\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_NAME, lead)}`;
              } else if (!fatherName) {
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                replyText = `Thank you, *${fullName}*! Noted: *${parsed.percentage.toFixed(1)}%* marks (${parsed.obtained}/${parsed.total}).\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_FATHER_NAME, lead)}`;
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
                  LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
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
            break;
          }

          // Student explicitly indicates they want to ask a question (Requirement 6)
          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
            break;
          }

          // If the message is an inquiry / question (and not a direct group declaration like "ICS" or "Pre-Medical")
          if (!LeadBotService.isDirectGroupDeclaration(messageBody) && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead)}`;
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
            break;
          }

          // Classification of study group (Pre-Eng, Pre-Med, ICS, DAE, etc.)
          const groupResult = LeadBotService.classifyAcademicGroup(messageBody);

          if (groupResult?.group === 'Ineligible') {
            nextState = CONVERSATION_STATE.NOT_INTERESTED;
            qualificationChanged = true;
            isEligible = false;
            ineligibilityReason = INELIGIBILITY_REASON.NO_MATHEMATICS;
            eligibleFor = PROGRAM_ELIGIBILITY.NONE;
            replyText =
              "Thank you for sharing your background. Engineering and Computing Technology programs (SE, SET, CET) require an FSc Pre-Engineering, ICS, Pre-Medical, or DAE background.\n\n" +
              "Unfortunately, candidates with Arts, Humanities, or Commerce backgrounds are not eligible for these programs. If you would like information about other university departments or programs, feel free to ask anytime!";
          } else if (groupResult?.group === 'Pre-Medical') {
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
                "Noted: *Pre-Medical*! Up to 40% of seats in B.Sc. Software Engineering (SE) are offered to Pre-Medical candidates under PEC policy, and you are fully eligible for Software Engineering Technology (SET) & Computer Engineering Technology (CET) (with an additional deficiency Mathematics course in the 1st semester).\n\n" +
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
            }
          } else if (groupResult?.eligible) {
            hasMaths = true;
            priorDegree = groupResult.group;

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
                `Great! Noted: *${priorDegree}*.\n\n` +
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
            }
          } else if (LeadBotService.isNegative(messageBody)) {
            // Student replied No / Nahi to having studied mathematics -> Pre-Medical
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
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
            }
          } else if (AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead)}`;
            nextState = CONVERSATION_STATE.AWAITING_MATHS;
          } else {
            // Check if candidate wants to correct another field (e.g. father's name, full name, or marks)
            const correctionInMaths = await LeadBotService.resolveCorrectionIntent(messageBody);
            if (correctionInMaths && correctionInMaths.field && correctionInMaths.field !== 'ACADEMIC_GROUP') {
              if (correctionInMaths.field === 'FATHER_NAME') {
                if (correctionInMaths.directValue) {
                  fatherName = correctionInMaths.directValue;
                  replyText = `Thank you! Father's Name updated to *${fatherName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_MATHS;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = "Please provide your correct *Father's Name*.";
                }
                break;
              } else if (correctionInMaths.field === 'FULL_NAME') {
                if (correctionInMaths.directValue) {
                  fullName = correctionInMaths.directValue;
                  replyText = `Thank you! Full Name updated to *${fullName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_MATHS;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_NAME;
                  replyText = "Please provide your correct *Full Name*.";
                }
                break;
              } else if (correctionInMaths.field === 'MARKS') {
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
                break;
              } else if (correctionInMaths.field === 'CNIC') {
                nextState = CONVERSATION_STATE.AWAITING_CNIC;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
                break;
              } else if (correctionInMaths.field === 'EMAIL') {
                nextState = CONVERSATION_STATE.AWAITING_EMAIL;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
                break;
              }
            }

            // Conversational grace fallback
            if (clean.length >= 3 && /[a-zA-Z]/.test(clean)) {
              const aiAnswer = await AIKnowledgeService.answerQuestion(clean, history);
              replyText =
                `${aiAnswer}\n\n` +
                `*To continue:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead)}`;
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
            } else {
              replyText =
                "Please let us know your study background (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, *DAE*) or reply *Yes* if you studied Mathematics.\n\n" +
                "If you have a question, feel free to ask!";
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
            }
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

          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_CNIC;
            break;
          }

          const parsedCnic = LeadBotService.parseCnic(messageBody);

          if (!parsedCnic) {
            const correctionInCnic = await LeadBotService.resolveCorrectionIntent(messageBody);
            if (correctionInCnic && correctionInCnic.field && correctionInCnic.field !== 'CNIC') {
              if (correctionInCnic.field === 'FATHER_NAME') {
                if (correctionInCnic.directValue) {
                  fatherName = correctionInCnic.directValue;
                  replyText = `Thank you! Father's Name updated to *${fatherName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_CNIC;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = "Please provide your correct *Father's Name*.";
                }
                break;
              } else if (correctionInCnic.field === 'FULL_NAME') {
                if (correctionInCnic.directValue) {
                  fullName = correctionInCnic.directValue;
                  replyText = `Thank you! Full Name updated to *${fullName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_CNIC;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_NAME;
                  replyText = "Please provide your correct *Full Name*.";
                }
                break;
              } else if (correctionInCnic.field === 'MARKS') {
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
                break;
              } else if (correctionInCnic.field === 'ACADEMIC_GROUP') {
                nextState = CONVERSATION_STATE.AWAITING_MATHS;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
                break;
              } else if (correctionInCnic.field === 'EMAIL') {
                nextState = CONVERSATION_STATE.AWAITING_EMAIL;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
                break;
              }
            }
          }

          if (!parsedCnic && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To continue your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead)}`;
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
                "Thank you!\n\n" +
                LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead);
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

          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.AWAITING_EMAIL;
            break;
          }

          const parsedEmail = LeadBotService.parseEmail(messageBody);

          if (!parsedEmail) {
            const correctionInEmail = await LeadBotService.resolveCorrectionIntent(messageBody);
            if (correctionInEmail && correctionInEmail.field && correctionInEmail.field !== 'EMAIL') {
              if (correctionInEmail.field === 'FATHER_NAME') {
                if (correctionInEmail.directValue) {
                  fatherName = correctionInEmail.directValue;
                  replyText = `Thank you! Father's Name updated to *${fatherName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_EMAIL;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                  replyText = "Please provide your correct *Father's Name*.";
                }
                break;
              } else if (correctionInEmail.field === 'FULL_NAME') {
                if (correctionInEmail.directValue) {
                  fullName = correctionInEmail.directValue;
                  replyText = `Thank you! Full Name updated to *${fullName}*.\n\n${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead)}`;
                  nextState = CONVERSATION_STATE.AWAITING_EMAIL;
                } else {
                  nextState = CONVERSATION_STATE.AWAITING_NAME;
                  replyText = "Please provide your correct *Full Name*.";
                }
                break;
              } else if (correctionInEmail.field === 'MARKS') {
                nextState = CONVERSATION_STATE.AWAITING_MARKS;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MARKS, lead);
                break;
              } else if (correctionInEmail.field === 'ACADEMIC_GROUP') {
                nextState = CONVERSATION_STATE.AWAITING_MATHS;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_MATHS, lead);
                break;
              } else if (correctionInEmail.field === 'CNIC') {
                nextState = CONVERSATION_STATE.AWAITING_CNIC;
                replyText = LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_CNIC, lead);
                break;
              }
            }
          }

          if (!parsedEmail && AIKnowledgeService.isQuestion(messageBody)) {
            const aiAnswer = await AIKnowledgeService.answerQuestion(messageBody, history);
            replyText =
              `${aiAnswer}\n\n` +
              `*To complete your registration:* ${LeadBotService.getPromptForState(CONVERSATION_STATE.AWAITING_EMAIL, lead)}`;
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

          // Cancel any pending un-dispatched upload link job so candidate can freely inquire or correct!
          try {
            await connection.execute(
              `DELETE FROM outbox_jobs WHERE job_type = 'LEAD_QUALIFIED' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.leadId')) = ? AND status = 'PENDING'`,
              [lead.id]
            );
          } catch {
            // Safe fallback
          }

          // Student explicitly indicates they want to ask a question (Requirement 6)
          if (AIKnowledgeService.isAskingToAskQuestion(messageBody)) {
            replyText = "Yes, please ask your question! What would you like to know?";
            nextState = CONVERSATION_STATE.QUALIFIED;
            break;
          }

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

          // 4. Check correction intent and direct field updates (Gemini AI assisted + deterministic priority)
          const correction = await LeadBotService.resolveCorrectionIntent(messageBody);
          if (correction && correction.field) {
            if (correction.field === 'FATHER_NAME') {
              if (correction.directValue) {
                fatherName = correction.directValue;
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
              } else {
                nextState = CONVERSATION_STATE.AWAITING_FATHER_NAME;
                replyText = "Please provide your correct *Father's Name*.";
              }
              break;
            }

            if (correction.field === 'FULL_NAME') {
              if (correction.directValue) {
                fullName = correction.directValue;
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
              } else {
                nextState = CONVERSATION_STATE.AWAITING_NAME;
                replyText = "Please provide your correct *Full Name*.";
              }
              break;
            }

            if (correction.field === 'MARKS') {
              nextState = CONVERSATION_STATE.AWAITING_MARKS;
              replyText = "What was your score in FSc / ICS / DAE (Part 1 or 2)? (Please provide obtained and total marks, e.g. *890/1100* or *420/550*)";
              break;
            }

            if (correction.field === 'ACADEMIC_GROUP') {
              nextState = CONVERSATION_STATE.AWAITING_MATHS;
              replyText = "Did you study Mathematics or what was your academic group? (e.g. *Pre-Engineering*, *ICS*, *Pre-Medical*, or *DAE*)";
              break;
            }

            if (correction.field === 'CNIC') {
              nextState = CONVERSATION_STATE.AWAITING_CNIC;
              replyText = "Please provide your correct 13-digit CNIC or Form-B number (e.g. *12345-1234567-1*).";
              break;
            }

            if (correction.field === 'EMAIL') {
              nextState = CONVERSATION_STATE.AWAITING_EMAIL;
              replyText = "Please provide your correct active *Email Address* (e.g. *applicant@example.com*).";
              break;
            }

            if (correction.field === 'ALL') {
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

            if (correction.field === 'UNKNOWN') {
              nextState = CONVERSATION_STATE.QUALIFIED;
              replyText = LeadBotService.getCorrectionMenuText();
              break;
            }
          }

          // 5. General statement of mistake or desire to correct (e.g. "I did a mistake", "ghalti ho gaii", "I wanna correct something")
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
            replyText = "Let's update your marks. What was your score in FSc / ICS / DAE? (Please provide obtained and total marks, e.g. *890/1100* or *420/550*).";
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

      replyText = stripEmojis(replyText);

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
          availableAt: new Date(Date.now() + 60 * 1000), // Delay document upload link by 1 minute so student can review and correct
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
    const cleanReply = stripEmojis(replyText);
    const safeHistory = Array.isArray(history) ? history : [];
    const updatedHistory = [
      ...safeHistory,
      { direction: 'INBOUND', text: inboundText, timestamp: new Date(timestamp).toISOString() },
      { direction: 'OUTBOUND', text: cleanReply, timestamp: new Date().toISOString() },
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

    // Sync to adm_students if student record exists for this lead or phone
    try {
      const studentUpdates = [];
      const studentParams = [];
      if (extraFields.fullName !== undefined) {
        studentUpdates.push('full_name = ?');
        studentParams.push(extraFields.fullName);
      }
      if (extraFields.fatherName !== undefined) {
        studentUpdates.push('father_name = ?');
        studentParams.push(extraFields.fatherName);
      }
      if (extraFields.cnic !== undefined) {
        studentUpdates.push('cnic = ?');
        studentParams.push(extraFields.cnic);
      }
      if (extraFields.email !== undefined) {
        studentUpdates.push('email = ?');
        studentParams.push(extraFields.email);
      }
      if (extraFields.fscMarks !== undefined) {
        studentUpdates.push('fsc_obtained_marks = ?');
        studentParams.push(extraFields.fscMarks);
      }
      if (extraFields.priorDegree !== undefined) {
        studentUpdates.push('prior_degree = ?');
        studentParams.push(extraFields.priorDegree);
      }
      if (extraFields.eligibleFor !== undefined) {
        studentUpdates.push('eligible_for = ?');
        studentParams.push(extraFields.eligibleFor);
      }

      if (studentUpdates.length > 0) {
        studentParams.push(leadId, phoneNormalized);
        await connection.execute(
          `UPDATE adm_students SET ${studentUpdates.join(', ')} WHERE lead_id = ? OR phone_normalized = ?`,
          studentParams
        );
      }
    } catch {
      // Non-blocking in case adm_students table is not present in mock environments
    }

    // Enqueue outbound reply if enabled (defaults to true for webhook/async flows, false when directly sent via socket)
    if (options.queueReply !== false) {
      await dispatchJob({
        queueName: 'whatsapp_replies',
        jobType: EVENT_TYPES.WHATSAPP_MESSAGE,
        payload: {
          recipientPhone: phoneNormalized,
          messageType: 'TRANSACTIONAL',
          messageText: cleanReply,
          metadata: { leadId, state: nextState },
        },
        connection,
      });
    }
  }
}

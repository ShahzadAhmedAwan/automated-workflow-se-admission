import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_PATH = path.resolve(__dirname, '../../../../data/knowledge.txt');

export function stripEmojis(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export class AIKnowledgeService {
  static knowledgeCache = null;

  /**
   * Loads the knowledge base text from server/data/knowledge.txt
   */
  static getKnowledgeText() {
    if (AIKnowledgeService.knowledgeCache) {
      return AIKnowledgeService.knowledgeCache;
    }
    try {
      if (fs.existsSync(KNOWLEDGE_PATH)) {
        AIKnowledgeService.knowledgeCache = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');
      } else {
        // Fallback default knowledge
        AIKnowledgeService.knowledgeCache = `
INSTITUTION: University of Azad Jammu & Kashmir (UAJK), Chehla Campus, Muzaffarabad
DEPARTMENT: Department of Software Engineering
PROGRAMS:
- B.Sc. Software Engineering (SE): PEC accredited, 60% min in FSc Pre-Engg/ICS/DAE. Pre-Med max 40% quota. Fee: ~PKR 60,130/sem.
- B.Sc. Software Engineering Technology (SET): NTC accredited, 50% min. Pre-Med eligible with deficiency math course. Fee: ~PKR 60,130/sem.
- B.Sc. Computer Engineering Technology (CET): NTC accredited, 50% min. Pre-Med eligible with deficiency math. Fee: ~PKR 59,130/sem.
- MS Software Engineering: 2-year program, 50% in BS + GAT. Fee: ~PKR 57,590/sem.
FEES: Application PKR 3,000; Entry Test PKR 1,000; Semester tuition ~PKR 59,130 - 60,130.
HOSTEL: Available at Chehla Campus for boys and girls (~PKR 8,000/month with meals).
CONTACT: Helpline: +92-5822-960510 | se@uajk.edu.pk | Coordinator: Engr. Dr. Muhammad Zaman Fakhar | Web: https://uajk.edu.pk/
`;
      }
    } catch {
      AIKnowledgeService.knowledgeCache = '';
    }
    return AIKnowledgeService.knowledgeCache;
  }

  /**
   * Updates the knowledge base document and refreshes in-memory cache
   */
  static setKnowledgeText(content) {
    if (typeof content !== 'string') {
      throw new TypeError('Knowledge document content must be a string.');
    }
    const dir = path.dirname(KNOWLEDGE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(KNOWLEDGE_PATH, content, 'utf8');
    AIKnowledgeService.knowledgeCache = content;
    return {
      byteSize: Buffer.byteLength(content, 'utf8'),
      charCount: content.length,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Returns metadata and stats about the current knowledge document
   */
  static getKnowledgeMeta() {
    const text = AIKnowledgeService.getKnowledgeText();
    let stats = null;
    try {
      if (fs.existsSync(KNOWLEDGE_PATH)) {
        stats = fs.statSync(KNOWLEDGE_PATH);
      }
    } catch {
      stats = null;
    }
    return {
      knowledge: text,
      byteSize: Buffer.byteLength(text, 'utf8'),
      charCount: text.length,
      wordCount: text.trim().split(/\s+/).filter(Boolean).length,
      updatedAt: stats?.mtime ? stats.mtime.toISOString() : new Date().toISOString(),
    };
  }

  /**
   * Helper to detect if a student explicitly states they want to ask a question
   * (e.g. "Yes, I have a question", "han ek sawal hai", "can I ask something")
   */
  static isAskingToAskQuestion(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();

    // English patterns
    const englishPatterns = [
      /\b(yes\b.*\b(have a question|want to ask|can i ask|ask a question))\b/i,
      /\b(i have a question|i have one question|i got a question|have a question|got a question)\b/i,
      /\b(can i ask (a question|something)|may i ask (a question|something)|want to ask (a question|something))\b/i,
      /\b(yes\s*,?\s*(i\s+do|i\s+have))\b/i,
    ];

    if (englishPatterns.some((p) => p.test(clean))) {
      return true;
    }

    // Urdu / Roman Urdu patterns
    const urduPatterns = [
      /\b(sawal (hai|puchna|poochna)|question hai|ek sawal|kuch puchna|kuch poochna)\b/i,
      /\b(han\b.*\b(sawal|question|puchna|poochna))\b/i,
      /\b(ji\b.*\b(sawal|question|puchna|poochna))\b/i,
      /\b(jee\b.*\b(sawal|question|puchna|poochna))\b/i,
      /\b(haan\b.*\b(sawal|question|puchna|poochna))\b/i,
      /\b(puch sakta|pooch sakta|puch sakti|pooch sakti)\b/i,
    ];

    return urduPatterns.some((p) => p.test(clean));
  }

  /**
   * Helper to detect student check-in, presence ping, or follow-up messages
   * (e.g. "hello?", "are you there?", "batao", "koi hai?", "sun rahe ho?", "??", "offline?", "sir?")
   */
  static isCheckIn(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();

    // Symbols / punctuation only like "?", "??", "???", "..."
    if (/^[?؟.\s!]+$/.test(clean)) return true;

    // Single words commonly sent as check-ins or pings
    const singleWords = [
      'hello', 'hi', 'hey', 'salam', 'aoa', 'assalam', 'sir', 'bhai', 'bro',
      'brother', 'batao', 'batayein', 'bta', 'btao', 'online', 'offline',
      'reply', 'respond', 'listening', 'sunen', 'suno'
    ];
    if (singleWords.includes(clean.replace(/[?؟!. ]/g, ''))) return true;

    // Direct check-in phrases
    const patterns = [
      /\b(are you (there|here|online)|you there|r u there|u there)\b/i,
      /\b(koi hai|koi hy|sun rahe ho|sun rahay ho|sun rhy ho|sun rhe ho)\b/i,
      /\b(batao na|bta na|bta do|bata do|bta dein|bata dein|btaen|batayein)\b/i,
      /\b(kya hua|kia hua|kya hogya|kia hogya)\b/i,
      /\b(reply (do|karo|karein|please|plz)|jawab do|jawab dein|respond please)\b/i,
      /\b(offline (ho|chale|gaye|gye|chaly)|online (ho|hai|hein))\b/i,
      /\b(still waiting|waiting for (reply|response)|answer me|kuch bolo)\b/i,
      /^(hello\s+(sir|bhai|brother|admin|bot)|aoa\s+(sir|bhai)|salam\s+(sir|bhai))\b/i,
      /\b(why did you stop|why stopped|stop ho gye|stop kion)\b/i,
    ];

    return patterns.some((p) => p.test(clean));
  }

  /**
   * Helper to detect if a message is an inquiry/question rather than a direct answer
   * Intelligently detects questions even when punctuation/question marks are omitted
   */
  static isQuestion(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();

    // 1. Explicit question marks (English and Arabic/Urdu)
    if (clean.includes('?') || clean.includes('؟')) return true;

    // 2. Direct intention to ask a question
    if (AIKnowledgeService.isAskingToAskQuestion(clean)) return true;

    // 3. Interrogatives at start of sentence
    if (
      /^(what|where|when|who|why|how|which|whose|whom|is|are|can|could|will|would|should|do|does|did|may|kya|kab|kahan|kidhar|kitna|kitni|kitnay|kitne|kaise|kaisay|kaisa|kaisi|konsa|konsi|konse|kon|koun|kyu|kyun|kyuu|kion|kyo)\b/i.test(
        clean
      )
    ) {
      return true;
    }

    // 4. Interrogatives / Question words anywhere in the text (with word boundaries)
    // Matches sentences like "fee kitni hai", "classes kab hongi", "university kahan hai", "admission kaise hoga", "coordinator kon hai"
    if (
      /\b(kya|kab|kahan|kidhar|kitna|kitni|kitnay|kitne|kaise|kaisay|kaisa|kaisi|konsa|konsi|konse|kon|koun|kyu|kyun|kyuu|kion)\b/i.test(
        clean
      )
    ) {
      return true;
    }

    // 5. English question phrases anywhere in the text
    if (
      /\b(how much|how many|how to|where is|where are|when will|when is|when does|what is|what are|what about|which program|which degree|who is|can i|can we|could i|is there|are there|do you have|will there be)\b/i.test(
        clean
      )
    ) {
      return true;
    }

    // 6. Urdu inquiry verbs and modal expressions
    // Matches expressions like "apply kar sakte hain", "admission mil sakta hai", "classes hoti hain", "seat chahiye", "fee bata dain"
    const urduInquiryPatterns = [
      /\b(kar sakte|kar sakti|kar sakty|kr skte|kr skti|apply kar sakte|apply kr skte)\b/i,
      /\b(mil sakta|mil sakti|milay ga|milega|ho sakta|ho sakti|mil jaye|mil jae)\b/i,
      /\b(batao|batayein|bata dain|bata dein|bta do|bta dain|bta dein|btaen|bataiye|batana)\b/i,
      /\b(chahiye|chahye|maloom karna|maloomat|guide kar|guide kr|rahnumai)\b/i,
      /\b(hai ya nahi|h ya ni|h k nhi|h k nai|hota hai|hoti hai|hote hain)\b/i,
      /\b(admission lena|admission leni|apply karna|apply krna|admission chahiye|seat chahiye|seats chahiye)\b/i,
      /\b(information chahiye|info chahiye|info chahye|details chahiye)\b/i,
    ];
    if (urduInquiryPatterns.some((p) => p.test(clean))) {
      return true;
    }

    // 7. English inquiry request verbs
    const englishInquiryPatterns = [
      /\b(tell me|want to know|wanna know|would like to know|like to know|need to know|let me know)\b/i,
      /\b(give me details|give details|share details|send details|information about|info about|details of|details about|guide me)\b/i,
    ];
    if (englishInquiryPatterns.some((p) => p.test(clean))) {
      return true;
    }

    // 8. Specific other discipline inquiries
    if (
      /\b(electrical|civil|mechanical|electronics|telecom|mechatronics|computer science|bs cs|bscs|artificial intelligence|bs ai|bsai|cyber security|data science|bba|pharmacy|dpt|mbbs|llb)\b/i.test(
        clean
      )
    ) {
      return true;
    }

    // 9. Core admissions domain topics (standalone keywords or in phrases without ?)
    const domainTopicPatterns = [
      /\b(fee|fees|tuition|challan|charges|kharcha|semester fee|admission fee|hostel fee)\b/i,
      /\b(hostel|hostels|accommodation|mess charges|rehaish|boarding)\b/i,
      /\b(entry test|entrance test|admission test|test date|test venue|test syllabus|test pattern|nats|nts|gat)\b/i,
      /\b(eligibility|eligibility criteria|criteria|minimum marks|percentage required|merit list|merit formula|aggregate|closing merit)\b/i,
      /\b(pre[- ]?medical policy|pre[- ]?medical quota|pre[- ]?med quota|deficiency math|pre[- ]?med policy)\b/i,
      /\b(documents|required documents|documents checklist|migration certificate|noc|domicile|character certificate)\b/i,
      /\b(last date|closing date|deadline|admission schedule|schedule|classes start|class timing)\b/i,
      /\b(helpline|contact number|coordinator|phone number|official email|campus address|campus location)\b/i,
      /\b(programs offered|courses offered|degree programs|degrees offered|disciplines)\b/i,
      /\b(scholarship|scholarships|financial aid|need based|ehsaas)\b/i,
      /\b(transport|bus|buses|point|van|pick and drop|pick & drop)\b/i,
      /\b(class timing|timing|timings|shift|shifts|morning|evening|weekend|classes kab)\b/i,
      /\b(result awaiting|awaiting result|hope certificate|part[- ]?1|part[- ]?2 result|appearing)\b/i,
      /\b(gap year|gap years|saal zaya|old student|previous year)\b/i,
      /\b(form[- ]?b|b[- ]?form|bay form|cnic nahi|without cnic)\b/i,
      /\b(email nahi|without email|email zaroori|email lazmi)\b/i,
      /\b(seats|seat matrix|district quota|ajk quota)\b/i,
      /\b(pec|ntc|hec|accreditation|accredited|recognized|approval)\b/i,
      /\b(migration|transfer|credit transfer)\b/i,
      /\b(improve|improvement|marks improve|repeat)\b/i,
      /\b(who (are you|is this|are u|r u)|who speaks|aap kon|kon ho|koun ho)\b/i,
      /\b(why (are you|did you) (texting|messaging|calling|msg)|why msg me|kion msg|kion message|get my number|got my number)\b/i,
      /\b(what is this|what's this|whats this|ye kya hai|yeh kya hai|what is it about)\b/i,
    ];

    return domainTopicPatterns.some((pattern) => pattern.test(clean));
  }

  /**
   * Answer student queries via Gemini API with fallback to local knowledge matcher
   */
  static async answerQuestion(userQuery, chatHistory = []) {
    if (!userQuery || !userQuery.trim()) {
      return "How may I help you with Department of Software Engineering admissions at UAJK?";
    }

    const knowledge = AIKnowledgeService.getKnowledgeText();
    const apiKey = process.env.GEMINI_API_KEY;

    let answer = null;
    // 1. Try Gemini API if API key is configured (unless in automated test mode)
    if (apiKey && apiKey !== 'mock_key' && apiKey !== 'replace-with-a-secret' && (process.env.NODE_ENV !== 'test' || process.env.TEST_LIVE_GEMINI === '1')) {
      try {
        const response = await AIKnowledgeService.callGeminiAPI({
          apiKey,
          userQuery,
          knowledge,
          chatHistory,
        });
        if (response && response.trim()) {
          answer = response.trim();
        }
      } catch {
        // Fall through to local knowledge matcher on network error, rate limit, timeout, etc.
      }
    }

    // 2. Local intelligent knowledge base matcher (Fast, deterministic & offline-safe)
    if (!answer) {
      answer = AIKnowledgeService.matchLocalKnowledge(userQuery, knowledge);
    }
    return stripEmojis(answer);
  }

  /**
   * Calls Google Gemini Generative Language REST API with a strict 4.5s timeout
   */
  static async callGeminiAPI({ apiKey, userQuery, knowledge, chatHistory = [] }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const systemPrompt = `You are the official WhatsApp Admissions Assistant for the Department of Software Engineering at the University of Azad Jammu and Kashmir (UAJK), Chehla Campus, Muzaffarabad.
The admissions office has provided the official admissions information below. Ground all answers strictly in this document.

CRITICAL INSTRUCTIONS:
1. STRICTLY NO EMOJIS: Do not use any emojis, icons, or symbols under any circumstances. Keep responses completely emoji-free.
2. Tone: Professional, clear, polite, and simple. Make answers easy for prospective high school students and parents to understand.
3. Keep replies concise and easy to read on WhatsApp (2-4 short sentences or standard bullet points). Use bold (*text*) only for important headings, program names, or key numbers.
4. Department programs:
   - B.Sc. Software Engineering (SE): PEC accredited, minimum 60% in F.Sc. (Pre-Engineering, ICS, DAE, or 40% Pre-Medical quota).
   - B.Sc. Software Engineering Technology (SET): NTC accredited, minimum 50% in F.Sc. (Pre-Medical fully eligible with deficiency math).
   - B.Sc. Computer Engineering Technology (CET): NTC accredited, minimum 50% in F.Sc. (Pre-Medical fully eligible with deficiency math).
5. If a student asks about other programs (e.g. Electrical Engineering, Civil Engineering, Mechanical, BSCS, BSAI), politely clarify what is offered at the Department of Software Engineering (Chehla Campus) versus other university faculties, based on the knowledge base.
6. If a student says they have a question (e.g. "Yes, I have a question"), politely invite them to ask.
7. If the exact answer is not in the knowledge base, politely provide general university guidance and direct them to the Department Helpline (+92-5822-960510, se@uajk.edu.pk).

KNOWLEDGE BASE:
${knowledge}
`;

    const recentHistoryText = (chatHistory || [])
      .slice(-4)
      .map((h) => `${h.direction === 'INBOUND' ? 'Student' : 'Bot'}: ${h.text}`)
      .join('\n');

    const contents = [
      {
        role: 'user',
        parts: [
          {
            text: `${systemPrompt}\n\nRecent Conversation:\n${recentHistoryText}\n\nCurrent Student Question:\n"${userQuery}"\n\nProvide a concise, helpful response for WhatsApp:`,
          },
        ],
      },
    ];

    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ].filter(Boolean);

    try {
      for (const model of candidateModels) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents }),
            signal: controller.signal,
          });

          if (!res.ok) {
            if (res.status === 400 || res.status === 401 || res.status === 403) {
              break;
            }
            continue;
          }

          const data = await res.json();
          const text =
            data?.candidates?.[0]?.content?.parts?.[0]?.text ||
            data?.candidates?.[0]?.text ||
            null;
          if (text) return stripEmojis(text);
        } catch {
          continue;
        }
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Intelligently parses user message using Google Gemini to classify correction/change intent and extract field/value
   * @param {string} userMessage
   * @returns {Promise<{ isCorrection: boolean, field: string|null, newValue: string|null }|null>}
   */
  static async classifyCorrectionWithGemini(userMessage) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'mock_key' || apiKey === 'replace-with-a-secret' || (process.env.NODE_ENV === 'test' && process.env.TEST_LIVE_GEMINI !== '1')) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const prompt = `You are an intelligent admissions bot intent parser for a university admissions assistant.
Analyze the following student message (which may be in English, Urdu, or Roman Urdu with typos like "chnage", "fther", "walid", "abbu", "marks", "glat"):
"${userMessage}"

Determine if the student wants to change/correct an application field.
Valid fields: "FATHER_NAME", "FULL_NAME", "MARKS", "ACADEMIC_GROUP", "CNIC", "EMAIL", "ALL".
Also determine if they provided the new value directly in the message (e.g. "change father name to Tariq Mahmood" -> newValue: "Tariq Mahmood").

Respond ONLY with valid JSON:
{"isCorrection": boolean, "field": "FATHER_NAME"|"FULL_NAME"|"MARKS"|"ACADEMIC_GROUP"|"CNIC"|"EMAIL"|"ALL"|null, "newValue": string|null}`;

    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-flash-lite-latest',
      'gemini-3.5-flash-lite',
      'gemini-3-flash-preview',
      'gemini-3.1-flash-lite',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ].filter(Boolean);

    try {
      for (const model of candidateModels) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
            signal: controller.signal,
          });
          if (!res.ok) {
            if (res.status === 400 || res.status === 401 || res.status === 403) {
              break;
            }
            continue;
          }
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
          if (text) {
            const cleanJson = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (parsed && typeof parsed === 'object') {
              return parsed;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }

  /**
   * Deterministic, rule-grounded knowledge base lookup when AI API is unavailable
   */
  static matchLocalKnowledge(query, _knowledge = '') {
    const q = (query || '').toLowerCase();

    // 000. Inquiries about presence, check-in, or "are you there / offline / sun rahe ho / batao"
    if (AIKnowledgeService.isCheckIn(q)) {
      return (
        "Assalam-o-Alaikum! Yes, I am right here with you and glad to help! Please feel free to ask any question regarding our programs (SE, SET, CET), eligibility criteria, fee structure, hostel facilities, or admissions process."
      );
    }

    // 00a. Inquiries about making corrections / editing details
    if (
      /\b(correction|correct|edit|change|chnage|update|modify|replace|theek|sahi|badalna)\b/i.test(q) &&
      /\b(can\s+i|can\s+you|possible|how\s+to|karna|kar\s+sakta|kar\s+sakte|ho\s+sakta|name|father|marks|email|cnic)\b/i.test(q)
    ) {
      return (
        "Yes, you can easily correct or update any of your information at any time! Simply tell me which detail needs to be updated (such as Father's Name, Full Name, Marks, CNIC, or Email) or send your correct details directly, and I will update your pre-registration record immediately."
      );
    }

    // 00. Explicit statement of wanting to ask a question
    if (AIKnowledgeService.isAskingToAskQuestion(q)) {
      return (
        "Yes, please ask your question! Feel free to ask anything about our undergraduate programs (SE, SET, CET), eligibility criteria, fee structure, hostel facilities, or the admissions process, and I will be glad to help."
      );
    }

    // 0a. Identity / "who are you" / "who is this"
    if (
      q.includes('who are you') ||
      q.includes('who is this') ||
      q.includes('who are u') ||
      q.includes('who r u') ||
      q.includes('aap kon') ||
      q.includes('kon ho') ||
      q.includes('koun ho') ||
      q.includes('who you are') ||
      q.includes('who speaks')
    ) {
      return (
        "Assalam-o-Alaikum! I am the automated Admissions Assistant for the Department of Software Engineering at the University of Azad Jammu & Kashmir (UAJK), Chehla Campus, Muzaffarabad.\n\n" +
        "I am here to assist students with admissions, program options (B.Sc. Software Engineering, SET, CET), eligibility criteria, scholarships, and fee structures for Fall 2026."
      );
    }

    // 0b. Purpose of contact / "why are you texting me" / "how did you get my number"
    if (
      q.includes('why are you texting') ||
      q.includes('why did you text') ||
      q.includes('why are you messaging') ||
      q.includes('why message me') ||
      q.includes('why msg me') ||
      q.includes('why did you message') ||
      q.includes('kion msg') ||
      q.includes('kion message') ||
      q.includes('get my number') ||
      q.includes('got my number') ||
      q.includes('why contact')
    ) {
      return (
        "Assalam-o-Alaikum! You received this automated outreach message because our admissions desk is contacting prospective candidates regarding Fall 2026 admissions at UAJK.\n\n" +
        "Our goal is to help you explore admission opportunities at UAJK. If you are not interested, simply let us know and we will not message you further."
      );
    }

    // 0c. General context / "what is this" / "what is this about" / "ye kya hai"
    if (
      q.includes('what is this') ||
      q.includes("what's this") ||
      q.includes('whats this') ||
      q.includes('ye kya hai') ||
      q.includes('yeh kya hai') ||
      q.includes('kis cheez') ||
      q.includes('what is it about')
    ) {
      return (
        "This is an official admissions inquiry and guidance service from the Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK), Chehla Campus.\n\n" +
        "We offer the following undergraduate programs:\n" +
        "- B.Sc. Software Engineering (SE) - PEC Accredited\n" +
        "- B.Sc. Software Engineering Technology (SET) - NTC Accredited (Pre-Med eligible)\n" +
        "- B.Sc. Computer Engineering Technology (CET) - NTC Accredited (Pre-Med eligible)\n\n" +
        "Would you like to check your eligibility or know more about our programs?"
      );
    }

    // 1. Hostel accommodation (Check before general fee since users often ask "hostel fee")
    if (
      q.includes('hostel') ||
      q.includes('accommodation') ||
      q.includes('rehaish') ||
      q.includes('mess') ||
      q.includes('stay')
    ) {
      return (
        "*Hostel Facilities (Chehla Campus):*\n" +
        "- Hostels are available for both male and female students on merit/allotment basis.\n" +
        "- Chehla Campus has 1 male hostel and 2 female hostels.\n" +
        "- Approximate monthly hostel charges are ~PKR 8,000/month (including basic meals and utilities)."
      );
    }

    // 2. Entry test / Entrance exam
    if (
      q.includes('entry test') ||
      q.includes('entrance test') ||
      q.includes('admission test') ||
      q.includes('test venue') ||
      q.includes('test date') ||
      /\btest\b/.test(q) ||
      q.includes('syllabus') ||
      /\bnats\b/.test(q) ||
      /\bnts\b/.test(q)
    ) {
      return (
        "*Entrance Test Information:*\n" +
        "- The University Entrance Test is mandatory for SE, SET, and CET.\n" +
        "- Test Fee: PKR 1,000 (deposit via HBL challan).\n" +
        "- Venue: Chehla Campus, Muzaffarabad.\n" +
        "- Requirements on test day: Original CNIC/B-Form and printed Admit Card.\n" +
        "- Help Desk Contact: 0300-6253998 / 0333-5750711."
      );
    }

    // 3. Pre-Medical policy & eligibility
    if (
      q.includes('pre-medical') ||
      q.includes('pre medical') ||
      q.includes('pre-med') ||
      q.includes('medical') ||
      q.includes('bio') ||
      q.includes('biology')
    ) {
      return (
        "*Pre-Medical Eligibility Policy at UAJK:*\n" +
        "- *SET & CET:* F.Sc. Pre-Medical students with minimum 50% marks are fully eligible under NTC policy. (You will study an additional non-credit deficiency Mathematics course in 1st semester).\n" +
        "- *B.Sc. Software Engineering (SE):* Up to 40% seats can be offered to Pre-Medical students who score 60%+ in F.Sc. under PEC policy quota + Entry Test."
      );
    }

    // 4. Fee structure / cost / tuition
    if (
      q.includes('fee') ||
      q.includes('cost') ||
      q.includes('tuition') ||
      q.includes('challan') ||
      q.includes('kharcha') ||
      q.includes('charges')
    ) {
      return (
        "*Fee Structure (Department of Software Engineering, UAJK):*\n" +
        "- *B.Sc. Software Engineering (SE):* ~PKR 60,130 per semester\n" +
        "- *B.Sc. Software Engineering Technology (SET):* ~PKR 60,130 per semester\n" +
        "- *B.Sc. Computer Engineering Technology (CET):* ~PKR 59,130 per semester\n" +
        "- *Application Processing Fee:* PKR 3,000 (payable via HBL challan)\n" +
        "- *Entry Test Fee:* PKR 1,000\n" +
        "Scholarships and easy fee installment facilities are also available."
      );
    }

    // 5. Eligibility criteria & minimum marks
    if (
      q.includes('eligib') ||
      q.includes('criteria') ||
      q.includes('minimum marks') ||
      q.includes('percentage') ||
      q.includes('50%') ||
      q.includes('60%')
    ) {
      return (
        "*Eligibility Criteria (Department of Software Engineering):*\n" +
        "- *B.Sc. Software Engineering (SE):* Minimum 60% in F.Sc. Pre-Engineering / ICS / DAE or Pre-Med quota + Entry test.\n" +
        "- *B.Sc. Software Engineering Technology (SET):* Minimum 50% in F.Sc. (Pre-Engineering, ICS, Pre-Medical, DAE).\n" +
        "- *B.Sc. Computer Engineering Technology (CET):* Minimum 50% in F.Sc. (Pre-Engineering, ICS, Pre-Medical, DAE).\n" +
        "- No 3rd division in academic career."
      );
    }

    // 6. Documents required / checklist
    if (
      q.includes('document') ||
      q.includes('documents') ||
      q.includes('certificate') ||
      q.includes('noc') ||
      q.includes('migration')
    ) {
      return (
        "*Required Documents Checklist:*\n" +
        "1. Attested copies of Matric & F.Sc./ICS certificates & DMCs\n" +
        "2. Character Certificate from college last attended\n" +
        "3. Copy of CNIC or Form-B (Applicant & Guardian)\n" +
        "4. Domicile & State Subject Certificate\n" +
        "5. 4 recent passport-size photographs\n" +
        "6. NOC / Migration Certificate (if F.Sc. was outside BISE Mirpur AJ&K)."
      );
    }

    // 7. Deadlines / Important dates / Classes start
    if (
      q.includes('deadline') ||
      q.includes('last date') ||
      q.includes('closing') ||
      q.includes('kab start') ||
      q.includes('classes') ||
      q.includes('schedule') ||
      q.includes('timing') ||
      q.includes('kab')
    ) {
      return (
        "*Important Admissions Schedule & Deadlines:*\n" +
        "- Applications for the upcoming intake are currently being accepted online.\n" +
        "- Merit lists are announced shortly following the Entry Test and document verification.\n" +
        "- Visit the official portal https://uajk.edu.pk/ for the exact closing date and test calendar."
      );
    }

    // 8. Contact info / Helpline / Coordinator / Address
    if (
      q.includes('contact') ||
      q.includes('number') ||
      q.includes('phone') ||
      q.includes('helpline') ||
      q.includes('coordinator') ||
      q.includes('email') ||
      q.includes('location') ||
      q.includes('address') ||
      q.includes('campus') ||
      q.includes('kahan') ||
      q.includes('kidhar')
    ) {
      return (
        "*Department Contact & Helpline:*\n" +
        "- *Campus:* Chehla / Main Campus, Muzaffarabad, UAJK\n" +
        "- *Department Helpline:* +92-5822-960510\n" +
        "- *Coordinator:* Engr. Dr. Muhammad Zaman Fakhar\n" +
        "- *Department Email:* se@uajk.edu.pk\n" +
        "- *Official Website:* https://uajk.edu.pk/"
      );
    }

    // 9. Programs offered
    if (
      q.includes('programs') ||
      q.includes('courses') ||
      q.includes('degree') ||
      q.includes('fields') ||
      /\b(se|set|cet)\b/i.test(q)
    ) {
      return (
        "*Programs Offered (Department of Software Engineering, UAJK):*\n" +
        "1. *B.Sc. Software Engineering (SE)* - 4 Years, PEC Accredited\n" +
        "2. *B.Sc. Software Engineering Technology (SET)* - 4 Years, NTC Accredited\n" +
        "3. *B.Sc. Computer Engineering Technology (CET)* - 4 Years, NTC Accredited\n" +
        "4. *MS Software Engineering* - 2 Years Postgraduate"
      );
    }

    // 9a. Inquiries about Electrical, Civil, Mechanical Engineering disciplines
    if (
      q.includes('electrical') ||
      q.includes('civil') ||
      q.includes('mechanical') ||
      q.includes('electronics') ||
      q.includes('telecom')
    ) {
      return (
        "*Engineering Disciplines at UAJK:*\n" +
        "At the *Department of Software Engineering* (Chehla Campus, Muzaffarabad), we offer:\n" +
        "- *B.Sc. Software Engineering (SE)* - PEC accredited (60% min F.Sc.)\n" +
        "- *B.Sc. Software Engineering Technology (SET)* - NTC accredited (50% min F.Sc.)\n" +
        "- *B.Sc. Computer Engineering Technology (CET)* - NTC accredited (50% min F.Sc.)\n\n" +
        "Electrical, Civil, and Mechanical Engineering fall under other engineering departments of the University. For details regarding Electrical or Civil admissions, please visit the central university portal at https://uajk.edu.pk/ or contact the University Admissions Directorate."
      );
    }

    // 9b. Inquiries about Computer Science, AI, Cyber Security
    if (
      q.includes('computer science') ||
      q.includes('bs cs') ||
      q.includes('bscs') ||
      q.includes('artificial intelligence') ||
      q.includes('bs ai') ||
      q.includes('bsai') ||
      q.includes('cyber security')
    ) {
      return (
        "*Computing Programs at UAJK:*\n" +
        "- *Department of Software Engineering (Chehla Campus):* Offers B.Sc. Software Engineering (PEC accredited, 60% min), SET (NTC, 50% min), and CET (NTC, 50% min).\n" +
        "- *Faculty of Science (King Abdullah Campus - Chatter Klass):* Offers BS Computer Science (BSCS), BS Artificial Intelligence (BSAI), and BS Cyber Security (50% min in F.Sc.).\n" +
        "Both campuses offer outstanding computing degree paths!"
      );
    }

    // 10. Scholarships
    if (
      q.includes('scholarship') ||
      q.includes('financial aid') ||
      q.includes('hec scholarship')
    ) {
      return (
        "*Scholarships at UAJK:*\n" +
        "- Merit Scholarships for top board and university scorers\n" +
        "- HEC Need-Based & Ehsaas Scholarships\n" +
        "- AJK Zakat & District Council Scholarships\n" +
        "Students can apply for financial assistance after securing admission."
      );
    }

    // 11. Transport / Bus / Point facilities
    if (
      q.includes('transport') ||
      q.includes('bus') ||
      q.includes('point') ||
      q.includes('van') ||
      q.includes('pick and drop')
    ) {
      return (
        "*Transport Facilities (UAJK Chehla Campus):*\n" +
        "- The University provides student bus / point transportation routes covering key areas in Muzaffarabad city and adjoining localities to Chehla Campus.\n" +
        "- Subsidized semester transport passes are issued by the university transport office upon enrollment."
      );
    }

    // 12. Class timings & shifts
    if (
      q.includes('timing') ||
      q.includes('timings') ||
      q.includes('shift') ||
      q.includes('morning') ||
      q.includes('evening') ||
      q.includes('weekend')
    ) {
      return (
        "*Class Timings & Shift Information:*\n" +
        "- All undergraduate programs (B.Sc. SE, SET, and CET) are conducted during regular morning hours (typically starting from 8:30 AM onwards).\n" +
        "- The programs are full-time regular weekday degree programs."
      );
    }

    // 13. Result awaiting & Hope Certificate policy
    if (
      q.includes('awaiting') ||
      q.includes('hope certificate') ||
      q.includes('result ka intezar') ||
      q.includes('part-ii result') ||
      q.includes('appearing')
    ) {
      return (
        "*Result Awaiting & Hope Certificate Policy:*\n" +
        "- Candidates awaiting their F.Sc. Part-II results are eligible to apply on the basis of their Part-I marks and a Hope Certificate issued by their college.\n" +
        "- You can take the University Entrance Test and be considered for provisional admission processing."
      );
    }

    // 14. Gap year policy
    if (
      q.includes('gap year') ||
      q.includes('gap') ||
      q.includes('saal zaya') ||
      q.includes('previous year')
    ) {
      return (
        "*Gap Year Policy at UAJK:*\n" +
        "- Candidates with a gap year after F.Sc. are fully eligible to apply.\n" +
        "- There is no penalty or mark deduction for gap years, provided you meet the minimum eligibility marks (60% for SE, 50% for SET/CET)."
      );
    }

    // 15. Form-B vs CNIC policy
    if (
      q.includes('form-b') ||
      q.includes('b-form') ||
      q.includes('bay form') ||
      q.includes('form b') ||
      q.includes('cnic nahi') ||
      q.includes('without cnic')
    ) {
      return (
        "*CNIC / Form-B Guidance:*\n" +
        "- If you have not yet received your CNIC from NADRA, your 13-digit Form-B (B-Form) number is fully valid for application registration and the Entry Test.\n" +
        "- Please bring your original Form-B or CNIC on test day for physical identity verification."
      );
    }

    // 16. Email requirement guidance
    if (
      q.includes('email nahi') ||
      q.includes('email zaruri') ||
      q.includes('without email') ||
      q.includes('email kion')
    ) {
      return (
        "*Email Requirement Guidance:*\n" +
        "- An active email address is needed to deliver your candidate admission notices, document links, and portal access credentials.\n" +
        "- If you don't have a personal email account, you can provide an active email belonging to your parent, guardian, or sibling."
      );
    }

    // 17. Accreditation & Recognition (PEC / NTC / HEC)
    if (
      q.includes('pec') ||
      q.includes('ntc') ||
      q.includes('accreditation') ||
      q.includes('accredited') ||
      q.includes('recognition')
    ) {
      return (
        "*Accreditation & Recognition:*\n" +
        "- *B.Sc. Software Engineering (SE):* Accredited by the Pakistan Engineering Council (PEC).\n" +
        "- *B.Sc. SET & CET:* Accredited by the National Technology Council (NTC).\n" +
        "- All programs are recognized by the Higher Education Commission (HEC) of Pakistan."
      );
    }

    // Default graceful response
    return (
      "Assalam-o-Alaikum! The Department of Software Engineering at UAJK (Chehla Campus, Muzaffarabad) is here to guide you with all admissions inquiries.\n\n" +
      "We offer PEC-accredited B.Sc. Software Engineering (60% min) and NTC-accredited SET & CET (50% min, Pre-Medical eligible).\n\n" +
      "For specific inquiries or details not fully covered here, our admissions desk is glad to assist you directly! Please feel free to ask another question or contact our Department Helpline at *+92-5822-960510* or email *se@uajk.edu.pk*."
    );
  }
}

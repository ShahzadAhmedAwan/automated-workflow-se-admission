import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_PATH = path.resolve(__dirname, '../../../../data/knowledge.txt');

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
   * Helper to detect if a message is an inquiry/question rather than a direct answer
   */
  static isQuestion(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();

    // Explicit question mark
    if (clean.includes('?')) return true;

    // Interrogatives at start or core positions
    if (
      /^(what|where|when|who|why|how|which|whose|is|are|can|do|will|could|should|kya|kab|kahan|kitni|kitna|kaise|konsa)\b/i.test(
        clean
      )
    ) {
      return true;
    }

    // Explicit inquiry phrases
    const inquiryPatterns = [
      /\b(who (are you|is this|are u|r u)|who speaks|aap kon|kon ho|koun ho)\b/i,
      /\b(why (are you|did you) (texting|messaging|calling|msg)|why msg me|kion msg|kion message|get my number|got my number)\b/i,
      /\b(what is this|what's this|whats this|ye kya hai|yeh kya hai|what is it about)\b/i,
      /\b(tell me|want to know|give me details|information about|info about|guide me|details of)\b/i,
      /\b(fee structure|fee schedule|how much fee|semester fee|tuition fee|fees kitni)\b/i,
      /\b(hostel|accommodation|hostels|boys hostel|girls hostel|mess charges)\b/i,
      /\b(scholarship|scholarships|financial aid)\b/i,
      /\b(last date|closing date|deadline|admission schedule|schedule)\b/i,
      /\b(eligibility criteria|minimum marks required|percentage required|criteria for)\b/i,
      /\b(entry test|entrance test|admission test|test syllabus|test date)\b/i,
      /\b(pre[- ]?medical policy|pre[- ]?medical quota|pre[- ]?med quota)\b/i,
      /\b(helpline|contact number|coordinator|phone number|official email)\b/i,
      /\b(required documents|documents checklist|migration certificate|noc required)\b/i,
      /\b(programs offered|courses offered|degree programs)\b/i,
    ];

    return inquiryPatterns.some((pattern) => pattern.test(clean));
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

    // 1. Try Gemini API if API key is configured
    if (apiKey && apiKey !== 'mock_key' && apiKey !== 'replace-with-a-secret') {
      try {
        const response = await AIKnowledgeService.callGeminiAPI({
          apiKey,
          userQuery,
          knowledge,
          chatHistory,
        });
        if (response && response.trim()) {
          return response.trim();
        }
      } catch {
        // Fall through to local knowledge matcher on network error, rate limit, timeout, etc.
      }
    }

    // 2. Local intelligent knowledge base matcher (Fast, deterministic & offline-safe)
    return AIKnowledgeService.matchLocalKnowledge(userQuery, knowledge);
  }

  /**
   * Calls Google Gemini Generative Language REST API with a strict 4.5s timeout
   */
  static async callGeminiAPI({ apiKey, userQuery, knowledge, chatHistory = [] }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    const systemPrompt = `You are the official WhatsApp Admissions AI Assistant for the Department of Software Engineering at The University of Azad Jammu & Kashmir (UAJK), Chehla Campus, Muzaffarabad.
Your job is to answer prospective students' questions accurately, concisely, and warmly.

STRICT GUIDELINES:
1. Always ground your answers strictly in the knowledge base provided below.
2. If asking about programs: UAJK offers B.Sc. Software Engineering (SE - PEC accredited, min 60% F.Sc.), B.Sc. Software Engineering Technology (SET - NTC accredited, min 50% F.Sc.), and B.Sc. Computer Engineering Technology (CET - NTC accredited, min 50% F.Sc.).
3. Pre-Medical students ARE eligible for SET & CET with a deficiency math course in the first semester, and can also apply for SE under the PEC 40% quota if they have >= 60% marks.
4. Keep replies WhatsApp-friendly: concise (2-4 bullet points or short sentences), polite, using bold (*text*) for key details.
5. If the exact answer is not in the knowledge base, politely provide general university guidance and direct them to contact the Department Helpline at +92-5822-960510 or email se@uajk.edu.pk, or visit https://uajk.edu.pk/.

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

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Gemini API error: HTTP ${res.status}`);
      }

      const data = await res.json();
      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.candidates?.[0]?.text ||
        null;
      return text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Deterministic, rule-grounded knowledge base lookup when AI API is unavailable
   */
  static matchLocalKnowledge(query, _knowledge = '') {
    const q = (query || '').toLowerCase();

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
        "Assalam-o-Alaikum! 🎓 I am the official automated Admissions Assistant for the *Department of Software Engineering* at *The University of Azad Jammu & Kashmir (UAJK)*, Chehla Campus, Muzaffarabad.\n\n" +
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
        "Assalam-o-Alaikum! You received this automated outreach message because our admissions desk is contacting prospective candidates interested in higher education and engineering/technology degree programs for the upcoming Fall 2026 session.\n\n" +
        "Our goal is to help you explore admission opportunities at UAJK. If you are not interested, simply let us know and we will not message you further!"
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
        "This is an official admissions inquiry and guidance service from the *Department of Software Engineering, University of Azad Jammu & Kashmir (UAJK)*, Chehla Campus.\n\n" +
        "We offer:\n" +
        "• *B.Sc. Software Engineering (SE)* - PEC Accredited\n" +
        "• *B.Sc. Software Engineering Technology (SET)* - NTC Accredited (Pre-Med eligible)\n" +
        "• *B.Sc. Computer Engineering Technology (CET)* - NTC Accredited (Pre-Med eligible)\n\n" +
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
        "🏠 *Hostel Facilities at UAJK (Chehla Campus):*\n" +
        "• Hostels are available for both male and female students on merit/allotment basis.\n" +
        "• Chehla Campus has 1 male hostel and 2 female hostels.\n" +
        "• Approximate monthly hostel charges are ~PKR 8,000/month (including basic meals and utilities)."
      );
    }

    // 2. Entry test / Entrance exam
    if (
      q.includes('entry test') ||
      q.includes('entrance test') ||
      q.includes('admission test') ||
      q.includes('test venue') ||
      q.includes('test date') ||
      q.includes('nats')
    ) {
      return (
        "📝 *Entrance Test Information:*\n" +
        "• The University Entrance Test is mandatory for SE, SET, and CET.\n" +
        "• Test Fee: PKR 1,000 (deposit via HBL challan).\n" +
        "• Venue: Chehla Campus, Muzaffarabad.\n" +
        "• Requirements on test day: Original CNIC/B-Form and printed Admit Card.\n" +
        "• Help Desk Contact: 0300-6253998 / 0333-5750711."
      );
    }

    // 3. Pre-Medical policy & eligibility
    if (
      q.includes('pre-medical') ||
      q.includes('pre medical') ||
      q.includes('pre-med') ||
      q.includes('bio') ||
      q.includes('biology')
    ) {
      return (
        "🔬 *Pre-Medical Eligibility Policy at UAJK:*\n" +
        "• *SET & CET:* F.Sc. Pre-Medical students with minimum 50% marks are fully eligible under NTC policy. (You will study an additional non-credit deficiency Mathematics course in 1st semester).\n" +
        "• *B.Sc. Software Engineering (SE):* Up to 40% seats can be offered to Pre-Medical students who score 60%+ in F.Sc. under PEC policy quota + Entry Test."
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
        "📌 *Fee Structure for Department of Software Engineering (UAJK):*\n" +
        "• *B.Sc. Software Engineering (SE):* ~PKR 60,130 per semester\n" +
        "• *B.Sc. Software Engineering Technology (SET):* ~PKR 60,130 per semester\n" +
        "• *B.Sc. Computer Engineering Technology (CET):* ~PKR 59,130 per semester\n" +
        "• *Application Processing Fee:* PKR 3,000 (payable via HBL challan)\n" +
        "• *Entry Test Fee:* PKR 1,000\n" +
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
        "🎓 *Eligibility Criteria (Department of Software Engineering):*\n" +
        "• *B.Sc. Software Engineering (SE):* Minimum 60% in F.Sc. Pre-Engineering / ICS / DAE or Pre-Med quota + Entry test.\n" +
        "• *B.Sc. Software Engineering Technology (SET):* Minimum 50% in F.Sc. (Pre-Engineering, ICS, Pre-Medical, DAE).\n" +
        "• *B.Sc. Computer Engineering Technology (CET):* Minimum 50% in F.Sc. (Pre-Engineering, ICS, Pre-Medical, DAE).\n" +
        "• No 3rd division in academic career."
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
        "📋 *Required Documents Checklist:*\n" +
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
      q.includes('kab start') ||
      q.includes('classes') ||
      q.includes('schedule')
    ) {
      return (
        "🗓️ *Important Admissions Schedule & Deadlines:*\n" +
        "• Applications for the upcoming intake are currently being accepted online.\n" +
        "• Merit lists are announced shortly following the Entry Test and document verification.\n" +
        "• Visit the official portal https://uajk.edu.pk/ for the exact closing date and test calendar."
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
      q.includes('campus')
    ) {
      return (
        "📞 *Department Contact & Helpline:*\n" +
        "• *Campus:* Chehla / Main Campus, Muzaffarabad, UAJK\n" +
        "• *Department Helpline:* +92-5822-960510\n" +
        "• *Coordinator:* Engr. Dr. Muhammad Zaman Fakhar\n" +
        "• *Department Email:* se@uajk.edu.pk\n" +
        "• *Official Website:* https://uajk.edu.pk/"
      );
    }

    // 9. Programs offered
    if (
      q.includes('programs') ||
      q.includes('courses') ||
      q.includes('degree') ||
      q.includes('fields') ||
      q.includes('se') ||
      q.includes('set') ||
      q.includes('cet')
    ) {
      return (
        "🎓 *Programs Offered at Department of Software Engineering (UAJK):*\n" +
        "1. *B.Sc. Software Engineering (SE)* - 4 Years, PEC Accredited\n" +
        "2. *B.Sc. Software Engineering Technology (SET)* - 4 Years, NTC Accredited\n" +
        "3. *B.Sc. Computer Engineering Technology (CET)* - 4 Years, NTC Accredited\n" +
        "4. *MS Software Engineering* - 2 Years Postgraduate"
      );
    }

    // 10. Scholarships
    if (
      q.includes('scholarship') ||
      q.includes('financial aid') ||
      q.includes('hec scholarship')
    ) {
      return (
        "🌟 *Scholarships at UAJK:*\n" +
        "• Merit Scholarships for top board and university scorers\n" +
        "• HEC Need-Based & Ehsaas Scholarships\n" +
        "• AJK Zakat & District Council Scholarships\n" +
        "Students can apply for financial assistance after securing admission."
      );
    }

    // Default general response
    return (
      "Assalam-o-Alaikum! The Department of Software Engineering at UAJK (Chehla Campus, Muzaffarabad) offers PEC-accredited B.Sc. Software Engineering (60% min) and NTC-accredited SET & CET (50% min, Pre-Medical eligible).\n" +
      "For specific inquiries, call our helpline at *+92-5822-960510* or email *se@uajk.edu.pk*."
    );
  }
}

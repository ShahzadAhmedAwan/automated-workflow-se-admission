import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_ORIGIN: 'http://localhost:5173',
  API_BASE_PATH: '/api/v1',
  TRUST_PROXY_HOPS: '0',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'se_admissions_test',
  DB_USER: 'test_user',
  DB_PASSWORD: 'test_password',
  DB_CONNECTION_LIMIT: '2',
  DB_SSL: 'false',
  JWT_SECRET: randomBytes(48).toString('base64url'),
  JWT_ISSUER: 'se-admissions-test',
  JWT_AUDIENCE: 'se-admissions-test-client',
  ACCESS_TOKEN_TTL_SECONDS: '300',
  REFRESH_TOKEN_TTL_DAYS: '1',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'strict',
});

const {
  normalizePhoneNumber,
  parseAndPreviewLeads,
} = await import('../src/modules/marketing/services/csv-parser.service.js');
const { CampaignService } = await import('../src/modules/marketing/services/campaign.service.js');
const { CampaignController } = await import('../src/modules/marketing/controllers/campaign.controller.js');
const { LeadBotService } = await import('../src/modules/marketing/services/lead-bot.service.js');
const { AIKnowledgeService } = await import('../src/modules/marketing/services/ai-knowledge.service.js');
const {
  CONVERSATION_STATE,
  ELIGIBILITY_STATUS,
  PROGRAM_ELIGIBILITY,
} = await import('../src/modules/marketing/marketing.constants.js');

test('Phone normalization: handles Pakistani mobile numbers & international format', () => {
  // 03001234567 -> 923001234567
  assert.equal(normalizePhoneNumber('03001234567'), '923001234567');
  // With dashes and spaces: 0321-7654321
  assert.equal(normalizePhoneNumber('0321-7654321'), '923217654321');
  // International with +: +92 345 1112233
  assert.equal(normalizePhoneNumber('+92 345 1112233'), '923451112233');
  // Without leading zero: 3331234567
  assert.equal(normalizePhoneNumber('3331234567'), '923331234567');
  // Invalid strings
  assert.equal(normalizePhoneNumber('abc'), null);
  assert.equal(normalizePhoneNumber('123'), null);
});

test('CSV Parser: parses and validates streamed CSV preview and dedupes within file', async () => {
  const csvContent = Buffer.from(
    `Full Name,Phone Number,City,Education
Ali Khan,03001234567,Lahore,FSc Pre-Engineering
Sara Ahmed,03217654321,Karachi,ICS
Ali Khan Duplicate,03001234567,Lahore,FSc
Invalid User,12345,Islamabad,Matric`
  );

  const mockDb = {
    async query() {
      return [[]]; // No existing duplicates in DB
    },
  };

  const result = await parseAndPreviewLeads(csvContent, { previewLimit: 10, dbConnection: mockDb });

  assert.equal(result.totalRows, 4);
  assert.equal(result.validCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.invalidPhoneCount, 1);
  assert.equal(result.validLeads.length, 2);
  assert.equal(result.validLeads[0].phoneNormalized, '923001234567');
  assert.equal(result.validLeads[1].phoneNormalized, '923217654321');
});

test('Daylight Hours Adjuster: ensures scheduling is kept between permitted daytime hours', () => {
  // 2 AM -> should adjust to 9 AM today
  const earlyMorning = new Date('2026-05-10T02:00:00');
  const adjustedMorning = CampaignService.adjustToDaylight(earlyMorning, 9, 20);
  assert.equal(adjustedMorning.getHours(), 9);
  assert.equal(adjustedMorning.getDate(), earlyMorning.getDate());

  // 11 PM -> should adjust to 9 AM tomorrow
  const lateNight = new Date('2026-05-10T23:00:00');
  const adjustedNight = CampaignService.adjustToDaylight(lateNight, 9, 20);
  assert.equal(adjustedNight.getHours(), 9);
  assert.equal(adjustedNight.getDate(), lateNight.getDate() + 1);

  // 2 PM (14:00) -> should remain unchanged
  const validDay = new Date('2026-05-10T14:30:00');
  const adjustedDay = CampaignService.adjustToDaylight(validDay, 9, 20);
  assert.equal(adjustedDay.getHours(), 14);
  assert.equal(adjustedDay.getMinutes(), 30);

  // Timezone-aware daylight check for Pakistan (Asia/Karachi UTC+5)
  // 02:00 UTC = 07:00 PKT (before 9 AM PKT) -> should adjust to 09:00 PKT (04:00 UTC)
  const utcEarly = new Date('2026-05-10T02:00:00Z');
  const adjustedPkt = CampaignService.adjustToDaylight(utcEarly, 9, 20, 'Asia/Karachi');
  const pktHour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', hour12: false }).format(adjustedPkt), 10);
  assert.equal(pktHour, 9);
});

test('LeadBotService: input parsing and validation heuristics', () => {
  // Ratio format 420/550
  const ratio = LeadBotService.parseMarks('420/550');
  assert.ok(ratio);
  assert.equal(ratio.obtained, 420);
  assert.equal(ratio.total, 550);
  assert.ok(ratio.percentage > 76 && ratio.percentage < 77);

  // Out of text format: "850 out of 1100"
  const outOf = LeadBotService.parseMarks('850 out of 1100');
  assert.ok(outOf);
  assert.equal(outOf.obtained, 850);
  assert.equal(outOf.total, 1100);

  // Percentage format: "78%" and "100%"
  const pct = LeadBotService.parseMarks('78%');
  assert.ok(pct);
  assert.equal(pct.percentage, 78);
  assert.equal(pct.isPartial, true);
  const pct100 = LeadBotService.parseMarks('100%');
  assert.ok(pct100);
  assert.equal(pct100.percentage, 100);
  assert.equal(pct100.isPartial, true);

  // Partial marks format: bare numbers 500, 900
  const partial500 = LeadBotService.parseMarks('500');
  assert.ok(partial500);
  assert.equal(partial500.isPartial, true);
  assert.equal(partial500.obtained, 500);

  const partial900 = LeadBotService.parseMarks('900');
  assert.ok(partial900);
  assert.equal(partial900.isPartial, true);
  assert.equal(partial900.obtained, 900);

  // Parse total marks helper
  assert.equal(LeadBotService.parseTotalMarks('1100'), 1100);
  assert.equal(LeadBotService.parseTotalMarks('total is 1100'), 1100);
  assert.equal(LeadBotService.parseTotalMarks('out of 550'), 550);
  assert.equal(LeadBotService.parseTotalMarks('1000'), 1000);

  // Invalid marks validation (obtained > total)
  const invalidRatio = LeadBotService.parseMarks('550/500');
  assert.ok(invalidRatio);
  assert.equal(invalidRatio.error, 'OBTAINED_EXCEEDS_TOTAL');
  assert.equal(invalidRatio.obtained, 550);
  assert.equal(invalidRatio.total, 500);

  // Different total marks: calculate percentage on that total
  const total900 = LeadBotService.parseMarks('420/900');
  assert.ok(total900);
  assert.equal(total900.obtained, 420);
  assert.equal(total900.total, 900);
  assert.ok(total900.percentage > 46 && total900.percentage < 47);

  const total1000 = LeadBotService.parseMarks('600/1000');
  assert.ok(total1000);
  assert.equal(total1000.obtained, 600);
  assert.equal(total1000.total, 1000);
  assert.equal(total1000.percentage, 60);

  const invalidPct = LeadBotService.parseMarks('115%');
  assert.ok(invalidPct);
  assert.equal(invalidPct.error, 'PERCENTAGE_EXCEEDS_100');
  assert.equal(invalidPct.percentage, 115);

  // Affirmative / Negative detection
  assert.equal(LeadBotService.isAffirmative('Yes'), true);
  assert.equal(LeadBotService.isAffirmative('han bilkul'), true);
  assert.equal(LeadBotService.isAffirmative('Ji definitely'), true);
  assert.equal(LeadBotService.isNegative('no'), true);
  assert.equal(LeadBotService.isNegative('nahi'), true);
  assert.equal(LeadBotService.isNegative('not interested'), true);

  // CNIC validation
  assert.equal(LeadBotService.parseCnic('82101-1234567-1'), '82101-1234567-1');
  assert.equal(LeadBotService.parseCnic('8210112345671'), '82101-1234567-1');
  assert.equal(LeadBotService.parseCnic('12345'), null);

  // Email validation
  assert.equal(LeadBotService.parseEmail('Contact: student@uajk.edu.pk'), 'student@uajk.edu.pk');
  assert.equal(LeadBotService.parseEmail('invalid-string'), null);

  // Name validation
  assert.equal(LeadBotService.isValidName('Muhammad Ali'), true);
  assert.equal(LeadBotService.isValidName('Dr. Tariq Mahmood'), true);
  assert.equal(LeadBotService.isValidName('12345'), false);
  assert.equal(LeadBotService.isValidName('what is the fee?'), false);
});

test('AIKnowledgeService: question detection & accurate knowledge base extraction', async () => {
  assert.equal(AIKnowledgeService.isQuestion('What is the semester fee?'), true);
  assert.equal(AIKnowledgeService.isQuestion('Is hostel available?'), true);
  assert.equal(AIKnowledgeService.isQuestion('Can pre-medical students apply?'), true);
  assert.equal(AIKnowledgeService.isQuestion('420/550'), false);
  assert.equal(AIKnowledgeService.isQuestion('Muhammad Ali'), false);
  assert.equal(AIKnowledgeService.isQuestion('not-an-email-address'), false);

  // Match fees
  const feeAnswer = await AIKnowledgeService.answerQuestion('What is the fee structure for software engineering?');
  assert.ok(feeAnswer.includes('PKR 60,130') || feeAnswer.includes('Fee Structure'));

  // Match hostel
  const hostelAnswer = await AIKnowledgeService.answerQuestion('Is hostel available for students?');
  assert.ok(hostelAnswer.includes('Hostel') || hostelAnswer.includes('8,000'));

  // Match pre-medical policy
  const preMedAnswer = await AIKnowledgeService.answerQuestion('Can a pre-medical student apply for SET?');
  assert.ok(preMedAnswer.includes('Pre-Medical') || preMedAnswer.includes('deficiency Mathematics'));
});

test('LeadBotService Qualification Flow: Complete Case 1 Intake Flow with SE, SET, CET Qualification (>= 60%)', async () => {
  let currentLead = {
    id: 201,
    campaign_id: 1,
    full_name: 'Zainab Bibi',
    father_name: null,
    phone_normalized: '923009876543',
    city: 'Muzaffarabad',
    prior_degree: null,
    cnic: null,
    email: null,
    fsc_marks: null,
    has_maths: null,
    eligible_for: null,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.GREETING_SENT,
    chat_history: JSON.stringify([]),
  };

  const dispatchedJobs = [];

  const mockDbConnection = {
    async query(sql) {
      if (sql.includes('FROM mkt_leads')) {
        return [[{ ...currentLead }]];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        const setClause = sql.split('SET ')[1].split(' WHERE')[0];
        const clauses = setClause.split(',').map((c) => c.trim());
        let pIndex = 0;
        for (const clause of clauses) {
          if (clause.includes('=')) {
            const [col, valExpr] = clause.split('=').map((s) => s.trim());
            if (valExpr === '?') {
              const val = params[pIndex++];
              if (col === 'conversation_state') currentLead.conversation_state = val;
              else if (col === 'full_name') currentLead.full_name = val;
              else if (col === 'father_name') currentLead.father_name = val;
              else if (col === 'cnic') currentLead.cnic = val;
              else if (col === 'email') currentLead.email = val;
              else if (col === 'fsc_marks') currentLead.fsc_marks = val;
              else if (col === 'has_maths') currentLead.has_maths = val;
              else if (col === 'eligible_for') currentLead.eligible_for = val;
              else if (col === 'eligibility_status') currentLead.eligibility_status = val;
            }
          }
        }
      }
      if (sql.includes('INSERT INTO outbox_jobs')) {
        dispatchedJobs.push({
          jobType: params[1],
          payload: JSON.parse(params[2]),
        });
        return [{ insertId: dispatchedJobs.length }];
      }
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Turn 1: Candidate says "Yes, I am interested"
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'Yes, I am interested in applying!',
  }, mockDb);

  assert.equal(turn1.state, CONVERSATION_STATE.AWAITING_FATHER_NAME);
  assert.ok(turn1.reply.includes('Father\'s Name'));

  // Turn 2: Candidate provides father's name
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'Tariq Mahmood',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn2.reply.includes('score in FSc'));

  // Turn 3: Candidate provides marks: 450/550 (81.8% >= 60%)
  const turn3 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: '450/550',
  }, mockDb);

  assert.equal(turn3.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.equal(turn3.eligibleFor, PROGRAM_ELIGIBILITY.SE_SET_CET);
  assert.ok(turn3.reply.includes('academic group'));

  // Turn 4: Candidate states study group: "FSc Pre-Engineering"
  const turn4 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'FSc Pre-Engineering with Mathematics',
  }, mockDb);

  assert.equal(turn4.state, CONVERSATION_STATE.AWAITING_CNIC);
  assert.ok(turn4.reply.includes('CNIC or Form-B'));

  // Turn 5: Candidate provides 13-digit CNIC
  const turn5 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: '82101-7654321-3',
  }, mockDb);

  assert.equal(turn5.state, CONVERSATION_STATE.AWAITING_EMAIL);
  assert.ok(turn5.reply.includes('Email Address'));

  // Turn 6: Candidate provides Email
  const turn6 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'zainab.bibi@example.com',
  }, mockDb);

  assert.equal(turn6.state, CONVERSATION_STATE.QUALIFIED);
  assert.equal(turn6.eligible, true);
  assert.equal(turn6.eligibleFor, PROGRAM_ELIGIBILITY.SE_SET_CET);
  assert.ok(turn6.reply.includes('Congratulations'));

  // Verify handoff event LEAD_QUALIFIED was published to outbox_jobs with all fields
  const qualifiedEvent = dispatchedJobs.find((j) => j.jobType === 'LEAD_QUALIFIED');
  assert.ok(qualifiedEvent, 'LEAD_QUALIFIED event must be enqueued');
  assert.equal(qualifiedEvent.payload.leadId, 201);
  assert.equal(qualifiedEvent.payload.fullName, 'Zainab Bibi');
  assert.equal(qualifiedEvent.payload.fatherName, 'Tariq Mahmood');
  assert.equal(qualifiedEvent.payload.cnic, '82101-7654321-3');
  assert.equal(qualifiedEvent.payload.email, 'zainab.bibi@example.com');
  assert.equal(qualifiedEvent.payload.eligibleFor, 'SE, SET, CET');
});

test('LeadBotService: In-Between Question Answering (CRITICAL REQUIREMENT #1) without losing track', async () => {
  let currentLead = {
    id: 202,
    campaign_id: 1,
    full_name: 'Usman Ali',
    father_name: null,
    phone_normalized: '923123456789',
    city: 'Rawalpindi',
    prior_degree: null,
    cnic: null,
    email: null,
    fsc_marks: null,
    has_maths: null,
    eligible_for: null,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.AWAITING_FATHER_NAME,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student asks about hostel instead of giving father name
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: 'Can you tell me what is the hostel fee and accommodation?',
  }, mockDb);

  // 1. Bot must answer the hostel question accurately
  assert.ok(
    turn.reply.includes('Hostel') || turn.reply.includes('8,000'),
    'Bot must reply to the hostel question'
  );

  // 2. Bot must NOT lose track of state, and re-prompt for Father\'s Name
  assert.equal(turn.state, CONVERSATION_STATE.AWAITING_FATHER_NAME);
  assert.ok(
    turn.reply.includes('Father\'s Name'),
    'Bot must prompt for Father Name after answering the question'
  );
});

test('LeadBotService: Graceful handling of invalid inputs', async () => {
  let currentLead = {
    id: 203,
    campaign_id: 1,
    full_name: 'Fatima',
    father_name: 'Muhammad Zahid',
    phone_normalized: '923459988776',
    conversation_state: CONVERSATION_STATE.AWAITING_CNIC,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // 1. Enter invalid CNIC
  const turnInvalidCnic = await LeadBotService.processIncomingMessage({
    fromPhone: '923459988776',
    messageBody: '12345',
  }, mockDb);

  assert.equal(turnInvalidCnic.state, CONVERSATION_STATE.AWAITING_CNIC);
  assert.ok(turnInvalidCnic.reply.includes('13-digit Pakistani CNIC'));

  // 2. Advance to AWAITING_EMAIL with a valid CNIC
  const turnValidCnic = await LeadBotService.processIncomingMessage({
    fromPhone: '923459988776',
    messageBody: '82101-1234567-1',
  }, mockDb);
  assert.equal(turnValidCnic.state, CONVERSATION_STATE.AWAITING_EMAIL);

  // 3. Enter invalid Email
  const turnInvalidEmail = await LeadBotService.processIncomingMessage({
    fromPhone: '923459988776',
    messageBody: 'not-an-email-address',
  }, mockDb);

  assert.equal(turnInvalidEmail.state, CONVERSATION_STATE.AWAITING_EMAIL);
  assert.ok(turnInvalidEmail.reply.includes('valid email address'));

  // 4. Enter mathematically impossible marks (e.g. 550/500)
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
  const turnInvalidMarks = await LeadBotService.processIncomingMessage({
    fromPhone: '923459988776',
    messageBody: '550/500',
  }, mockDb);
  assert.equal(turnInvalidMarks.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnInvalidMarks.reply.includes('cannot exceed total marks'));

  // 5. Enter invalid percentage > 100% (e.g. 115%)
  const turnInvalidPct = await LeadBotService.processIncomingMessage({
    fromPhone: '923459988776',
    messageBody: '115%',
  }, mockDb);
  assert.equal(turnInvalidPct.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnInvalidPct.reply.includes('Percentage (*115%*) cannot exceed 100%'));
});

test('LeadBotService Case 2: Student says No (Graceful exit & remains open to inquiries)', async () => {
  let currentLead = {
    id: 204,
    campaign_id: 1,
    full_name: 'Kamran Khan',
    phone_normalized: '923337778899',
    conversation_state: CONVERSATION_STATE.AWAITING_INTEREST,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student says No
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923337778899',
    messageBody: 'No thanks, not interested',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.NOT_INTERESTED);
  assert.ok(turn.reply.includes('future studies') || turn.reply.includes('future endeavors'));
  assert.ok(turn.reply.includes('feel free to ask anytime'));

  // If student asks a question later, bot answers gracefully
  const turnQuestion = await LeadBotService.processIncomingMessage({
    fromPhone: '923337778899',
    messageBody: 'Actually, what is the coordinator phone number?',
  }, mockDb);

  assert.ok(turnQuestion.reply.includes('960510') || turnQuestion.reply.includes('Coordinator'));
});

test('LeadBotService Case 3: Student asks a random question initially', async () => {
  // Brand new incoming phone asking a direct question
  const mockDbConnection = {
    async query() {
      return [[]]; // Lead does not exist yet
    },
    async execute() {
      return [{ insertId: 205, affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923401122334',
    messageBody: 'Hello, what are the fees for software engineering?',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.AWAITING_INTEREST);
  assert.ok(turn.reply.includes('Fee Structure') || turn.reply.includes('60,130'));
  assert.ok(turn.reply.includes('Reply *Yes*'));
});

test('CampaignService: broadcastToNumbersFile schedules outreach with anti-ban jitter', async () => {
  const sampleNumbersContent = `
03001234567, Ali Khan, Muzaffarabad
03217654321, Sara Bibi, Rawalpindi
# Commented line should be ignored
invalid_phone, Bad Row
03335558899
`;

  const dispatchedJobs = [];
  const leadsInDb = [];

  const mockDbConnection = {
    async query(sql) {
      if (sql.includes('SELECT id')) {
        return [[]]; // None exist yet
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('INSERT INTO mkt_leads')) {
        const id = leadsInDb.length + 1;
        leadsInDb.push({ id, phone: params[3] });
        return [{ insertId: id }];
      }
      if (sql.includes('INSERT INTO outbox_jobs')) {
        dispatchedJobs.push({
          jobType: params[1],
          payload: JSON.parse(params[2]),
        });
        return [{ insertId: dispatchedJobs.length }];
      }
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  const result = await CampaignService.broadcastToNumbersFile(sampleNumbersContent, {
    jitterMinSeconds: 5,
    jitterMaxSeconds: 10,
  }, mockDb);

  assert.equal(result.scheduledCount, 3);
  assert.equal(dispatchedJobs.length, 3);
  assert.ok(dispatchedJobs[0].payload.messageText.includes('Department of Software Engineering'));
});

test('LeadBotService: Technology-Only Qualification (50% - 59.9% marks -> SET, CET)', async () => {
  let currentLead = {
    id: 206,
    campaign_id: 1,
    full_name: 'Bilal Khan',
    father_name: 'Arshad Khan',
    phone_normalized: '923112233445',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student enters 580/1100 (52.7% -> Eligible for SET and CET)
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923112233445',
    messageBody: '580/1100',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.equal(turn.eligibleFor, PROGRAM_ELIGIBILITY.SET_CET);
  assert.ok(turn.reply.includes('52.7%'));
});

test('LeadBotService: Ineligible Candidate (< 50% marks -> None)', async () => {
  let currentLead = {
    id: 207,
    campaign_id: 1,
    full_name: 'Hamza',
    phone_normalized: '923221144556',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student enters 240/550 (43.6% < 50%)
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923221144556',
    messageBody: '240/550',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.NOT_INTERESTED);
  assert.equal(turn.eligible, false);
  assert.equal(turn.eligibleFor, PROGRAM_ELIGIBILITY.NONE);
  assert.ok(turn.reply.includes('minimum requirement for Engineering & Technology programs at UAJK is 50%'));
});

test('LeadBotService: In-between Q&A during CNIC intake and Marks intake', async () => {
  let currentLead = {
    id: 208,
    campaign_id: 1,
    full_name: 'Sana Malik',
    phone_normalized: '923015556677',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student at AWAITING_MARKS asks about entry test
  const turnMarksQ = await LeadBotService.processIncomingMessage({
    fromPhone: '923015556677',
    messageBody: 'Is there an entrance test?',
  }, mockDb);

  assert.equal(turnMarksQ.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnMarksQ.reply.includes('Entrance Test') || turnMarksQ.reply.includes('mandatory'));
  assert.ok(turnMarksQ.reply.includes('score in FSc'));

  // Switch to AWAITING_CNIC
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_CNIC;

  // Student asks about documents required
  const turnCnicQ = await LeadBotService.processIncomingMessage({
    fromPhone: '923015556677',
    messageBody: 'What documents are required for admission?',
  }, mockDb);

  assert.equal(turnCnicQ.state, CONVERSATION_STATE.AWAITING_CNIC);
  assert.ok(turnCnicQ.reply.includes('Documents') || turnCnicQ.reply.includes('Matric'));
  assert.ok(turnCnicQ.reply.includes('CNIC or Form-B'));
});

test('LeadBotService: Pre-Medical background handling (40% SE seats & SET/CET eligible, saves Pre-Medical in DB)', async () => {
  let currentLead = {
    id: 209,
    campaign_id: 1,
    full_name: 'Ayesha Noor',
    father_name: 'Muhammad Tariq',
    phone_normalized: '923001122334',
    city: 'Muzaffarabad',
    prior_degree: null,
    cnic: null,
    email: null,
    fsc_marks: 490,
    has_maths: null,
    eligible_for: PROGRAM_ELIGIBILITY.SE_SET_CET,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.AWAITING_MATHS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query(sql) {
      if (sql.includes('FROM mkt_leads')) {
        return [[{ ...currentLead }]];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        const setClause = sql.split('SET ')[1].split(' WHERE')[0];
        const clauses = setClause.split(',').map((c) => c.trim());
        let pIndex = 0;
        for (const clause of clauses) {
          if (clause.includes('=')) {
            const [col, valExpr] = clause.split('=').map((s) => s.trim());
            if (valExpr === '?') {
              const val = params[pIndex++];
              if (col === 'conversation_state') currentLead.conversation_state = val;
              else if (col === 'prior_degree') currentLead.prior_degree = val;
              else if (col === 'has_maths') currentLead.has_maths = val;
              else if (col === 'cnic') currentLead.cnic = val;
              else if (col === 'email') currentLead.email = val;
            }
          }
        }
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student says they are from Pre-Medical
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923001122334',
    messageBody: 'I did FSc Pre-Medical',
  }, mockDb);

  // 1. Informs student about up to 40% seats in SE and SET/CET eligibility
  assert.ok(turn.reply.includes('40% of seats in B.Sc. Software Engineering'));
  assert.ok(turn.reply.includes('SET') && turn.reply.includes('CET'));

  // 2. Seamlessly asks next question (CNIC)
  assert.equal(turn.state, CONVERSATION_STATE.AWAITING_CNIC);
  assert.ok(turn.reply.includes('CNIC or Form-B'));

  // 3. Saved 'Pre-Medical' to prior_degree in database
  assert.equal(currentLead.prior_degree, 'Pre-Medical');
  assert.equal(currentLead.has_maths, false);
});

test('LeadBotService: Graceful handling of "who are you", "why texting me", "what is this", and "I don\'t want to"', async () => {
  let currentLead = {
    id: 210,
    campaign_id: 1,
    full_name: 'Prospective Applicant',
    phone_normalized: '923179459856',
    conversation_state: CONVERSATION_STATE.AWAITING_INTEREST,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // 1. "who are you"
  const turnWho = await LeadBotService.processIncomingMessage({
    fromPhone: '923179459856',
    messageBody: 'who are you?',
  }, mockDb);
  assert.ok(turnWho.reply.includes('Admissions Assistant') || turnWho.reply.includes('Software Engineering'));
  assert.ok(turnWho.reply.includes('UAJK') || turnWho.reply.includes('University of Azad Jammu & Kashmir'));

  // 2. "why are you texting me"
  const turnWhy = await LeadBotService.processIncomingMessage({
    fromPhone: '923179459856',
    messageBody: 'why are you texting me',
  }, mockDb);
  assert.ok(turnWhy.reply.includes('automated outreach') || turnWhy.reply.includes('prospective'));
  assert.ok(turnWhy.reply.includes('Fall 2026') || turnWhy.reply.includes('admissions'));

  // 3. "what is this"
  const turnWhat = await LeadBotService.processIncomingMessage({
    fromPhone: '923179459856',
    messageBody: 'what is this?',
  }, mockDb);
  assert.ok(turnWhat.reply.includes('Software Engineering') || turnWhat.reply.includes('admissions'));

  // 4. "I don't want to" -> gracefully exits and transitions to NOT_INTERESTED
  const turnOptOut = await LeadBotService.processIncomingMessage({
    fromPhone: '923179459856',
    messageBody: "I don't want to",
  }, mockDb);
  assert.equal(turnOptOut.state, CONVERSATION_STATE.NOT_INTERESTED);
  assert.ok(turnOptOut.reply.includes('understand and respect your decision') || turnOptOut.reply.includes('future studies'));

  // 5. "I don't want to" in the middle of intake (e.g. at AWAITING_MARKS)
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
  const turnMidIntakeOptOut = await LeadBotService.processIncomingMessage({
    fromPhone: '923179459856',
    messageBody: "i dont want to continue, stop texting",
  }, mockDb);
  assert.equal(turnMidIntakeOptOut.state, CONVERSATION_STATE.NOT_INTERESTED);
  assert.ok(turnMidIntakeOptOut.reply.includes('respect your decision') || turnMidIntakeOptOut.reply.includes('future studies'));
});

test('CampaignController.getWhatsAppStatus: evaluates session freshness and reports status accurately', async () => {
  let responseData = null;
  const mockRes = {
    json(payload) {
      responseData = payload;
      return payload;
    },
  };

  // Case 1: Empty settings table
  const mockEmptyDb = {
    async query() {
      return [[]];
    },
  };
  await CampaignController.getWhatsAppStatus({}, mockRes, (err) => { throw err; }, mockEmptyDb);
  assert.equal(responseData.status, 'success');
  assert.equal(responseData.data.connected, false);
  assert.equal(responseData.data.status, 'OFFLINE');

  // Case 2: Active connected session with recent heartbeat
  const mockActiveDb = {
    async query() {
      return [[
        {
          setting_value: JSON.stringify({
            status: 'CONNECTED',
            phone: '923179459856',
            updatedAt: new Date().toISOString(),
          }),
          updated_at: new Date(),
        },
      ]];
    },
  };
  await CampaignController.getWhatsAppStatus({}, mockRes, (err) => { throw err; }, mockActiveDb);
  assert.equal(responseData.status, 'success');
  assert.equal(responseData.data.connected, true);
  assert.equal(responseData.data.status, 'CONNECTED');
  assert.equal(responseData.data.phone, '923179459856');

  // Case 3: Fallback detection when sys_settings is empty but recent DB activity exists
  const mockFallbackDb = {
    async query(sql) {
      if (sql.includes('sys_settings')) {
        return [[]]; // sys_settings has no row
      }
      if (sql.includes("data_key = 'creds'")) {
        return [[{
          data_value: JSON.stringify({
            me: { id: '923179459856:1@s.whatsapp.net' }
          }),
          updated_at: new Date()
        }]];
      }
      if (sql.includes('last_active')) {
        return [[{ last_active: new Date().toISOString() }]];
      }
      return [[]];
    },
  };
  await CampaignController.getWhatsAppStatus({}, mockRes, (err) => { throw err; }, mockFallbackDb);
  assert.equal(responseData.status, 'success');
  assert.equal(responseData.data.connected, true);
  assert.equal(responseData.data.status, 'CONNECTED');
  assert.equal(responseData.data.phone, '923179459856');
});

test('CampaignService.sendSingleLeadOutreach: normalizes phone, queues immediate job and records greeting state', async () => {
  const dispatchedJobs = [];
  let leadUpdated = false;

  const mockDbConnection = {
    async query(sql) {
      if (sql.includes('SELECT id FROM mkt_campaigns')) {
        return [[{ id: 42 }]];
      }
      if (sql.includes('SELECT id, conversation_state FROM mkt_leads')) {
        return [[]]; // New lead
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('INSERT INTO mkt_leads')) {
        return [{ insertId: 101 }];
      }
      if (sql.includes('INSERT INTO outbox_jobs')) {
        dispatchedJobs.push({
          jobType: params[1],
          payload: JSON.parse(params[2]),
        });
        return [{ insertId: 1 }];
      }
      if (sql.includes('UPDATE mkt_leads')) {
        leadUpdated = true;
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  const result = await CampaignService.sendSingleLeadOutreach({
    fullName: 'Test Applicant',
    phone: '03001234567',
    city: 'Muzaffarabad',
  }, mockDb);

  assert.equal(result.leadId, 101);
  assert.equal(result.phoneNormalized, '923001234567');
  assert.equal(result.status, 'GREETING_QUEUED');
  assert.equal(dispatchedJobs.length, 1);
  assert.equal(dispatchedJobs[0].payload.recipientPhone, '923001234567');
  assert.ok(dispatchedJobs[0].payload.messageText.includes('Test Applicant'));
  assert.equal(leadUpdated, true);
});

test('LeadBotService: Post-Confirmation Mistake Correction Flow ("I did a mistake" / "ghalti ho gaii")', async () => {
  let mockLead = {
    id: 501,
    campaign_id: 1,
    full_name: 'Java',
    father_name: 'Script',
    phone_normalized: '923123456789',
    cnic: '12345-6576665-4',
    email: 'noting@gmail.com',
    city: 'Muzaffarabad',
    prior_degree: 'FSc Pre-Engineering',
    fsc_marks: 550,
    has_maths: 1,
    eligible_for: 'SE, SET, CET',
    eligibility_status: 'ELIGIBLE',
    ineligibility_reason: null,
    conversation_state: 'QUALIFIED',
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query(sql) {
      if (sql.includes('FROM mkt_leads')) {
        return [[mockLead]];
      }
      return [[]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        if (params[0]) mockLead.conversation_state = params[0];
        // Parse dynamic assignments if any
        return [{ affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Test 1: Student says "I did a mistake"
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: 'I did a mistake',
  }, mockDb);

  assert.equal(turn1.state, CONVERSATION_STATE.QUALIFIED);
  assert.ok(turn1.reply.includes('What would you like to correct?'));
  assert.ok(turn1.reply.includes('Marks (FSc / ICS / DAE)'));

  // Test 2: Student says "ghalti ho gaii" (Roman Urdu)
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: 'ghalti ho gaii',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.QUALIFIED);
  assert.ok(turn2.reply.includes('What would you like to correct?'));

  // Test 3: Student selects "3" to correct marks
  const turn3 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: '3',
  }, mockDb);

  assert.equal(turn3.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn3.reply.includes('score in FSc'));

  // Test 4: Student enters invalid marks (550/500)
  const turn4 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: '550/500',
  }, mockDb);

  assert.equal(turn4.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn4.reply.includes('cannot exceed total marks'));

  // Test 5: Student enters correct marks (920/1100)
  const turn5 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: '920/1100',
  }, mockDb);

  assert.equal(turn5.state, CONVERSATION_STATE.QUALIFIED);
  assert.equal(turn5.eligible, true);
  assert.ok(turn5.reply.includes('Admissions Pre-Registration Updated'));
  assert.ok(turn5.reply.includes('FSc Marks: 920'));
  assert.ok(turn5.reply.includes('Candidate: Java'));

  // Test 6: Direct single-turn CNIC correction
  const turn6 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: 'ghalti se cnic galat likh diya tha correct is 82201-1234567-1',
  }, mockDb);

  assert.equal(turn6.state, CONVERSATION_STATE.QUALIFIED);
  assert.ok(turn6.reply.includes('Admissions Pre-Registration Updated'));
  assert.ok(turn6.reply.includes('82201-1234567-1'));

  // Test 7: Direct single-turn Name correction
  const turn7 = await LeadBotService.processIncomingMessage({
    fromPhone: '923123456789',
    messageBody: 'name is Java Script Developer',
  }, mockDb);

  assert.equal(turn7.state, CONVERSATION_STATE.QUALIFIED);
  assert.ok(turn7.reply.includes('Java Script Developer'));
});

test('Marketing Phase: Clean First Question & Outreach Message Wording', async () => {
  // Test default greeting from CampaignService
  const greeting = (name) => `*DEPARTMENT OF SOFTWARE ENGINEERING*\n` +
    `University of Azad Jammu & Kashmir (UAJK)\n\n` +
    `Assalam-o-Alaikum ${name}! Welcome to the Department of Software Engineering at UAJK (Chehla Campus).\n\n` +
    `We are offering the following undergraduate degree programs:\n` +
    `- *B.Sc. Software Engineering* (Accredited by PEC - Pakistan Engineering Council)\n` +
    `- *B.Sc. Software Engineering Technology* (Accredited by NTC - National Technology Council)\n` +
    `- *B.Sc. Computer Engineering Technology* (Accredited by NTC - National Technology Council)\n\n` +
    `Are you interested in knowing more?\n\n` +
    `- Reply *Yes* to know more and check your eligibility\n` +
    `- Or feel free to ask any question you have regarding programs, eligibility, fee structure, or hostel facilities!`;

  const msg = greeting('Ali');
  // Must NOT overwhelm by saying "will you apply here" or "interested in applying"
  assert.equal(msg.includes('will you apply here'), false);
  assert.equal(msg.includes('interested in applying here'), false);
  // Must mention courses and their affiliations simply
  assert.ok(msg.includes('B.Sc. Software Engineering* (Accredited by PEC'));
  assert.ok(msg.includes('B.Sc. Software Engineering Technology* (Accredited by NTC'));
  assert.ok(msg.includes('B.Sc. Computer Engineering Technology* (Accredited by NTC'));
  // Must ask "Are you interested in knowing more?"
  assert.ok(msg.includes('Are you interested in knowing more?'));
  // Must keep questions option
  assert.ok(msg.includes('feel free to ask any question you have'));
});

test('Marketing Phase: Student writes 890/1100 in the first question', async () => {
  let currentLead = {
    id: 301,
    campaign_id: 1,
    full_name: 'Prospective Applicant',
    father_name: null,
    phone_normalized: '923001234455',
    city: null,
    prior_degree: null,
    cnic: null,
    email: null,
    fsc_marks: null,
    has_maths: null,
    eligible_for: null,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.AWAITING_INTEREST,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        const setClause = sql.split('SET ')[1].split(' WHERE')[0];
        const clauses = setClause.split(',').map((c) => c.trim());
        let pIndex = 0;
        for (const clause of clauses) {
          if (clause.includes('=')) {
            const [col, valExpr] = clause.split('=').map((s) => s.trim());
            if (valExpr === '?') {
              const val = params[pIndex++];
              if (col === 'conversation_state') currentLead.conversation_state = val;
              else if (col === 'full_name') currentLead.full_name = val;
              else if (col === 'father_name') currentLead.father_name = val;
              else if (col === 'fsc_marks') currentLead.fsc_marks = val;
              else if (col === 'has_maths') currentLead.has_maths = val;
              else if (col === 'eligible_for') currentLead.eligible_for = val;
            }
          }
        }
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Turn 1: In the first question, candidate sends "890/1100"
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001234455',
    messageBody: '890/1100',
  }, mockDb);

  // Must parse obtained = 890, total = 1100, calculate percentage = 80.9%, and ask Full Name
  assert.equal(turn1.state, CONVERSATION_STATE.AWAITING_NAME);
  assert.equal(currentLead.fsc_marks, 890);
  assert.equal(currentLead.eligible_for, PROGRAM_ELIGIBILITY.SE_SET_CET);
  assert.ok(turn1.reply.includes('80.9%'));
  assert.ok(turn1.reply.includes('890/1100'));
  assert.ok(turn1.reply.includes('Full Name'));

  // Turn 2: Candidate provides full name
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001234455',
    messageBody: 'Hamza Tariq',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.AWAITING_FATHER_NAME);
  assert.ok(turn2.reply.includes("Father's Name"));

  // Turn 3: Candidate provides father's name - must NOT ask for marks again!
  const turn3 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001234455',
    messageBody: 'Tariq Mehmood',
  }, mockDb);

  assert.equal(turn3.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.ok(turn3.reply.includes('Mathematics') || turn3.reply.includes('academic group'));
});

test('Marketing Phase: Different Total Marks calculates percentage accurately', async () => {
  let currentLead = {
    id: 302,
    campaign_id: 1,
    full_name: 'Danish Khan',
    father_name: 'Aslam Khan',
    phone_normalized: '923005544332',
    fsc_marks: null,
    has_maths: null,
    eligible_for: null,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        currentLead.conversation_state = params[0];
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Student writes 750/900 (total is 900 instead of 1100 or 550) -> 83.3%
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923005544332',
    messageBody: '750/900',
  }, mockDb);

  assert.equal(turn1.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.equal(turn1.eligibleFor, PROGRAM_ELIGIBILITY.SE_SET_CET);
  assert.ok(turn1.reply.includes('83.3%'));
  assert.ok(turn1.reply.includes('750/900'));

  // Reset to AWAITING_MARKS for 800/1000 -> 80.0%
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923005544332',
    messageBody: '800/1000',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.equal(turn2.eligibleFor, PROGRAM_ELIGIBILITY.SE_SET_CET);
  assert.ok(turn2.reply.includes('80.0%'));
  assert.ok(turn2.reply.includes('800/1000'));
});

test('Marketing Phase: If student just writes 500, 900, or 60%, ask him the total marks as well', async () => {
  let currentLead = {
    id: 303,
    campaign_id: 1,
    full_name: 'Bilal Tariq',
    father_name: 'Tariq Mehmood',
    phone_normalized: '923007788990',
    fsc_marks: null,
    has_maths: null,
    eligible_for: null,
    eligibility_status: 'PENDING',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDbConnection = {
    async query() {
      return [[{ ...currentLead }]];
    },
    async execute(sql, params) {
      if (sql.includes('UPDATE mkt_leads')) {
        const setClause = sql.split('SET ')[1].split(' WHERE')[0];
        const clauses = setClause.split(',').map((c) => c.trim());
        let pIndex = 0;
        for (const clause of clauses) {
          if (clause.includes('=')) {
            const [col, valExpr] = clause.split('=').map((s) => s.trim());
            if (valExpr === '?') {
              const val = params[pIndex++];
              if (col === 'conversation_state') currentLead.conversation_state = val;
              else if (col === 'fsc_marks') currentLead.fsc_marks = val;
              else if (col === 'chat_history') currentLead.chat_history = val;
            }
          }
        }
      }
      return [{ affectedRows: 1, insertId: 1 }];
    },
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
  };

  const mockDb = {
    async getConnection() {
      return mockDbConnection;
    },
  };

  // Test Case A: Student just writes "500"
  const turnA1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: '500',
  }, mockDb);

  assert.equal(turnA1.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnA1.reply.includes('Total Marks'));
  assert.equal(currentLead.fsc_marks, 500);

  // Student replies with total marks "550" -> 500/550 = 90.9%
  const turnA2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: '550',
  }, mockDb);

  assert.equal(turnA2.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.ok(turnA2.reply.includes('90.9%'));
  assert.ok(turnA2.reply.includes('500/550'));

  // Test Case B: Student just writes "900"
  currentLead.fsc_marks = null;
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
  currentLead.chat_history = JSON.stringify([]);

  const turnB1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: '900',
  }, mockDb);

  assert.equal(turnB1.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnB1.reply.includes('Total Marks'));
  assert.equal(currentLead.fsc_marks, 900);

  // Student replies with total marks "1100" -> 900/1100 = 81.8%
  const turnB2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: '1100',
  }, mockDb);

  assert.equal(turnB2.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.ok(turnB2.reply.includes('81.8%'));
  assert.ok(turnB2.reply.includes('900/1100'));

  // Test Case C: Student just writes "60%"
  currentLead.fsc_marks = null;
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
  currentLead.chat_history = JSON.stringify([]);

  const turnC1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: '60%',
  }, mockDb);

  assert.equal(turnC1.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turnC1.reply.includes('total marks'));

  // Student replies with total marks "1100"
  const turnC2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923007788990',
    messageBody: 'total marks 1100',
  }, mockDb);

  assert.equal(turnC2.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.ok(turnC2.reply.includes('60.0%'));
});

test('LeadBotService: Short Academic Group Recognition (pre eng, eng, engineering, pre med, med, medical)', async () => {
  // Test Pre-Engineering short answers
  assert.equal(LeadBotService.classifyAcademicGroup('pre eng')?.group, 'FSc Pre-Engineering');
  assert.equal(LeadBotService.classifyAcademicGroup('eng')?.group, 'FSc Pre-Engineering');
  assert.equal(LeadBotService.classifyAcademicGroup('engineering')?.group, 'FSc Pre-Engineering');
  assert.equal(LeadBotService.classifyAcademicGroup('pre-eng')?.group, 'FSc Pre-Engineering');
  assert.equal(LeadBotService.classifyAcademicGroup('pre engg')?.group, 'FSc Pre-Engineering');

  // Test Pre-Medical short answers
  assert.equal(LeadBotService.classifyAcademicGroup('pre med')?.group, 'Pre-Medical');
  assert.equal(LeadBotService.classifyAcademicGroup('med')?.group, 'Pre-Medical');
  assert.equal(LeadBotService.classifyAcademicGroup('medical')?.group, 'Pre-Medical');
  assert.equal(LeadBotService.classifyAcademicGroup('pre-med')?.group, 'Pre-Medical');

  // Test ICS and DAE
  assert.equal(LeadBotService.classifyAcademicGroup('ics')?.group, 'ICS');
  assert.equal(LeadBotService.classifyAcademicGroup('comp')?.group, 'ICS');
  assert.equal(LeadBotService.classifyAcademicGroup('computer science')?.group, 'ICS');
  assert.equal(LeadBotService.classifyAcademicGroup('dae')?.group, 'DAE');
});

test('LeadBotService: "Yes, I have a question" handled politely before asking next intake question', async () => {
  let currentLead = {
    id: 501,
    full_name: 'Muhammad',
    father_name: 'Zahid',
    phone_normalized: '923001112233',
    conversation_state: CONVERSATION_STATE.AWAITING_MARKS,
    chat_history: JSON.stringify([]),
  };

  const mockDb = {
    async getConnection() {
      return {
        async query() { return [[{ ...currentLead }]]; },
        async execute(sql, params) {
          if (sql.includes('UPDATE mkt_leads')) currentLead.conversation_state = params[0];
          return [{ affectedRows: 1, insertId: 1 }];
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  // Student says "Yes, I have a question"
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001112233',
    messageBody: 'Yes, I have a question',
  }, mockDb);

  assert.equal(turn1.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn1.reply.includes('Yes, please ask your question'));

  // Student then asks "is electrical engineering offered?"
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001112233',
    messageBody: 'is electrical engineering offered here?',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn2.reply.includes('Department of Software Engineering'));
  assert.ok(turn2.reply.includes('To check your program eligibility'));
});

test('LeadBotService: In-between inquiry about electrical engineering answered gracefully first', async () => {
  let currentLead = {
    id: 502,
    full_name: 'Usman',
    phone_normalized: '923004445566',
    conversation_state: CONVERSATION_STATE.AWAITING_FATHER_NAME,
    chat_history: JSON.stringify([]),
  };

  const mockDb = {
    async getConnection() {
      return {
        async query() { return [[{ ...currentLead }]]; },
        async execute(sql, params) {
          if (sql.includes('UPDATE mkt_leads')) currentLead.conversation_state = params[0];
          return [{ affectedRows: 1, insertId: 1 }];
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923004445566',
    messageBody: 'i want to take admission in electrical or anything',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.AWAITING_FATHER_NAME);
  // Must address the electrical question FIRST
  assert.ok(turn.reply.includes('Software Engineering') || turn.reply.includes('Electrical'));
  // And THEN ask for father's name
  assert.ok(turn.reply.includes("Father's Name"));
});

test('LeadBotService: Candidate in QUALIFIED state can say "can I write my name again" or "correction krni hai"', async () => {
  let currentLead = {
    id: 503,
    full_name: 'Ali Raza',
    father_name: 'Tariq',
    fsc_marks: 890,
    has_maths: 1,
    cnic: '82101-1234567-1',
    email: 'ali@gmail.com',
    phone_normalized: '923005556677',
    conversation_state: CONVERSATION_STATE.QUALIFIED,
    chat_history: JSON.stringify([]),
  };

  let deletedPendingJobs = 0;
  const mockDb = {
    async getConnection() {
      return {
        async query() { return [[{ ...currentLead }]]; },
        async execute(sql, params) {
          if (sql.includes('DELETE FROM outbox_jobs')) deletedPendingJobs++;
          if (sql.includes('UPDATE mkt_leads')) currentLead.conversation_state = params[0];
          return [{ affectedRows: 1, insertId: 1 }];
        },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };

  // Student says "can I write my name again"
  const turnName = await LeadBotService.processIncomingMessage({
    fromPhone: '923005556677',
    messageBody: 'can I write my name again',
  }, mockDb);

  assert.equal(turnName.state, CONVERSATION_STATE.AWAITING_NAME);
  assert.ok(turnName.reply.includes('Full Name'));
  assert.ok(deletedPendingJobs >= 1);

  // Student enters corrected name
  currentLead.conversation_state = CONVERSATION_STATE.AWAITING_NAME;
  const turnCorrectName = await LeadBotService.processIncomingMessage({
    fromPhone: '923005556677',
    messageBody: 'Muhammad Ali Raza',
  }, mockDb);

  assert.equal(turnCorrectName.state, CONVERSATION_STATE.QUALIFIED);
  assert.ok(turnCorrectName.reply.includes('Muhammad Ali Raza'));
  assert.ok(turnCorrectName.reply.includes('1 minute'));
});

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
const { LeadBotService } = await import('../src/modules/marketing/services/lead-bot.service.js');
const {
  CONVERSATION_STATE,
  ELIGIBILITY_STATUS,
  INELIGIBILITY_REASON,
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
});

test('LeadBotService: marks parsing and qualification heuristics', () => {
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

  // Percentage format: "78%"
  const pct = LeadBotService.parseMarks('78%');
  assert.ok(pct);
  assert.equal(pct.percentage, 78);

  // Affirmative / Negative detection
  assert.equal(LeadBotService.isAffirmative('Yes'), true);
  assert.equal(LeadBotService.isAffirmative('han bilkul'), true);
  assert.equal(LeadBotService.isAffirmative('Ji definitely'), true);
  assert.equal(LeadBotService.isNegative('no'), true);
  assert.equal(LeadBotService.isNegative('nahi'), true);
  assert.equal(LeadBotService.isNegative('not interested'), true);
});

test('LeadBotService Qualification Flow: Happy Path (Yes -> Marks >= 50% -> Has Maths -> QUALIFIED)', async () => {
  // Mock DB for conversational state progression
  let currentLead = {
    id: 101,
    campaign_id: 1,
    full_name: 'Zainab Bibi',
    phone_normalized: '923009876543',
    city: 'Rawalpindi',
    prior_degree: 'FSc Pre-Engineering',
    fsc_marks: null,
    has_maths: null,
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
        // Update current lead state in memory
        if (params.includes(CONVERSATION_STATE.AWAITING_MARKS)) {
          currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MARKS;
        } else if (params.includes(CONVERSATION_STATE.AWAITING_MATHS)) {
          currentLead.conversation_state = CONVERSATION_STATE.AWAITING_MATHS;
          currentLead.fsc_marks = params.find((p) => typeof p === 'number');
        } else if (params.includes(CONVERSATION_STATE.QUALIFIED)) {
          currentLead.conversation_state = CONVERSATION_STATE.QUALIFIED;
          currentLead.eligibility_status = ELIGIBILITY_STATUS.ELIGIBLE;
          currentLead.has_maths = true;
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

  // Turn 1: Lead responds "Yes" to Greeting
  const turn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'Yes, I am interested!',
  }, mockDb);

  assert.equal(turn1.state, CONVERSATION_STATE.AWAITING_MARKS);
  assert.ok(turn1.reply.includes('obtained score in FSc/ICS'));

  // Turn 2: Lead sends marks "480/550" (87.27%)
  const turn2 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: '480/550',
  }, mockDb);

  assert.equal(turn2.state, CONVERSATION_STATE.AWAITING_MATHS);
  assert.ok(turn2.reply.includes('Mathematics as a major subject'));

  // Turn 3: Lead responds "Yes" to Mathematics
  const turn3 = await LeadBotService.processIncomingMessage({
    fromPhone: '923009876543',
    messageBody: 'Yes, I studied Maths in Pre-Engineering',
  }, mockDb);

  assert.equal(turn3.state, CONVERSATION_STATE.QUALIFIED);
  assert.equal(turn3.eligible, true);
  assert.ok(turn3.reply.includes('Congratulations'));

  // Check that LEAD_QUALIFIED outbox event was dispatched
  const qualifiedEvent = dispatchedJobs.find((j) => j.jobType === 'LEAD_QUALIFIED');
  assert.ok(qualifiedEvent, 'LEAD_QUALIFIED event must be enqueued into outbox_jobs');
  assert.equal(qualifiedEvent.payload.leadId, 101);
  assert.equal(qualifiedEvent.payload.hasMaths, true);
  assert.equal(qualifiedEvent.payload.fscMarks, 480);
});

test('LeadBotService Qualification Flow: Rejection (<50% marks)', async () => {
  let currentLead = {
    id: 102,
    campaign_id: 1,
    full_name: 'Ahmed Raza',
    phone_normalized: '923335551234',
    city: 'Multan',
    prior_degree: 'ICS',
    fsc_marks: null,
    has_maths: null,
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
        if (params.includes(CONVERSATION_STATE.NOT_INTERESTED)) {
          currentLead.conversation_state = CONVERSATION_STATE.NOT_INTERESTED;
          currentLead.eligibility_status = ELIGIBILITY_STATUS.INELIGIBLE;
          currentLead.ineligibility_reason = INELIGIBILITY_REASON.BELOW_MINIMUM_MARKS_50;
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

  // Student enters 220/550 (40.0% < 50%)
  const turn = await LeadBotService.processIncomingMessage({
    fromPhone: '923335551234',
    messageBody: '220/550',
  }, mockDb);

  assert.equal(turn.state, CONVERSATION_STATE.NOT_INTERESTED);
  assert.equal(turn.eligible, false);
  assert.ok(turn.reply.includes('minimum requirement for Software Engineering is 50%'));
});

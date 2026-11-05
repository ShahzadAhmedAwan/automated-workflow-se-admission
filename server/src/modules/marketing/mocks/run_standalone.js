/**
 * run_standalone.js - Interactive CLI Simulation Harness for Module 2
 * Tests CSV ingestion, anti-ban campaign dispatch, and interactive WhatsApp conversation
 * without needing an active WhatsApp Web QR or live database.
 */

import readline from 'node:readline';
import { randomBytes } from 'node:crypto';

// Provide default test environment variables for standalone execution
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

const { parseAndPreviewLeads } = await import('../services/csv-parser.service.js');
const { CampaignService } = await import('../services/campaign.service.js');
const { LeadBotService } = await import('../services/lead-bot.service.js');
const { CONVERSATION_STATE, ELIGIBILITY_STATUS } = await import('../marketing.constants.js');

// In-memory mock database store for standalone testing
const memoryStore = {
  campaigns: [],
  leads: [],
  outbox: [],
};

const mockDbConnection = {
  async query(sql, params = []) {
    if (sql.includes('SELECT phone_normalized FROM mkt_leads')) {
      return [memoryStore.leads.map((l) => ({ phone_normalized: l.phone_normalized }))];
    }
    if (sql.includes('FROM mkt_leads') && sql.includes('WHERE phone_normalized = ?')) {
      const match = memoryStore.leads.find((l) => l.phone_normalized === params[0]);
      return [match ? [{ ...match }] : []];
    }
    if (sql.includes('FROM mkt_leads') && sql.includes('WHERE campaign_id = ?')) {
      const matches = memoryStore.leads.filter(
        (l) => l.campaign_id === params[0] && l.conversation_state === 'IDLE'
      );
      return [matches.map((m) => ({ ...m }))];
    }
    if (sql.includes('SELECT id, status FROM mkt_campaigns WHERE id = ?')) {
      const camp = memoryStore.campaigns.find((c) => c.id === params[0]);
      return [camp ? [camp] : []];
    }
    return [[]];
  },

  async execute(sql, params = []) {
    if (sql.includes('INSERT INTO mkt_campaigns')) {
      const newCamp = {
        id: memoryStore.campaigns.length + 1,
        name: params[0],
        description: params[1],
        created_by: params[2],
        status: 'DRAFT',
        total_leads: 0,
        sent_count: 0,
        eligible_count: 0,
      };
      memoryStore.campaigns.push(newCamp);
      return [{ insertId: newCamp.id }];
    }

    if (sql.includes('INSERT INTO mkt_leads')) {
      const newLead = {
        id: memoryStore.leads.length + 1,
        full_name: params[0],
        phone_raw: params[1],
        phone_normalized: params[2],
        conversation_state: params[3] || 'IDLE',
        chat_history: JSON.stringify([]),
        eligibility_status: 'PENDING',
      };
      memoryStore.leads.push(newLead);
      return [{ insertId: newLead.id }];
    }

    if (sql.includes('UPDATE mkt_leads')) {
      const leadId = params[params.length - 1];
      const lead = memoryStore.leads.find((l) => l.id === leadId);
      if (lead) {
        if (sql.includes('conversation_state = ?')) lead.conversation_state = params[0];
        if (sql.includes('chat_history = ?')) lead.chat_history = params[1];
        if (params.includes(ELIGIBILITY_STATUS.ELIGIBLE)) {
          lead.eligibility_status = ELIGIBILITY_STATUS.ELIGIBLE;
          lead.has_maths = true;
        }
      }
      return [{ affectedRows: 1 }];
    }

    if (sql.includes('INSERT INTO outbox_jobs')) {
      memoryStore.outbox.push({
        id: memoryStore.outbox.length + 1,
        queue: params[0],
        type: params[1],
        payload: JSON.parse(params[2]),
        availableAt: params[3],
      });
      return [{ insertId: memoryStore.outbox.length }];
    }

    if (sql.includes('UPDATE mkt_campaigns')) {
      return [{ affectedRows: 1 }];
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
  async query(sql, params) {
    return mockDbConnection.query(sql, params);
  },
  async execute(sql, params) {
    return mockDbConnection.execute(sql, params);
  },
};

async function run() {
  console.log('\n=============================================================');
  console.log('🤖 MODULE 2 STANDALONE HARNESS (MARKETING & BOT SIMULATION)');
  console.log('=============================================================\n');

  // STEP 1: CSV Upload & Dry-run Preview
  console.log('--- Step 1: Testing CSV Lead Parsing & Normalization ---');
  const sampleCsv = Buffer.from(
    `Student Name,Phone Number,City,Education
Hamza Tariq,0300-1122334,Islamabad,FSc Pre-Engineering
Ayesha Noor,03129876543,Rawalpindi,ICS
Duplicate Lead,03001122334,Islamabad,FSc
Broken Phone,9999,Lahore,Matric`
  );

  const preview = await parseAndPreviewLeads(sampleCsv, { dbConnection: mockDb });
  console.log(`✅ Total Rows: ${preview.totalRows}`);
  console.log(`✅ Valid Leads: ${preview.validCount}`);
  console.log(`⚠️ Duplicates Caught: ${preview.duplicateCount}`);
  console.log(`❌ Invalid Phones Filtered: ${preview.invalidPhoneCount}`);

  // STEP 2: Import Leads under Campaign
  console.log('\n--- Step 2: Creating Campaign & Importing Leads ---');
  const camp = await CampaignService.createCampaign(
    { name: 'Fall 2026 Tech Drive', description: 'Outreach to Pre-Eng and ICS students' },
    mockDb
  );
  console.log(`✅ Campaign created: ID #${camp.id} ("${camp.name}")`);

  // Manually add valid leads into store
  for (const vl of preview.validLeads) {
    memoryStore.leads.push({
      id: memoryStore.leads.length + 1,
      campaign_id: camp.id,
      full_name: vl.fullName,
      phone_raw: vl.phoneRaw,
      phone_normalized: vl.phoneNormalized,
      city: vl.city,
      prior_degree: vl.priorDegree,
      conversation_state: 'IDLE',
      chat_history: JSON.stringify([]),
      eligibility_status: 'PENDING',
    });
  }
  console.log(`✅ ${preview.validLeads.length} leads loaded into campaign #${camp.id}`);

  // STEP 3: Trigger Outreach with Anti-Ban Jitter
  console.log('\n--- Step 3: Triggering Anti-Ban WhatsApp Outreach ---');
  const outreach = await CampaignService.triggerOutreach(camp.id, {
    jitterMinSeconds: 12,
    jitterMaxSeconds: 28,
    now: new Date('2026-10-15T11:00:00'),
  }, mockDb);
  console.log(`✅ Enqueued ${outreach.scheduledCount} messages into outbox_jobs.`);
  
  memoryStore.outbox.forEach((job, i) => {
    console.log(`   [Job ${i + 1}] Scheduled at: ${new Date(job.availableAt).toLocaleTimeString()} | To: ${job.payload.recipientPhone} | Msg: "${job.payload.messageText.slice(0, 45)}..."`);
  });

  // STEP 4: Interactive Applicant Chat Simulation
  console.log('\n--- Step 4: Interactive WhatsApp Turn Simulation ---');
  console.log('You are now roleplaying as Hamza Tariq (Phone: 923001122334).');
  console.log('Bot will respond according to the qualification state machine.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lead = memoryStore.leads[0];
  console.log(`📲 [WhatsApp Bot to Hamza]: "Assalam-o-Alaikum ${lead.full_name}! Are you interested in Software Engineering admissions for Fall 2026? (Reply Yes/No)"`);

  const askUser = () => {
    rl.question('\n👤 You (Applicant): ', async (userText) => {
      if (userText.trim().toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      const turn = await LeadBotService.processIncomingMessage({
        fromPhone: lead.phone_normalized,
        messageBody: userText,
      }, mockDb);

      console.log(`🤖 Bot Reply: "${turn.reply}"`);
      console.log(`   [State: ${turn.state}] | [Eligible: ${turn.eligible}]`);

      if (turn.state === CONVERSATION_STATE.QUALIFIED) {
        console.log('\n🎉 SUCCESS! Student qualified for admission.');
        const qualifiedJob = memoryStore.outbox.find((j) => j.type === 'LEAD_QUALIFIED');
        if (qualifiedJob) {
          console.log(`📢 Dispatched 'LEAD_QUALIFIED' event to outbox for Module 3:`);
          console.log(JSON.stringify(qualifiedJob.payload, null, 2));
        }
        rl.close();
      } else if (turn.state === CONVERSATION_STATE.NOT_INTERESTED) {
        console.log('\n⛔ Student marked ineligible / not interested. Flow completed.');
        rl.close();
      } else {
        askUser();
      }
    });
  };

  askUser();
}

run().catch(console.error);

import { pool } from '../server/src/core/db/pool.js';
import { CampaignService } from '../server/src/modules/marketing/services/campaign.service.js';
import { LeadBotService } from '../server/src/modules/marketing/services/lead-bot.service.js';

async function run() {
  console.log('--- STARTING CRITICAL MARKETING FLOW TEST ---');

  // 1. Create a campaign
  const campaign = await CampaignService.createCampaign({
    name: 'Critical Test Campaign 2026',
    description: 'Admissions outreach for SE, SET, CET',
  });
  console.log(`[PASS] Created campaign id=${campaign.id}`);

  // 2. Ingest realistic CSV leads with high marks
  const testLeads = [
    {
      fullName: 'Hamza Tariq',
      fatherName: 'Tariq Mehmood',
      phoneRaw: '03001234567',
      phoneNormalized: '923001234567',
      cnic: '82203-1234567-1',
      city: 'Muzaffarabad',
      priorDegree: 'Pre-Engineering',
      fscMarks: 875,
      hasMaths: true,
      eligibleFor: 'SE',
    },
    {
      fullName: 'Ayesha Bibi',
      fatherName: 'Muhammad Rasheed',
      phoneRaw: '03159876543',
      phoneNormalized: '923159876543',
      cnic: '82101-9876543-2',
      city: 'Mirpur',
      priorDegree: 'ICS',
      fscMarks: 760,
      hasMaths: true,
      eligibleFor: 'SE',
    },
  ];

  const importRes = await CampaignService.importLeads(campaign.id, testLeads);
  console.log(`[PASS] Ingested ${importRes.insertedCount} leads into campaign ${campaign.id}`);

  // Verify conversation_state is IDLE
  const [leadsInDb] = await pool.query(
    'SELECT id, full_name, phone_normalized, conversation_state FROM mkt_leads WHERE campaign_id = ?',
    [campaign.id]
  );
  console.log(`[VERIFY] Leads in DB state:`, leadsInDb.map((l) => `${l.full_name}: ${l.conversation_state}`));
  if (leadsInDb.some((l) => l.conversation_state !== 'IDLE')) {
    throw new Error('FAIL: Newly imported leads are not in IDLE state!');
  }

  // 3. Trigger outreach
  const outreachRes = await CampaignService.triggerOutreach(campaign.id, { sendNow: true });
  console.log(`[PASS] Outreach triggered: scheduledCount=${outreachRes.scheduledCount}`);
  if (outreachRes.scheduledCount !== 2) {
    throw new Error(`FAIL: Expected 2 scheduled messages, got ${outreachRes.scheduledCount}`);
  }

  // 4. Verify outbox jobs
  const [jobs] = await pool.query(
    "SELECT id, available_at, status, payload FROM outbox_jobs WHERE queue_name = 'whatsapp_outreach' ORDER BY id DESC LIMIT 2"
  );
  console.log(`[PASS] Found ${jobs.length} outbox jobs for outreach`);
  for (const job of jobs) {
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    console.log(`  Job #${job.id}: to ${payload.recipientPhone}, available_at: ${job.available_at}, status: ${job.status}`);
  }

  // 5. Test single lead outreach
  const singleRes = await CampaignService.sendSingleLeadOutreach({
    campaignId: campaign.id,
    fullName: 'Bilal Ahmed',
    phone: '03451122334',
    city: 'Rawalpindi',
    priorDegree: 'Pre-Engineering',
  });
  console.log(`[PASS] Single lead outreach dispatched to ${singleRes.fullName} (${singleRes.phoneNormalized})`);

  // 6. Test lead bot dialog: Student replies "Yes", gives details
  const botTurn1 = await LeadBotService.processIncomingMessage({
    fromPhone: '923001234567',
    messageBody: 'Yes I am interested',
    queueReply: false,
  });
  console.log(`[PASS] Bot Turn 1 reply:`, botTurn1.reply.slice(0, 100) + '...');

  // Clean up test data
  await pool.query('DELETE FROM outbox_jobs WHERE id IN (?, ?)', [jobs[0]?.id || 0, jobs[1]?.id || 0]);
  await pool.query('DELETE FROM mkt_leads WHERE campaign_id = ?', [campaign.id]);
  await pool.query('DELETE FROM mkt_campaigns WHERE id = ?', [campaign.id]);
  console.log(`[PASS] Test campaign ${campaign.id} and test leads cleanly deleted.`);

  console.log('--- MARKETING FLOW TEST COMPLETED SUCCESSFULLY ---');
  await pool.end();
}

run().catch((err) => {
  console.error('ERROR in marketing test:', err);
  process.exit(1);
});

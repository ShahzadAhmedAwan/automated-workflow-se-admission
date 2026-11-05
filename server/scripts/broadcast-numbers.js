/**
 * broadcast-numbers.js
 * CLI script to broadcast the automated outreach message to a list of phone numbers from a file.
 *
 * Usage:
 *   node scripts/broadcast-numbers.js [path/to/numbers.txt]
 *
 * Defaults to server/data/broadcast_numbers.txt if no file path provided.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CampaignService } from '../src/modules/marketing/services/campaign.service.js';
import { pool } from '../src/core/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runBroadcast() {
  const filePath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.resolve(__dirname, '../data/broadcast_numbers.txt');

  console.log('\n=============================================================');
  console.log('📢 BROADCAST OUTREACH - DEPARTMENT OF SOFTWARE ENGINEERING (UAJK)');
  console.log('=============================================================\n');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Numbers file not found at: ${filePath}`);
    console.log('Please provide a valid file path or create server/data/broadcast_numbers.txt');
    process.exit(1);
  }

  console.log(`📂 Reading numbers from: ${filePath}`);

  try {
    const result = await CampaignService.broadcastToNumbersFile(filePath, {
      jitterMinSeconds: 5,
      jitterMaxSeconds: 15,
      allowedStartHour: 8,
      allowedEndHour: 22,
    }, pool);

    console.log('\n✅ BROADCAST SCHEDULED SUCCESSFULLY!');
    console.log(`• Total Rows in File: ${result.totalRead}`);
    console.log(`• Successfully Scheduled: ${result.scheduledCount}`);
    console.log(`• Invalid/Skipped Lines: ${result.invalidCount}`);
    console.log('\n📡 Scheduled jobs have been queued in outbox_jobs table.');
    console.log('💡 Live WhatsApp engine (npm run whatsapp:live) will deliver them with anti-ban human jitter & typing presence!\n');
  } catch (err) {
    console.error('❌ Broadcast Error:', err.message);
  } finally {
    await pool.end();
  }
}

runBroadcast().catch(console.error);

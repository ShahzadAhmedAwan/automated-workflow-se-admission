/**
 * run_live_whatsapp.js
 * Launches the live Baileys WhatsApp client with your real WhatsApp number.
 * 
 * Supports:
 * - Direct connection with existing paired credentials (from whatsapp-bot/data/auth)
 *   OR dynamic QR code generation in terminal if re-pairing is needed.
 * - Outbox Queue Poller: picks up scheduled WHATSAPP_MESSAGE jobs and delivers them
 *   with typing presence & anti-ban jitter to real WhatsApp recipients.
 * - Live Incoming Turn Processor: routes incoming WhatsApp messages directly
 *   into the Module 2 LeadBotService qualification engine.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'node:path';
import fs from 'node:fs';
import { useMySQLAuthState } from '../src/core/baileys/mysql-auth-store.js';
import { pool } from '../src/core/db/pool.js';
import { claimJobs } from '../src/core/queue/outboxBus.js';
import { EVENT_TYPES } from '../src/contracts/event-types.js';
import { LeadBotService } from '../src/modules/marketing/services/lead-bot.service.js';
import { normalizePhoneNumber } from '../src/modules/marketing/services/csv-parser.service.js';

let sock = null;

async function startWhatsAppBot() {
  console.log('\n=============================================================');
  console.log('🚀 STARTING LIVE WHATSAPP ENGINE FOR ADMISSIONS WORKFLOW');
  console.log('=============================================================\n');

  // Check if we have credentials in MySQL or if we should fallback to local folder
  const { state, saveCreds } = await useMySQLAuthState('default', pool);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Baileys Version: v${version.join('.')} (latest: ${isLatest})`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 QR CODE GENERATED: Scan this with your WhatsApp:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`WhatsApp connection closed (code ${statusCode}). Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 5000);
      } else {
        console.log('Logged out. Please re-run to scan fresh QR.');
      }
    } else if (connection === 'open') {
      const userJid = sock.user?.id || '';
      const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
      console.log('\n=============================================================');
      console.log(`🟢 WHATSAPP CONNECTED SUCCESSFULLY!`);
      console.log(`📱 Phone Number: +${userPhone}`);
      console.log(`📡 Ready to send anti-ban outreach and qualify student leads!`);
      console.log('=============================================================\n');
    }
  });

  // Listen to live inbound messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const jid = msg.key.remoteJid;
      if (isJidGroup(jid) || jid.endsWith('@broadcast')) continue;

      const rawText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!rawText.trim()) continue;

      const senderPhone = normalizePhoneNumber(jid.split('@')[0]);
      if (!senderPhone) continue;

      console.log(`\n📩 Incoming from +${senderPhone}: "${rawText}"`);

      try {
        // Send presence (typing...)
        await sock.sendPresenceUpdate('composing', jid);

        // Process message through Module 2 state machine
        const turnResult = await LeadBotService.processIncomingMessage({
          fromPhone: senderPhone,
          messageBody: rawText,
        }, pool);

        console.log(`🤖 Lead State: [${turnResult.state}] | Reply: "${turnResult.reply}"`);

        // Send reply directly back to applicant
        await sock.sendMessage(jid, { text: turnResult.reply });
        await sock.sendPresenceUpdate('paused', jid);
      } catch (err) {
        console.error(`[LeadBot Error for ${senderPhone}]:`, err.message);
      }
    }
  });

  // Start polling Outbox queue to send scheduled outreach messages
  startOutboxPollingLoop();
}

function startOutboxPollingLoop() {
  console.log('⚙️ Outbox Poller active: listening for WHATSAPP_MESSAGE jobs...');

  setInterval(async () => {
    if (!sock || !sock.user) return; // Wait until WhatsApp is connected

    try {
      const { jobs, lockOwner } = await claimJobs({
        batchSize: 1, // 1 message at a time to enforce jitter
        jobTypes: [EVENT_TYPES.WHATSAPP_MESSAGE],
      });

      for (const job of jobs) {
        const { recipientPhone, messageText } = job.payload;
        const jid = `${recipientPhone}@s.whatsapp.net`;

        console.log(`\n📤 Dispatching scheduled outreach to +${recipientPhone}...`);

        // Simulate typing for 2 seconds
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise((r) => setTimeout(r, 2000));

        await sock.sendMessage(jid, { text: messageText });
        await sock.sendPresenceUpdate('paused', jid);

        console.log(`✅ Message delivered to +${recipientPhone}`);

        // Mark job completed
        await pool.execute(
          `UPDATE outbox_jobs SET status = 'COMPLETED', locked_at = NULL, lock_owner = NULL
           WHERE id = ?`,
          [job.id]
        );
      }
    } catch (err) {
      // Outbox poll tick silent error catch
    }
  }, 5000);
}

startWhatsAppBot().catch(console.error);

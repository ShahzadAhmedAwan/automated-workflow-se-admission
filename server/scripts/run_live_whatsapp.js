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
import QRCode from 'qrcode';
import path from 'node:path';
import fs from 'node:fs';
import { useMySQLAuthState } from '../src/core/baileys/mysql-auth-store.js';
import { pool } from '../src/core/db/pool.js';
import { claimJobs, completeJob, retryJob } from '../src/core/queue/outboxBus.js';
import { EVENT_TYPES } from '../src/contracts/event-types.js';
import { LeadBotService } from '../src/modules/marketing/services/lead-bot.service.js';
import { normalizePhoneNumber } from '../src/modules/marketing/services/csv-parser.service.js';

let sock = null;

async function recordWhatsAppStatus({ status, phone = null, qr = false, qrDataUrl = null, qrString = null, error = null }) {
  try {
    const payload = JSON.stringify({
      status,
      phone,
      qr,
      qrDataUrl,
      qrString,
      error,
      updatedAt: new Date().toISOString(),
    });
    await pool.execute(
      `INSERT INTO sys_settings (setting_key, setting_value)
       VALUES ('whatsapp_session_status', ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
      [payload]
    );
  } catch (err) {
    console.error('[WhatsApp Status Record Error]:', err.message);
  }
}

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
      let qrDataUrl = null;
      try {
        qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, width: 320 });
      } catch {}
      await recordWhatsAppStatus({ status: 'NEEDS_QR', qr: true, qrString: qr, qrDataUrl });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`WhatsApp connection closed (code ${statusCode}). Reconnecting: ${shouldReconnect}`);
      await recordWhatsAppStatus({
        status: shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED',
        error: statusCode ? `Closed code ${statusCode}` : 'Disconnected',
      });
      if (shouldReconnect) {
        setTimeout(startWhatsAppBot, 5000);
      } else {
        console.log('Logged out. Please re-run to scan fresh QR.');
      }
    } else if (connection === 'open') {
      const userJid = sock.user?.id || '';
      const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
      await recordWhatsAppStatus({ status: 'CONNECTED', phone: userPhone });

      console.log('\n=============================================================');
      console.log(`🟢 WHATSAPP CONNECTED SUCCESSFULLY!`);
      console.log(`📱 Phone Number: +${userPhone}`);
      console.log(`📡 Ready to send anti-ban outreach and qualify student leads!`);
      console.log('=============================================================\n');
    }
  });

  // Keep alive heartbeat every 30 seconds
  setInterval(async () => {
    if (sock?.user) {
      const userJid = sock.user?.id || '';
      const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
      await recordWhatsAppStatus({ status: 'CONNECTED', phone: userPhone });
    }
  }, 30000);

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

      let senderPhone = null;
      // If jid is an @lid (modern WhatsApp Multi-Device privacy ID), extract phone from remoteJidAlt / participant
      if (jid.endsWith('@lid')) {
        const alt = msg.key.remoteJidAlt || msg.key.participantAlt || msg.key.participant;
        if (alt && (alt.endsWith('@s.whatsapp.net') || alt.includes('@s.whatsapp.net'))) {
          senderPhone = normalizePhoneNumber(alt.split('@')[0]);
        }
      }
      if (!senderPhone) {
        senderPhone = normalizePhoneNumber(jid.split('@')[0]);
      }
      if (!senderPhone) continue;

      console.log(`\n📩 Incoming from +${senderPhone} [JID: ${jid}]: "${rawText}"`);

      try {
        // Send presence (typing...)
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});

        // Process message through Module 2 state machine (queueReply: false prevents double messaging since sock.sendMessage sends it directly below)
        const turnResult = await LeadBotService.processIncomingMessage({
          fromPhone: senderPhone,
          messageBody: rawText,
          queueReply: false,
        }, pool);

        const replyText =
          turnResult?.reply?.trim() ||
          "Assalam-o-Alaikum! Thank you for reaching out to the Department of Software Engineering at UAJK. How may I assist you with your admissions inquiry today?";

        console.log(`🤖 Lead State: [${turnResult?.state || 'UNKNOWN'}] | Eligible For: [${turnResult?.eligibleFor || 'N/A'}] | Reply: "${replyText}"`);

        // Send reply directly back to applicant with fallback JID support
        try {
          await sock.sendMessage(jid, { text: replyText });
        } catch (sendErr) {
          let fallbackSent = false;
          if (jid.endsWith('@lid') && senderPhone) {
            try {
              await sock.sendMessage(`${senderPhone}@s.whatsapp.net`, { text: replyText });
              fallbackSent = true;
            } catch {}
          } else if (!jid.endsWith('@lid') && senderPhone && senderPhone.length >= 14) {
            try {
              await sock.sendMessage(`${senderPhone}@lid`, { text: replyText });
              fallbackSent = true;
            } catch {}
          }
          if (!fallbackSent) throw sendErr;
        }
      } catch (err) {
        console.error(`[LeadBot Error for ${senderPhone}]:`, err.message);
        // Graceful fallback response: ensure student is never left in the dark
        try {
          const fallbackNotice =
            "Assalam-o-Alaikum! Thank you for your message. I am right here with you. Feel free to ask any question regarding our programs (SE, SET, CET), eligibility criteria, fee structure, or hostel facilities. You can also reach our department helpline at +92-5822-960510.";
          await sock.sendMessage(jid, { text: fallbackNotice }).catch(async () => {
            if (senderPhone) {
              await sock.sendMessage(`${senderPhone}@s.whatsapp.net`, { text: fallbackNotice }).catch(() => {});
            }
          });
        } catch {}
      } finally {
        try {
          await sock.sendPresenceUpdate('paused', jid).catch(() => {});
        } catch {}
      }
    }
  });

  // Start polling Outbox queue to send scheduled outreach messages
  startOutboxPollingLoop();
}

let isOutboxPollingStarted = false;

function startOutboxPollingLoop() {
  if (isOutboxPollingStarted) return;
  isOutboxPollingStarted = true;
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
        
        // Handle both standard phone numbers and modern WhatsApp LIDs
        let jid = `${recipientPhone}@s.whatsapp.net`;
        if (recipientPhone.length >= 14 && !recipientPhone.startsWith('92')) {
          jid = `${recipientPhone}@lid`;
        }

        console.log(`\n📤 Dispatching scheduled outreach to ${jid}...`);

        try {
          // Simulate typing for 2 seconds
          await sock.sendPresenceUpdate('composing', jid);
          await new Promise((r) => setTimeout(r, 2000));

          await sock.sendMessage(jid, { text: messageText });
          await sock.sendPresenceUpdate('paused', jid);

          console.log(`✅ Message delivered to ${jid}`);
          await completeJob(job.id, lockOwner);
        } catch (deliveryErr) {
          console.error(`❌ Delivery failed for ${jid}:`, deliveryErr.message);
          // If sending to @s.whatsapp.net failed for a 15-digit number, retry with @lid
          let fallbackDelivered = false;
          if (!jid.endsWith('@lid') && recipientPhone.length >= 14) {
            try {
              const lidJid = `${recipientPhone}@lid`;
              await sock.sendMessage(lidJid, { text: messageText });
              console.log(`✅ Message delivered via fallback to ${lidJid}`);
              await completeJob(job.id, lockOwner);
              fallbackDelivered = true;
            } catch {}
          }
          if (!fallbackDelivered) {
            await retryJob(job, lockOwner, deliveryErr);
          }
        }
      }
    } catch (err) {
      // Outbox poll tick silent error catch
    }
  }, 5000);
}

startWhatsAppBot().catch((err) => {
  console.error('Fatal Baileys crash:', err);
  process.exit(1);
});

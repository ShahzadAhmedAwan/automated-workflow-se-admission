import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { useMySQLAuthState } from './mysql-auth-store.js';
import { pool } from '../db/pool.js';
import { claimJobs, completeJob, retryJob } from '../queue/outboxBus.js';
import { EVENT_TYPES } from '../../contracts/event-types.js';
import { LeadBotService } from '../../modules/marketing/services/lead-bot.service.js';
import { normalizePhoneNumber } from '../../modules/marketing/services/csv-parser.service.js';

class WhatsAppManagerService {
  constructor() {
    this.sock = null;
    this.status = 'DISCONNECTED';
    this.connectedPhone = null;
    this.qrString = null;
    this.qrDataUrl = null;
    this.lastError = null;
    this.isPolling = false;
    this.isStarting = false;
    this.qrListeners = [];
    this.studentQueues = new Map();
  }

  /**
   * Enqueues tasks per student phone number so that:
   * 1. Different students run concurrently in parallel with zero blocking
   * 2. Multiple rapid messages from the SAME student are processed in strict FIFO order
   */
  enqueueForStudent(phone, task) {
    const key = String(phone);
    const prev = this.studentQueues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(task);
    this.studentQueues.set(key, next);
    next.finally(() => {
      if (this.studentQueues.get(key) === next) {
        this.studentQueues.delete(key);
      }
    });
    return next;
  }

  async recordStatus({ status, phone = null, qr = false, qrDataUrl = null, qrString = null, error = null }, db = pool) {
    try {
      this.status = status;
      if (phone) this.connectedPhone = phone;
      this.qrDataUrl = qrDataUrl;
      this.qrString = qrString;
      this.lastError = error;

      const payload = JSON.stringify({
        status,
        phone: this.connectedPhone,
        qr,
        qrDataUrl,
        qrString,
        error,
        updatedAt: new Date().toISOString(),
      });

      await db.execute(
        `INSERT INTO sys_settings (setting_key, setting_value)
         VALUES ('whatsapp_session_status', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [payload]
      );
    } catch (err) {
      console.warn('[WhatsApp Status DB write warning]:', err.message);
    }
  }

  async getStatus(db = pool) {
    // First check memory
    if (this.sock?.user) {
      const userJid = this.sock.user?.id || '';
      const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
      return {
        connected: true,
        status: 'CONNECTED',
        phone: userPhone,
        qrDataUrl: null,
        qrString: null,
        updatedAt: new Date().toISOString(),
      };
    }

    // Check sys_settings in database
    try {
      const [rows] = await db.query(
        `SELECT setting_value, updated_at FROM sys_settings WHERE setting_key = 'whatsapp_session_status' LIMIT 1`
      );
      if (rows && rows.length) {
        const val = typeof rows[0].setting_value === 'string' ? JSON.parse(rows[0].setting_value) : rows[0].setting_value;
        return {
          connected: val?.status === 'CONNECTED',
          status: val?.status || 'DISCONNECTED',
          phone: val?.phone || this.connectedPhone || null,
          qrDataUrl: val?.qrDataUrl || this.qrDataUrl || null,
          qrString: val?.qrString || this.qrString || null,
          updatedAt: rows[0].updated_at ? new Date(rows[0].updated_at).toISOString() : new Date().toISOString(),
          error: val?.error || null,
        };
      }
    } catch {}

    return {
      connected: this.status === 'CONNECTED',
      status: this.status,
      phone: this.connectedPhone,
      qrDataUrl: this.qrDataUrl,
      qrString: this.qrString,
      updatedAt: new Date().toISOString(),
      error: this.lastError,
    };
  }

  async startSocket(db = pool) {
    if (this.isStarting) return;
    this.isStarting = true;

    try {
      const { state, saveCreds } = await useMySQLAuthState('default', db);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false,
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrString = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              width: 320,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
          } catch (qrErr) {
            console.warn('[QR Render error]:', qrErr.message);
          }

          await this.recordStatus({
            status: 'NEEDS_QR',
            qr: true,
            qrDataUrl: this.qrDataUrl,
            qrString: qr,
          }, db);

          // Notify any waiting listeners
          while (this.qrListeners.length > 0) {
            const listener = this.qrListeners.shift();
            listener(this.qrDataUrl);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.status = shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED';
          await this.recordStatus({
            status: shouldReconnect ? 'RECONNECTING' : 'DISCONNECTED',
            error: statusCode ? `Closed code ${statusCode}` : 'Disconnected',
          }, db);

          if (shouldReconnect) {
            setTimeout(() => this.startSocket(db), 5000);
          }
        } else if (connection === 'open') {
          const userJid = this.sock.user?.id || '';
          const userPhone = userJid.split(':')[0] || userJid.split('@')[0];
          this.connectedPhone = userPhone;
          this.qrDataUrl = null;
          this.qrString = null;
          await this.recordStatus({
            status: 'CONNECTED',
            phone: userPhone,
            qr: false,
            qrDataUrl: null,
            qrString: null,
          }, db);
        }
      });

      // Listen to inbound messages
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify' || !Array.isArray(messages)) return;

        // Process all inbound student messages in parallel across students
        await Promise.allSettled(
          messages.map(async (msg) => {
            if (!msg.message || msg.key?.fromMe) return;
            const jid = msg.key?.remoteJid;
            if (!jid || isJidGroup(jid) || jid.endsWith('@broadcast')) return;

            const rawText =
              msg.message.conversation ||
              msg.message.extendedTextMessage?.text ||
              msg.message.imageMessage?.caption ||
              '';

            if (!rawText.trim()) return;

            let senderPhone = null;
            if (jid.endsWith('@lid')) {
              const alt = msg.key.remoteJidAlt || msg.key.participantAlt || msg.key.participant;
              if (alt && (alt.endsWith('@s.whatsapp.net') || alt.includes('@s.whatsapp.net'))) {
                senderPhone = normalizePhoneNumber(alt.split('@')[0]);
              }
            }
            if (!senderPhone) {
              senderPhone = normalizePhoneNumber(jid.split('@')[0]);
            }
            if (!senderPhone) return;

            // Enqueue sequentially for this specific student, but concurrently across other students
            return this.enqueueForStudent(senderPhone, async () => {
              try {
                await this.sock.sendPresenceUpdate('composing', jid);
                const turnResult = await LeadBotService.processIncomingMessage({
                  fromPhone: senderPhone,
                  messageBody: rawText,
                  queueReply: false,
                }, db);

                await this.sock.sendMessage(jid, { text: turnResult.reply });
                await this.sock.sendPresenceUpdate('paused', jid);
              } catch (err) {
                console.error(`[LeadBot Error for ${senderPhone}]:`, err.message);
              }
            });
          })
        );
      });

      this.startOutboxPollingLoop(db);
    } catch (err) {
      console.warn('[WhatsApp Socket start deferred]:', err.message);
    } finally {
      this.isStarting = false;
    }
  }

  async resetSession(db = pool) {
    try {
      if (this.sock) {
        try { this.sock.end(undefined); } catch {}
        this.sock = null;
      }

      // Wipe session credentials from sys_baileys_auth
      await db.execute(`DELETE FROM sys_baileys_auth WHERE session_id = 'default'`);

      this.connectedPhone = null;
      this.qrDataUrl = null;
      this.qrString = null;
      this.status = 'NEEDS_QR';

      await this.recordStatus({
        status: 'NEEDS_QR',
        phone: null,
        qr: true,
        qrDataUrl: null,
      }, db);

      // Start socket and wait for fresh QR
      const qrPromise = new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 8000);
        this.qrListeners.push((dataUrl) => {
          clearTimeout(timer);
          resolve(dataUrl);
        });
      });

      this.startSocket(db);
      const generatedQrUrl = await qrPromise;

      return {
        status: 'NEEDS_QR',
        qrDataUrl: generatedQrUrl || this.qrDataUrl,
        message: 'Session reset. Scan the QR code to pair your WhatsApp number.',
      };
    } catch (err) {
      throw new Error(`Failed to reset WhatsApp session: ${err.message}`);
    }
  }

  startOutboxPollingLoop(db = pool) {
    if (this.isPolling) return;
    this.isPolling = true;

    setInterval(async () => {
      if (!this.sock || !this.sock.user || this.status !== 'CONNECTED') return;

      try {
        const { jobs, lockOwner } = await claimJobs({
          batchSize: 1,
          jobTypes: [EVENT_TYPES.WHATSAPP_MESSAGE],
        });

        for (const job of jobs) {
          const { recipientPhone, messageText } = job.payload;
          let jid = `${recipientPhone}@s.whatsapp.net`;
          if (recipientPhone.length >= 14 && !recipientPhone.startsWith('92')) {
            jid = `${recipientPhone}@lid`;
          }

          try {
            await this.sock.sendPresenceUpdate('composing', jid);
            await new Promise((r) => setTimeout(r, 1500));
            await this.sock.sendMessage(jid, { text: messageText });
            await this.sock.sendPresenceUpdate('paused', jid);
            await completeJob(job.id, lockOwner);

            if (job.payload?.metadata?.snapshotId && job.payload?.metadata?.studentId) {
              await pool.execute(
                `UPDATE mrt_entries SET notification_sent = TRUE, notification_sent_at = CURRENT_TIMESTAMP(3)
                 WHERE snapshot_id = ? AND student_id = ?`,
                [job.payload.metadata.snapshotId, job.payload.metadata.studentId]
              ).catch(() => {});
            }
          } catch (deliveryErr) {
            let fallbackDelivered = false;
            if (!jid.endsWith('@lid') && recipientPhone.length >= 14) {
              try {
                const lidJid = `${recipientPhone}@lid`;
                await this.sock.sendMessage(lidJid, { text: messageText });
                await completeJob(job.id, lockOwner);
                fallbackDelivered = true;
                if (job.payload?.metadata?.snapshotId && job.payload?.metadata?.studentId) {
                  await pool.execute(
                    `UPDATE mrt_entries SET notification_sent = TRUE, notification_sent_at = CURRENT_TIMESTAMP(3)
                     WHERE snapshot_id = ? AND student_id = ?`,
                    [job.payload.metadata.snapshotId, job.payload.metadata.studentId]
                  ).catch(() => {});
                }
              } catch {}
            }
            if (!fallbackDelivered) {
              await retryJob(job, lockOwner, deliveryErr);
              if (String(deliveryErr?.message).includes('Closed') || String(deliveryErr?.message).includes('disconnect')) {
                this.status = 'RECONNECTING';
              }
              if (job.attempts >= 4 && job.payload?.metadata?.snapshotId && job.payload?.metadata?.studentId) {
                await pool.execute(
                  `UPDATE mrt_entries SET notification_sent = FALSE, notification_sent_at = NULL
                   WHERE snapshot_id = ? AND student_id = ?`,
                  [job.payload.metadata.snapshotId, job.payload.metadata.studentId]
                ).catch(() => {});
              }
            }
          }
        }
      } catch {}
    }, 5000);
  }
}

export const WhatsAppManager = new WhatsAppManagerService();
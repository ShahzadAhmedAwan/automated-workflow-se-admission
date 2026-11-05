import { proto, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { pool } from '../db/pool.js';

/**
 * useMySQLAuthState
 * Implements Baileys Multi-Device Authentication State directly in MySQL table `sys_baileys_auth`.
 * This protects cPanel shared hosting accounts from inode exhaustion (avoiding hundreds of tiny JSON files).
 * 
 * @param {string} sessionId Identifier for the WhatsApp session (default: 'default')
 * @param {Object} db Database connection or pool
 */
export async function useMySQLAuthState(sessionId = 'default', db = pool) {
  // Read key-value pair from sys_baileys_auth
  const readData = async (key) => {
    try {
      const [rows] = await db.query(
        `SELECT data_value FROM sys_baileys_auth WHERE session_id = ? AND data_key = ?`,
        [sessionId, key]
      );
      if (!rows.length) return null;
      return JSON.parse(rows[0].data_value, BufferJSON.reviver);
    } catch (err) {
      console.error(`[Baileys MySQL Auth] Error reading key ${key}:`, err.message);
      return null;
    }
  };

  // Write key-value pair into sys_baileys_auth
  const writeData = async (key, value) => {
    try {
      const serialized = JSON.stringify(value, BufferJSON.replacer);
      await db.execute(
        `INSERT INTO sys_baileys_auth (session_id, data_key, data_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data_value = VALUES(data_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [sessionId, key, serialized]
      );
    } catch (err) {
      console.error(`[Baileys MySQL Auth] Error writing key ${key}:`, err.message);
    }
  };

  // Remove key from sys_baileys_auth
  const removeData = async (key) => {
    try {
      await db.execute(
        `DELETE FROM sys_baileys_auth WHERE session_id = ? AND data_key = ?`,
        [sessionId, key]
      );
    } catch (err) {
      console.error(`[Baileys MySQL Auth] Error deleting key ${key}:`, err.message);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                await writeData(key, value);
              } else {
                await removeData(key);
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
  };
}

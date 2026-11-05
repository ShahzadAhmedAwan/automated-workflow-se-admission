import fs from 'node:fs';
import path from 'node:path';
import { BufferJSON } from '@whiskeysockets/baileys';
import { pool } from '../src/core/db/pool.js';

import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

async function importCredentials() {
  const sourceAuthDir = path.resolve(here, '..', '..', 'whatsapp-bot', 'data', 'auth');
  const sessionId = 'default';

  console.log(`Checking for existing credentials in: ${sourceAuthDir}`);

  if (!fs.existsSync(sourceAuthDir)) {
    console.error(`Directory not found: ${sourceAuthDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(sourceAuthDir).filter((f) => f.endsWith('.json'));
  console.log(`Found ${files.length} authentication credential files.`);

  let importedCount = 0;
  for (const file of files) {
    const key = file.replace(/\.json$/, '');
    const filePath = path.join(sourceAuthDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // Validate that it parses as JSON
      const parsed = JSON.parse(content, BufferJSON.reviver);
      const serialized = JSON.stringify(parsed, BufferJSON.replacer);

      await pool.execute(
        `INSERT INTO sys_baileys_auth (session_id, data_key, data_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data_value = VALUES(data_value), updated_at = CURRENT_TIMESTAMP(3)`,
        [sessionId, key, serialized]
      );
      importedCount++;
    } catch (err) {
      console.warn(`Could not import ${file}: ${err.message}`);
    }
  }

  console.log(`\n🎉 Successfully imported ${importedCount} keys into database table 'sys_baileys_auth' for session '${sessionId}'!`);
  console.log('Your WhatsApp connection is now ready to connect with your existing number without re-scanning QR.');
  await pool.end();
}

importCredentials().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/core/db/pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, '..', 'database', 'schema.sql');
const source = await readFile(schemaPath, 'utf8');
const statements = source.split(';').map((sql) => sql.trim()).filter(Boolean);
const connection = await pool.getConnection();

try {
  console.info(`Applying ${statements.length} statements from database/schema.sql`);
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await connection.query(statements[index]);
    } catch (error) {
      throw new Error(`Schema statement ${index + 1} failed: ${error.message}`, { cause: error });
    }
  }
  console.info('Canonical database schema is ready.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}

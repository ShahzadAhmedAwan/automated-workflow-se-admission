import { createApp } from './app.js';
import { config } from './core/config/env.js';
import { closePool } from './core/db/pool.js';
import { startOutboxWorker } from './core/queue/outboxBus.js';

const app = createApp();
const stopOutboxWorker = startOutboxWorker();
const server = app.listen(config.PORT, () => {
  console.info(`SE Admissions API listening on port ${config.PORT}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; shutting down gracefully.`);
  server.close(async (error) => {
    await stopOutboxWorker();
    try { await closePool(); } catch (closeError) { console.error('Database pool shutdown failed:', closeError); }
    if (error) { console.error('HTTP server shutdown failed:', error); process.exitCode = 1; }
  });
  setTimeout(() => { console.error('Graceful shutdown timed out.'); process.exit(1); }, 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

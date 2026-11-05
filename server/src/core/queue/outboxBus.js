import { randomUUID } from 'node:crypto';
import cron from 'node-cron';
import { pool } from '../db/pool.js';

const handlers = new Map();
const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MINUTES = [1, 5, 15];

export async function dispatchJob({ queueName = 'default', jobType, payload, availableAt = new Date(), connection = pool }) {
  if (!jobType || typeof jobType !== 'string') throw new TypeError('jobType is required.');
  if (payload === undefined || payload === null) throw new TypeError('payload is required.');
  const [result] = await connection.execute(
    `INSERT INTO outbox_jobs (queue_name, job_type, payload, available_at)
     VALUES (?, ?, ?, ?)`,
    [queueName, jobType, JSON.stringify(payload), availableAt],
  );
  return result.insertId;
}

export function registerJobHandler(jobType, handler) {
  if (!jobType || typeof handler !== 'function') throw new TypeError('A job type and handler function are required.');
  // allow register
  handlers.set(jobType, handler);
  return () => handlers.delete(jobType);
}

export async function claimJobs({ batchSize = 5, lockOwner = randomUUID(), staleAfterSeconds = 120, jobTypes = [] } = {}) {
  if (!jobTypes.length) return { lockOwner, jobs: [] };
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // Lock the rows through the status update; omit SKIP LOCKED for MariaDB compatibility.
    const [rows] = await connection.query(
      `SELECT id, queue_name, job_type, payload, attempts
         FROM outbox_jobs
        WHERE ((status = 'PENDING' AND available_at <= CURRENT_TIMESTAMP(3))
           OR (status = 'PROCESSING' AND locked_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)))
          AND job_type IN (${jobTypes.map(() => '?').join(', ')})
        ORDER BY available_at, id
        LIMIT ? FOR UPDATE`,
      [staleAfterSeconds, ...jobTypes, batchSize],
    );
    for (const row of rows) {
      await connection.execute(
        `UPDATE outbox_jobs SET status = 'PROCESSING', attempts = attempts + 1,
          locked_at = CURRENT_TIMESTAMP(3), lock_owner = ? WHERE id = ?`, [lockOwner, row.id],
      );
    }
    await connection.commit();
    return { lockOwner, jobs: rows.map((row) => ({ ...row, attempts: row.attempts + 1, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload })) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function completeJob(jobId, lockOwner) {
  await pool.execute(
    `UPDATE outbox_jobs SET status = 'COMPLETED', locked_at = NULL, lock_owner = NULL, last_error = NULL
      WHERE id = ? AND status = 'PROCESSING' AND lock_owner = ?`, [jobId, lockOwner],
  );
}

async function extendLease(jobId, lockOwner) {
  await pool.execute(
    `UPDATE outbox_jobs SET locked_at = CURRENT_TIMESTAMP(3)
      WHERE id = ? AND status = 'PROCESSING' AND lock_owner = ?`, [jobId, lockOwner],
  );
}

async function retryJob(job, lockOwner, error) {
  const message = String(error?.message ?? error).slice(0, 4000);
  if (job.attempts >= MAX_ATTEMPTS) {
    await pool.execute(
      `UPDATE outbox_jobs SET status = 'FAILED', locked_at = NULL, lock_owner = NULL, last_error = ?
        WHERE id = ? AND status = 'PROCESSING' AND lock_owner = ?`, [message, job.id, lockOwner],
    );
    return;
  }
  const delayMinutes = RETRY_DELAY_MINUTES[job.attempts - 1] ?? RETRY_DELAY_MINUTES.at(-1);
  await pool.execute(
    `UPDATE outbox_jobs SET status = 'PENDING', available_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MINUTE),
      locked_at = NULL, lock_owner = NULL, last_error = ?
      WHERE id = ? AND status = 'PROCESSING' AND lock_owner = ?`,
    [delayMinutes, message, job.id, lockOwner],
  );
}

export async function processOutboxBatch(options = {}) {
  const { lockOwner, jobs } = await claimJobs({ ...options, jobTypes: [...handlers.keys()] });
  for (const job of jobs) {
    const handler = handlers.get(job.job_type);
    const heartbeat = setInterval(() => {
      void extendLease(job.id, lockOwner).catch((error) => console.error(`Could not extend outbox job ${job.id} lease:`, error));
    }, 30_000);
    try {
      if (!handler) throw new Error(`No handler registered for outbox job type ${job.job_type}.`);
      await handler(job.payload, { id: job.id, attempts: job.attempts, queueName: job.queue_name });
      await completeJob(job.id, lockOwner);
    } catch (error) {
      console.error(`Outbox job ${job.id} (${job.job_type}) failed:`, error);
      await retryJob(job, lockOwner, error);
    } finally {
      clearInterval(heartbeat);
    }
  }
  return jobs.length;
}

export function startOutboxWorker({ intervalMs = 5000, batchSize = 5 } = {}) {
  let stopped = false;
  let running = null;
  const seconds = Math.max(1, Math.ceil(intervalMs / 1000));
  const task = cron.schedule(`*/${seconds} * * * * *`, async () => {
    if (stopped || handlers.size === 0) return;
    running = processOutboxBatch({ batchSize })
      .catch((error) => console.error('Outbox polling failed:', error))
      .finally(() => { running = null; });
    await running;
  }, { noOverlap: true, timezone: 'UTC' });
  return async () => {
    stopped = true;
    task.stop();
    if (running) await running;
    task.destroy();
  };
}

import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

export const pool = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: config.DB_CONNECTION_LIMIT,
  queueLimit: 0,
  enableKeepAlive: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
  timezone: 'Z',
  ...(config.DB_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
});

export async function closePool() {
  await pool.end();
}

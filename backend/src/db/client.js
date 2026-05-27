import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));

/*
  Main pool for app queries
*/
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/*
  Direct connection for migrations
*/
const migrationPool = new Pool({
  connectionString: process.env.DIRECT_URL,

  ssl: {
    rejectUnauthorized: false,
  },

  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('[DB] Connected to Supabase');
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

export async function migrate() {
  const schema = readFileSync(
    join(__dirname, '../../db/schema.sql'),
    'utf-8'
  );

  const client = await migrationPool.connect();

  try {
    await client.query(schema);
    console.log('[DB] Schema applied successfully');
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  try {
    const res = await pool.query(text, params);
    return res;
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}
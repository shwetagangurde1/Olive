import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/llm_observatory',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export async function migrate() {
  const schema = readFileSync(join(__dirname, '../../db/schema.sql'), 'utf-8');
  const client = await pool.connect();
  try {
    await client.query(schema);
    console.log('[DB] Schema applied successfully');
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

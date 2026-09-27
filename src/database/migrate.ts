import '../config/env.js';

import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new Pool({ connectionString: databaseUrl });
const migrationSql = await readFile(new URL('./migrations/0000_initial.sql', import.meta.url), 'utf8');

try {
  await pool.query(migrationSql);
} finally {
  await pool.end();
}

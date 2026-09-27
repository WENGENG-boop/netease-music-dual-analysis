import '../../src/config/env.js';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const expectedTables = [
  'users',
  'pair_spaces',
  'pair_members',
  'pair_invites',
  'moods',
  'playlists',
  'playlist_snapshots',
  'playlist_snapshot_tracks',
  'tracks',
  'provider_tracks',
  'artists',
  'track_artists',
  'albums',
  'music_connections',
  'provider_authorization_attempts',
  'listening_sessions',
  'session_queue_items',
  'playback_instances',
  'listening_events',
  'event_batches',
  'session_track_reactions',
  'playback_instance_stats',
  'session_track_stats',
  'session_summaries',
  'auth_sessions',
  'audit_logs',
  'playback_tokens',
  'provider_cache',
];

const runIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

runIfDatabase('database migration', () => {
  it('can run on an empty PostgreSQL schema more than once and creates the required domain tables', async () => {
    const schemaName = `it_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${schemaName}`,
    });

    await admin.query(`CREATE SCHEMA "${schemaName}"`);

    try {
      const migrationSql = await readFile(new URL('../../src/database/migrations/0000_initial.sql', import.meta.url), 'utf8');
      await pool.query(migrationSql);
      await pool.query(migrationSql);

      const tables = await admin.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schemaName],
      );

      expect(tables.rows.map((row) => row.table_name).sort()).toEqual([...expectedTables].sort());

      const eventBatchIndexes = await admin.query<{ tablename: string; indexname: string; indexdef: string }>(
        `SELECT tablename, indexname, indexdef
         FROM pg_indexes
         WHERE schemaname = $1 AND tablename IN ('event_batches', 'listening_events')`,
        [schemaName],
      );

      expect(eventBatchIndexes.rows.some((row) => row.tablename === 'event_batches' && row.indexdef.includes('batch_id'))).toBe(true);
      expect(
        eventBatchIndexes.rows.some(
          (row) => row.tablename === 'listening_events' && row.indexdef.includes('batch_id') && row.indexdef.includes('UNIQUE'),
        ),
      ).toBe(false);

      const seededMoods = await pool.query<{ count: string }>(`SELECT count(*) FROM moods WHERE pair_id IS NULL`);
      expect(Number(seededMoods.rows[0]?.count)).toBeGreaterThanOrEqual(5);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });
});

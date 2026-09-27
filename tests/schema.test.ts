import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { schema } from '../src/database/schema.js';

const requiredSchemaExports = [
  'users',
  'pairSpaces',
  'pairMembers',
  'pairInvites',
  'moods',
  'playlists',
  'playlistSnapshots',
  'playlistSnapshotTracks',
  'tracks',
  'providerTracks',
  'artists',
  'trackArtists',
  'albums',
  'musicConnections',
  'providerAuthorizationAttempts',
  'sessions',
  'sessionQueueItems',
  'playbackInstances',
  'listeningEvents',
  'eventBatches',
  'sessionTrackReactions',
  'playbackInstanceStats',
  'sessionTrackStats',
  'sessionSummaries',
  'authSessions',
  'auditLogs',
  'playbackTokens',
  'providerCache',
];

const requiredMigrationTables = [
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

const migrationSql = readFileSync(new URL('../src/database/migrations/0000_initial.sql', import.meta.url), 'utf8');

describe('phase 1 schema baseline', () => {
  it('exports every required domain table in the Drizzle schema', () => {
    expect(Object.keys(schema).sort()).toEqual([...requiredSchemaExports].sort());
  });

  it('creates every required domain table in the SQL migration', () => {
    for (const table of requiredMigrationTables) {
      expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('keeps event batch idempotency on event_batches, not listening_events', () => {
    const eventBatchesBlock = migrationSql.match(/CREATE TABLE IF NOT EXISTS event_batches \([\s\S]*?\n\);/)?.[0] ?? '';
    const listeningEventsBlock = migrationSql.match(/CREATE TABLE IF NOT EXISTS listening_events \([\s\S]*?\n\);/)?.[0] ?? '';

    expect(eventBatchesBlock).toContain('UNIQUE (session_id, batch_id)');
    expect(listeningEventsBlock).toContain('UNIQUE (session_id, seq)');
    expect(listeningEventsBlock).not.toContain('UNIQUE (session_id, batch_id)');
  });

  it('makes raw events append-only at the database boundary', () => {
    expect(migrationSql).toContain('CREATE OR REPLACE FUNCTION forbid_listening_events_mutation()');
    expect(migrationSql).toContain('CREATE TRIGGER listening_events_append_only');
    expect(migrationSql).toContain('BEFORE UPDATE OR DELETE ON listening_events');
  });

  it('seeds only system moods in the initial migration', () => {
    expect(migrationSql).toContain('INSERT INTO moods');
    expect(migrationSql).not.toMatch(/INSERT\s+INTO\s+users/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+PASSWORD|password123|changeme/i);
  });
});

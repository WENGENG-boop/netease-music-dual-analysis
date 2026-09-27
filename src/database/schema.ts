import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

const metadata = (name = 'metadata') => jsonb(name).$type<Record<string, unknown>>().notNull().default({});
const nullableMetadata = (name = 'metadata') => jsonb(name).$type<Record<string, unknown>>();
const ratio = (name = 'coverage_ratio') => numeric(name, { precision: 7, scale: 6 }).notNull().default('0');

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pairSpaces = pgTable('pair_spaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const pairMembers = pgTable(
  'pair_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairId: uuid('pair_id')
      .references(() => pairSpaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    memberSlot: integer('member_slot').notNull(),
    role: text('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pairUserUnique: uniqueIndex('pair_members_pair_user_unique').on(table.pairId, table.userId),
    pairSlotUnique: uniqueIndex('pair_members_pair_slot_unique').on(table.pairId, table.memberSlot),
    userIdx: index('pair_members_user_idx').on(table.userId),
  }),
);

export const pairInvites = pgTable(
  'pair_invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairId: uuid('pair_id')
      .references(() => pairSpaces.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ pairIdx: index('pair_invites_pair_idx').on(table.pairId) }),
);

export const moods = pgTable(
  'moods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairId: uuid('pair_id').references(() => pairSpaces.id, { onDelete: 'cascade' }),
    systemKey: text('system_key'),
    name: text('name').notNull(),
    emoji: text('emoji'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    systemKeyUnique: uniqueIndex('moods_system_key_unique')
      .on(table.systemKey)
      .where(sql`pair_id IS NULL AND system_key IS NOT NULL`),
    pairNameUnique: uniqueIndex('moods_pair_name_unique').on(table.pairId, table.name),
  }),
);

export const albums = pgTable('albums', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  metadata: metadata(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const artists = pgTable(
  'artists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    metadata: metadata(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ nameUnique: uniqueIndex('artists_name_unique').on(table.name) }),
);

export const tracks = pgTable('tracks', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  durationMs: integer('duration_ms'),
  isrc: text('isrc'),
  albumId: uuid('album_id').references(() => albums.id, { onDelete: 'set null' }),
  metadata: metadata(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const providerTracks = pgTable(
  'provider_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    providerTrackId: text('provider_track_id').notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    durationMs: integer('duration_ms'),
    rawMetadata: metadata('raw_metadata'),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdUnique: uniqueIndex('provider_tracks_provider_id_unique').on(table.provider, table.providerTrackId),
    trackIdx: index('provider_tracks_track_idx').on(table.trackId),
  }),
);

export const trackArtists = pgTable(
  'track_artists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'cascade' })
      .notNull(),
    artistId: uuid('artist_id')
      .references(() => artists.id, { onDelete: 'cascade' })
      .notNull(),
    position: integer('position').notNull().default(0),
  },
  (table) => ({
    trackArtistUnique: uniqueIndex('track_artists_track_artist_unique').on(table.trackId, table.artistId),
    trackPositionUnique: uniqueIndex('track_artists_track_position_unique').on(table.trackId, table.position),
  }),
);

export const playlists = pgTable(
  'playlists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairId: uuid('pair_id')
      .references(() => pairSpaces.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    providerPlaylistId: text('provider_playlist_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    coverUrl: text('cover_url'),
    currentSnapshotId: uuid('current_snapshot_id'),
    importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: metadata(),
    ...timestamps(),
  },
  (table) => ({
    providerPlaylistUnique: uniqueIndex('playlists_provider_playlist_unique').on(table.provider, table.providerPlaylistId),
    pairIdx: index('playlists_pair_idx').on(table.pairId),
  }),
);

export const playlistSnapshots = pgTable(
  'playlist_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playlistId: uuid('playlist_id')
      .references(() => playlists.id, { onDelete: 'cascade' })
      .notNull(),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    trackCount: integer('track_count').notNull().default(0),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: metadata(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    playlistVersionUnique: uniqueIndex('playlist_snapshots_playlist_version_unique').on(table.playlistId, table.version),
    playlistHashUnique: uniqueIndex('playlist_snapshots_playlist_hash_unique').on(table.playlistId, table.contentHash),
  }),
);

export const playlistSnapshotTracks = pgTable(
  'playlist_snapshot_tracks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playlistSnapshotId: uuid('playlist_snapshot_id')
      .references(() => playlistSnapshots.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    providerTrackId: uuid('provider_track_id').references(() => providerTracks.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    titleSnapshot: text('title_snapshot').notNull(),
    durationMsSnapshot: integer('duration_ms_snapshot'),
    metadata: metadata(),
  },
  (table) => ({
    snapshotPositionUnique: uniqueIndex('playlist_snapshot_tracks_snapshot_position_unique').on(
      table.playlistSnapshotId,
      table.position,
    ),
    snapshotTrackIdx: index('playlist_snapshot_tracks_track_idx').on(table.trackId),
  }),
);

export const musicConnections = pgTable(
  'music_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('active'),
    displayName: text('display_name'),
    credentialCiphertext: text('credential_ciphertext'),
    credentialIv: text('credential_iv'),
    credentialAuthTag: text('credential_auth_tag'),
    credentialVersion: integer('credential_version').notNull().default(1),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    providerUserSnapshot: nullableMetadata('provider_user_snapshot'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => ({ userProviderUnique: uniqueIndex('music_connections_user_provider_unique').on(table.userId, table.provider) }),
);

export const providerAuthorizationAttempts = pgTable(
  'provider_authorization_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('pending'),
    stateHash: text('state_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: metadata(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ userProviderIdx: index('provider_authorization_attempts_user_provider_idx').on(table.userId, table.provider) }),
);

export const sessions = pgTable(
  'listening_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairId: uuid('pair_id')
      .references(() => pairSpaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    playlistId: uuid('playlist_id').references(() => playlists.id, { onDelete: 'set null' }),
    playlistSnapshotId: uuid('playlist_snapshot_id').references(() => playlistSnapshots.id, { onDelete: 'set null' }),
    moodId: uuid('mood_id').references(() => moods.id, { onDelete: 'set null' }),
    moodNameSnapshot: text('mood_name_snapshot').notNull(),
    moodEmojiSnapshot: text('mood_emoji_snapshot'),
    moodIntensity: integer('mood_intensity').notNull(),
    visibility: text('visibility').notNull().default('full'),
    playMode: text('play_mode').notNull().default('ordered'),
    timezoneSnapshot: text('timezone_snapshot').notNull(),
    localStartedDate: date('local_started_date').notNull(),
    status: text('status').notNull().default('CREATED'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    clientVersion: text('client_version'),
    analyticsVersion: integer('analytics_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userStatusIdx: index('sessions_user_status_idx').on(table.userId, table.status),
    pairStartedIdx: index('sessions_pair_started_idx').on(table.pairId, table.startedAt),
    activeUserUnique: uniqueIndex('sessions_user_one_active_unique').on(table.userId).where(sql`status = 'ACTIVE'`),
  }),
);

export const sessionQueueItems = pgTable(
  'session_queue_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    queueIndex: integer('queue_index').notNull(),
    sourcePosition: integer('source_position'),
    playlistSnapshotTrackId: uuid('playlist_snapshot_track_id').references(() => playlistSnapshotTracks.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionQueueIndexUnique: uniqueIndex('session_queue_items_session_queue_index_unique').on(table.sessionId, table.queueIndex),
    sessionTrackIdx: index('session_queue_items_session_track_idx').on(table.sessionId, table.trackId),
  }),
);

export const playbackInstances = pgTable(
  'playback_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    queueItemId: uuid('queue_item_id').references(() => sessionQueueItems.id, { onDelete: 'set null' }),
    sequence: integer('sequence').notNull(),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    selectionSource: text('selection_source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    initialPositionMs: integer('initial_position_ms').notNull().default(0),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endPositionMs: integer('end_position_ms'),
    endedReason: text('ended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionSequenceUnique: uniqueIndex('playback_instances_session_sequence_unique').on(table.sessionId, table.sequence),
    sessionTrackIdx: index('playback_instances_session_track_idx').on(table.sessionId, table.trackId),
  }),
);

export const eventBatches = pgTable(
  'event_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    batchId: uuid('batch_id').notNull(),
    eventCount: integer('event_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ sessionBatchUnique: uniqueIndex('event_batches_session_batch_unique').on(table.sessionId, table.batchId) }),
);

export const listeningEvents = pgTable(
  'listening_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    playbackInstanceId: uuid('playback_instance_id')
      .references(() => playbackInstances.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    seq: integer('seq').notNull(),
    batchId: uuid('batch_id').notNull(),
    eventType: text('event_type').notNull(),
    positionMs: integer('position_ms').notNull(),
    durationMs: integer('duration_ms'),
    clientWallTime: timestamp('client_wall_time', { withTimezone: true }).notNull(),
    clientMonotonicMs: integer('client_monotonic_ms'),
    serverReceivedAt: timestamp('server_received_at', { withTimezone: true }).defaultNow().notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    metadata: metadata(),
  },
  (table) => ({
    sessionSeqUnique: uniqueIndex('listening_events_session_seq_unique').on(table.sessionId, table.seq),
    sessionReceivedIdx: index('listening_events_session_received_idx').on(table.sessionId, table.serverReceivedAt),
    playbackInstanceIdx: index('listening_events_playback_instance_idx').on(table.playbackInstanceId),
  }),
);

export const sessionTrackReactions = pgTable(
  'session_track_reactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    heartedFinal: boolean('hearted_final').notNull().default(false),
    heartToggleCount: integer('heart_toggle_count').notNull().default(0),
    lastEventSeq: integer('last_event_seq'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ sessionTrackUnique: uniqueIndex('session_track_reactions_session_track_unique').on(table.sessionId, table.trackId) }),
);

export const playbackInstanceStats = pgTable(
  'playback_instance_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    playbackInstanceId: uuid('playback_instance_id')
      .references(() => playbackInstances.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    totalListenMs: integer('total_listen_ms').notNull().default(0),
    coveredMs: integer('covered_ms').notNull().default(0),
    coverageRatio: ratio(),
    naturalCompleted: boolean('natural_completed').notNull().default(false),
    endedReason: text('ended_reason'),
    seekCount: integer('seek_count').notNull().default(0),
    analyticsVersion: integer('analytics_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ playbackInstanceUnique: uniqueIndex('playback_instance_stats_instance_unique').on(table.playbackInstanceId) }),
);

export const sessionTrackStats = pgTable(
  'session_track_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    playCount: integer('play_count').notNull().default(0),
    totalListenMs: integer('total_listen_ms').notNull().default(0),
    coveredMs: integer('covered_ms').notNull().default(0),
    coverageRatio: ratio(),
    naturalCompletionCount: integer('natural_completion_count').notNull().default(0),
    manualSkipCount: integer('manual_skip_count').notNull().default(0),
    earlySkipCount: integer('early_skip_count').notNull().default(0),
    replayCount: integer('replay_count').notNull().default(0),
    returnCount: integer('return_count').notNull().default(0),
    seekCount: integer('seek_count').notNull().default(0),
    heartedFinal: boolean('hearted_final').notNull().default(false),
    heartToggleCount: integer('heart_toggle_count').notNull().default(0),
    analyticsVersion: integer('analytics_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ sessionTrackUnique: uniqueIndex('session_track_stats_session_track_unique').on(table.sessionId, table.trackId) }),
);

export const sessionSummaries = pgTable(
  'session_summaries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    trackCount: integer('track_count').notNull().default(0),
    playCount: integer('play_count').notNull().default(0),
    totalListenMs: integer('total_listen_ms').notNull().default(0),
    coveredMs: integer('covered_ms').notNull().default(0),
    coverageRatio: ratio(),
    naturalCompletionCount: integer('natural_completion_count').notNull().default(0),
    manualSkipCount: integer('manual_skip_count').notNull().default(0),
    earlySkipCount: integer('early_skip_count').notNull().default(0),
    replayCount: integer('replay_count').notNull().default(0),
    returnCount: integer('return_count').notNull().default(0),
    heartCount: integer('heart_count').notNull().default(0),
    dataQuality: text('data_quality').notNull().default('insufficient'),
    analyticsVersion: integer('analytics_version').notNull().default(1),
    builtAt: timestamp('built_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ sessionUnique: uniqueIndex('session_summaries_session_unique').on(table.sessionId) }),
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ userIdx: index('auth_sessions_user_idx').on(table.userId) }),
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    pairId: uuid('pair_id').references(() => pairSpaces.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    requestId: text('request_id'),
    metadata: metadata(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ userIdx: index('audit_logs_user_idx').on(table.userId), pairIdx: index('audit_logs_pair_idx').on(table.pairId) }),
);

export const playbackTokens = pgTable(
  'playback_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    pairId: uuid('pair_id')
      .references(() => pairSpaces.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
    trackId: uuid('track_id')
      .references(() => tracks.id, { onDelete: 'restrict' })
      .notNull(),
    musicConnectionId: uuid('music_connection_id').references(() => musicConnections.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    quality: text('quality').notNull().default('standard'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    metadata: metadata(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ userIdx: index('playback_tokens_user_idx').on(table.userId), expiresIdx: index('playback_tokens_expires_idx').on(table.expiresAt) }),
);

export const providerCache = pgTable(
  'provider_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(),
    cacheKey: text('cache_key').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({ providerKeyUnique: uniqueIndex('provider_cache_provider_key_unique').on(table.provider, table.cacheKey) }),
);

export const schema = {
  users,
  pairSpaces,
  pairMembers,
  pairInvites,
  moods,
  playlists,
  playlistSnapshots,
  playlistSnapshotTracks,
  tracks,
  providerTracks,
  artists,
  trackArtists,
  albums,
  musicConnections,
  providerAuthorizationAttempts,
  sessions,
  sessionQueueItems,
  playbackInstances,
  listeningEvents,
  eventBatches,
  sessionTrackReactions,
  playbackInstanceStats,
  sessionTrackStats,
  sessionSummaries,
  authSessions,
  auditLogs,
  playbackTokens,
  providerCache,
};

export type Schema = typeof schema;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pair_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pair_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES pair_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_slot integer NOT NULL CHECK (member_slot BETWEEN 1 AND 2),
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_id, user_id),
  UNIQUE (pair_id, member_slot)
);
CREATE INDEX IF NOT EXISTS pair_members_user_idx ON pair_members(user_id);

CREATE TABLE IF NOT EXISTS pair_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES pair_spaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pair_invites_pair_idx ON pair_invites(pair_id);

CREATE TABLE IF NOT EXISTS moods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid REFERENCES pair_spaces(id) ON DELETE CASCADE,
  system_key text,
  name text NOT NULL,
  emoji text,
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS moods_system_key_unique ON moods(system_key) WHERE pair_id IS NULL AND system_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS moods_pair_name_unique ON moods(pair_id, name);

CREATE TABLE IF NOT EXISTS albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0),
  isrc text,
  album_id uuid REFERENCES albums(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_track_id text NOT NULL,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  title text NOT NULL,
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0),
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_track_id)
);
CREATE INDEX IF NOT EXISTS provider_tracks_track_idx ON provider_tracks(track_id);

CREATE TABLE IF NOT EXISTS track_artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  UNIQUE (track_id, artist_id),
  UNIQUE (track_id, position)
);

CREATE TABLE IF NOT EXISTS playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES pair_spaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_playlist_id text NOT NULL,
  name text NOT NULL,
  description text,
  cover_url text,
  current_snapshot_id uuid,
  imported_by uuid REFERENCES users(id) ON DELETE SET NULL,
  provider_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_playlist_id)
);
CREATE INDEX IF NOT EXISTS playlists_pair_idx ON playlists(pair_id);

CREATE TABLE IF NOT EXISTS playlist_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content_hash text NOT NULL,
  track_count integer NOT NULL DEFAULT 0 CHECK (track_count >= 0),
  provider_updated_at timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playlist_id, version),
  UNIQUE (playlist_id, content_hash)
);

CREATE TABLE IF NOT EXISTS playlist_snapshot_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_snapshot_id uuid NOT NULL REFERENCES playlist_snapshots(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  provider_track_id uuid REFERENCES provider_tracks(id) ON DELETE SET NULL,
  position integer NOT NULL CHECK (position >= 0),
  title_snapshot text NOT NULL,
  duration_ms_snapshot integer CHECK (duration_ms_snapshot IS NULL OR duration_ms_snapshot > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (playlist_snapshot_id, position)
);
CREATE INDEX IF NOT EXISTS playlist_snapshot_tracks_track_idx ON playlist_snapshot_tracks(track_id);

CREATE TABLE IF NOT EXISTS music_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  display_name text,
  credential_ciphertext text,
  credential_iv text,
  credential_auth_tag text,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_user_snapshot jsonb,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS provider_authorization_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'expired', 'failed', 'cancelled')),
  state_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_authorization_attempts_user_provider_idx ON provider_authorization_attempts(user_id, provider);

CREATE TABLE IF NOT EXISTS listening_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id uuid NOT NULL REFERENCES pair_spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id uuid REFERENCES playlists(id) ON DELETE SET NULL,
  playlist_snapshot_id uuid REFERENCES playlist_snapshots(id) ON DELETE SET NULL,
  mood_id uuid REFERENCES moods(id) ON DELETE SET NULL,
  mood_name_snapshot text NOT NULL,
  mood_emoji_snapshot text,
  mood_intensity integer NOT NULL CHECK (mood_intensity BETWEEN 1 AND 5),
  visibility text NOT NULL DEFAULT 'full' CHECK (visibility IN ('private', 'summary', 'full')),
  play_mode text NOT NULL DEFAULT 'ordered' CHECK (play_mode IN ('ordered', 'shuffle', 'repeat_all', 'repeat_one')),
  timezone_snapshot text NOT NULL,
  local_started_date date NOT NULL,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'ACTIVE', 'ENDING', 'ENDED', 'ABANDONED')),
  started_at timestamptz,
  last_event_at timestamptz,
  ended_at timestamptz,
  abandoned_at timestamptz,
  client_version text,
  analytics_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_status_idx ON listening_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS sessions_pair_started_idx ON listening_sessions(pair_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_one_active_unique ON listening_sessions(user_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS session_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  queue_index integer NOT NULL CHECK (queue_index >= 0),
  source_position integer CHECK (source_position IS NULL OR source_position >= 0),
  playlist_snapshot_track_id uuid REFERENCES playlist_snapshot_tracks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, queue_index)
);
CREATE INDEX IF NOT EXISTS session_queue_items_session_track_idx ON session_queue_items(session_id, track_id);

CREATE TABLE IF NOT EXISTS playback_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  queue_item_id uuid REFERENCES session_queue_items(id) ON DELETE SET NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  started_by uuid REFERENCES users(id) ON DELETE SET NULL,
  selection_source text NOT NULL CHECK (selection_source IN ('queue', 'shuffle', 'repeat', 'manual_next', 'manual_previous', 'track_select', 'resume')),
  started_at timestamptz NOT NULL DEFAULT now(),
  initial_position_ms integer NOT NULL DEFAULT 0 CHECK (initial_position_ms >= 0),
  ended_at timestamptz,
  end_position_ms integer CHECK (end_position_ms IS NULL OR end_position_ms >= 0),
  ended_reason text CHECK (ended_reason IS NULL OR ended_reason IN ('natural', 'manual_next', 'manual_previous', 'track_select', 'pause_timeout', 'session_end', 'page_close', 'abandoned', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);
CREATE INDEX IF NOT EXISTS playback_instances_session_track_idx ON playback_instances(session_id, track_id);

CREATE TABLE IF NOT EXISTS event_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  event_count integer NOT NULL CHECK (event_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, batch_id)
);

CREATE TABLE IF NOT EXISTS listening_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  playback_instance_id uuid NOT NULL REFERENCES playback_instances(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  seq integer NOT NULL CHECK (seq > 0),
  batch_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('play', 'pause', 'resume', 'seek', 'heartbeat', 'buffer_start', 'buffer_end', 'track_end', 'session_end', 'page_close', 'manual_next', 'manual_previous', 'track_select', 'heart_on', 'heart_off')),
  position_ms integer NOT NULL CHECK (position_ms >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0),
  client_wall_time timestamptz NOT NULL,
  client_monotonic_ms integer CHECK (client_monotonic_ms IS NULL OR client_monotonic_ms >= 0),
  server_received_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS listening_events_session_received_idx ON listening_events(session_id, server_received_at);
CREATE INDEX IF NOT EXISTS listening_events_playback_instance_idx ON listening_events(playback_instance_id);
ALTER TABLE listening_events DROP CONSTRAINT IF EXISTS listening_events_session_id_batch_id_key;
DROP INDEX IF EXISTS events_session_batch;

CREATE OR REPLACE FUNCTION forbid_listening_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'listening_events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS listening_events_append_only ON listening_events;
CREATE TRIGGER listening_events_append_only
BEFORE UPDATE OR DELETE ON listening_events
FOR EACH ROW EXECUTE FUNCTION forbid_listening_events_mutation();

CREATE TABLE IF NOT EXISTS session_track_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  hearted_final boolean NOT NULL DEFAULT false,
  heart_toggle_count integer NOT NULL DEFAULT 0 CHECK (heart_toggle_count >= 0),
  last_event_seq integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, track_id)
);

CREATE TABLE IF NOT EXISTS playback_instance_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playback_instance_id uuid NOT NULL UNIQUE REFERENCES playback_instances(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  total_listen_ms integer NOT NULL DEFAULT 0 CHECK (total_listen_ms >= 0),
  covered_ms integer NOT NULL DEFAULT 0 CHECK (covered_ms >= 0),
  coverage_ratio numeric(7,6) NOT NULL DEFAULT 0 CHECK (coverage_ratio >= 0 AND coverage_ratio <= 1),
  natural_completed boolean NOT NULL DEFAULT false,
  ended_reason text,
  seek_count integer NOT NULL DEFAULT 0 CHECK (seek_count >= 0),
  analytics_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_track_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  play_count integer NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  total_listen_ms integer NOT NULL DEFAULT 0 CHECK (total_listen_ms >= 0),
  covered_ms integer NOT NULL DEFAULT 0 CHECK (covered_ms >= 0),
  coverage_ratio numeric(7,6) NOT NULL DEFAULT 0 CHECK (coverage_ratio >= 0 AND coverage_ratio <= 1),
  natural_completion_count integer NOT NULL DEFAULT 0 CHECK (natural_completion_count >= 0),
  manual_skip_count integer NOT NULL DEFAULT 0 CHECK (manual_skip_count >= 0),
  early_skip_count integer NOT NULL DEFAULT 0 CHECK (early_skip_count >= 0),
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  return_count integer NOT NULL DEFAULT 0 CHECK (return_count >= 0),
  seek_count integer NOT NULL DEFAULT 0 CHECK (seek_count >= 0),
  hearted_final boolean NOT NULL DEFAULT false,
  heart_toggle_count integer NOT NULL DEFAULT 0 CHECK (heart_toggle_count >= 0),
  analytics_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, track_id),
  CHECK (covered_ms <= total_listen_ms OR total_listen_ms = 0),
  CHECK (early_skip_count <= manual_skip_count)
);

CREATE TABLE IF NOT EXISTS session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_count integer NOT NULL DEFAULT 0 CHECK (track_count >= 0),
  play_count integer NOT NULL DEFAULT 0 CHECK (play_count >= 0),
  total_listen_ms integer NOT NULL DEFAULT 0 CHECK (total_listen_ms >= 0),
  covered_ms integer NOT NULL DEFAULT 0 CHECK (covered_ms >= 0),
  coverage_ratio numeric(7,6) NOT NULL DEFAULT 0 CHECK (coverage_ratio >= 0 AND coverage_ratio <= 1),
  natural_completion_count integer NOT NULL DEFAULT 0 CHECK (natural_completion_count >= 0),
  manual_skip_count integer NOT NULL DEFAULT 0 CHECK (manual_skip_count >= 0),
  early_skip_count integer NOT NULL DEFAULT 0 CHECK (early_skip_count >= 0),
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  return_count integer NOT NULL DEFAULT 0 CHECK (return_count >= 0),
  heart_count integer NOT NULL DEFAULT 0 CHECK (heart_count >= 0),
  data_quality text NOT NULL DEFAULT 'insufficient' CHECK (data_quality IN ('insufficient', 'low', 'normal')),
  analytics_version integer NOT NULL DEFAULT 1,
  built_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (covered_ms <= total_listen_ms OR total_listen_ms = 0),
  CHECK (early_skip_count <= manual_skip_count)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  pair_id uuid REFERENCES pair_spaces(id) ON DELETE SET NULL,
  action text NOT NULL,
  request_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_pair_idx ON audit_logs(pair_id);

CREATE TABLE IF NOT EXISTS playback_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pair_id uuid NOT NULL REFERENCES pair_spaces(id) ON DELETE CASCADE,
  session_id uuid REFERENCES listening_sessions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  music_connection_id uuid REFERENCES music_connections(id) ON DELETE SET NULL,
  provider text NOT NULL,
  quality text NOT NULL DEFAULT 'standard',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS playback_tokens_user_idx ON playback_tokens(user_id);
CREATE INDEX IF NOT EXISTS playback_tokens_expires_idx ON playback_tokens(expires_at);

CREATE TABLE IF NOT EXISTS provider_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, cache_key)
);

INSERT INTO moods (system_key, name, emoji, sort_order)
SELECT system_key, name, emoji, sort_order
FROM (VALUES
  ('happy', 'Happy', '😊', 10),
  ('calm', 'Calm', '😌', 20),
  ('sad', 'Sad', '🌧️', 30),
  ('nostalgic', 'Nostalgic', '📻', 40),
  ('energetic', 'Energetic', '⚡', 50)
) AS seed(system_key, name, emoji, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM moods m WHERE m.pair_id IS NULL AND m.system_key = seed.system_key
);

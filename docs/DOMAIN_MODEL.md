# Domain model

A PairSpace contains at most two members. The database enforces this with explicit member slots `1` and `2`, plus a unique `(pair_id, member_slot)` constraint; invite acceptance locks the pair row before assigning a slot.

Mood belongs to a Session context. A session stores immutable mood snapshots (`mood_name_snapshot`, optional emoji, intensity) and optionally references a reusable mood record.

Playlist imports resolve Provider data into an internal catalog:

- Provider IDs live on `provider_tracks`; internal tables use UUIDs.
- Playlists have immutable `playlist_snapshots` and ordered `playlist_snapshot_tracks`.
- A session stores `playlist_snapshot_id` so later playlist changes cannot alter history.

Each independent play creates a `playback_instances` row with a per-session sequence number. `session_queue_items` freeze the queue actually used by the session.

Raw events are append-only and authoritative; the migration installs a trigger that rejects updates and deletes on `listening_events`. Idempotency is split deliberately:

- `event_batches` owns `UNIQUE(session_id, batch_id)`.
- `listening_events` owns `UNIQUE(session_id, seq)`.

Heart state is session-scoped via `session_track_reactions`; it is not a permanent liked-track flag. Analytics tables (`playback_instance_stats`, `session_track_stats`, `session_summaries`) are rebuildable from raw events.

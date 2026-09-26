# Domain model

A PairSpace contains at most two active members. Mood is snapshotted into a session. A playlist reference is expected to resolve to a versioned snapshot. Each play is a PlaybackInstance; events are append-only and idempotent by session/sequence and session/batch.

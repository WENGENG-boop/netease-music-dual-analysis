# Providers

`MusicProvider` is the business boundary. Business code consumes normalized playlists, tracks, lyrics, authorization states, and playback descriptors instead of raw provider responses.

Implemented provider modes:

- `mock`: deterministic test provider.
- `enhanced`: Netease Cloud Music API adapter for the current MVP.
- `official`: capability-limited adapter that throws `NOT_CONFIGURED` until a real official integration is available.
- `hybrid`: currently resolves to enhanced mode and leaves room for future official-first routing.

Provider guardrails:

- Playback uses normalized `PlaybackDescriptor` values.
- Provider failures use `ProviderError` codes.
- GET-like enhanced-provider requests use timeout and bounded exponential retry.
- `/song/url/match` is explicitly blocked; no cross-platform replacement source is used.
- Netease share-link parsing uses a host allowlist and rejects `localhost`, loopback/private IP ranges, `file`, `ftp`, and non-HTTP(S) protocols.

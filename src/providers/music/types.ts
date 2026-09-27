import { isIP } from 'node:net';

export type PlaybackUnavailableReason =
  | 'TRACK_NOT_FOUND'
  | 'COPYRIGHT_UNAVAILABLE'
  | 'VIP_REQUIRED'
  | 'ACCOUNT_REQUIRED'
  | 'REGION_RESTRICTED'
  | 'TRIAL_ONLY'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_AUTH_EXPIRED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNKNOWN_PROVIDER_ERROR';

export type ProviderErrorCode =
  | PlaybackUnavailableReason
  | 'INVALID_SHARE_LINK'
  | 'UNSAFE_SHARE_LINK'
  | 'UNSAFE_PROVIDER_ENDPOINT'
  | 'NOT_CONFIGURED'
  | 'UNSUPPORTED_OPERATION'
  | 'CIRCUIT_OPEN';

export type PlaybackDescriptor =
  | { kind: 'direct_url' | 'redirect' | 'external_player'; url: string; expiresAt?: Date; quality?: string }
  | { kind: 'unavailable'; reason: PlaybackUnavailableReason; message?: string };

export type ProviderCapabilities = {
  playlistRead: boolean;
  privatePlaylistRead: boolean;
  lyrics: boolean;
  wordByWordLyrics: boolean;
  directPlayback: boolean;
  accountAuthorization: boolean;
  likedTracks: boolean;
  userPlaylists: boolean;
};

export type ProviderPlaylist = {
  provider: 'mock' | 'netease';
  providerPlaylistId: string;
  name: string;
  description?: string;
  coverUrl?: string;
  providerUpdatedAt?: Date;
  raw?: unknown;
};

export type ProviderTrack = {
  provider: 'mock' | 'netease';
  providerTrackId: string;
  title: string;
  durationMs?: number;
  album?: { title: string };
  artists: Array<{ name: string }>;
  raw?: unknown;
};

export type ProviderAuthorization = {
  id: string;
  status: 'pending' | 'authorized' | 'expired' | 'failed' | 'cancelled';
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
};

export type ProviderUser = {
  provider: 'mock' | 'netease';
  providerUserId?: string;
  displayName?: string;
  raw?: unknown;
};

export interface MusicProvider {
  readonly name: 'mock' | 'netease-official' | 'netease-enhanced' | 'netease-hybrid';
  capabilities(): ProviderCapabilities;
  resolveShareLink(input: string): Promise<{ provider: 'mock' | 'netease'; providerPlaylistId: string }>;
  getPlaylist(id: string): Promise<ProviderPlaylist>;
  getPlaylistTracks(id: string): Promise<ProviderTrack[]>;
  getTrack(id: string): Promise<ProviderTrack>;
  getTracks(ids: string[]): Promise<ProviderTrack[]>;
  getLyrics(id: string): Promise<{ lrc?: string; tlyric?: string; raw?: unknown } | null>;
  getPlayback(id: string, connectionId?: string): Promise<PlaybackDescriptor>;
  beginAuthorization(): Promise<ProviderAuthorization>;
  pollAuthorization(id: string): Promise<ProviderAuthorization>;
  refreshAuthorization(id: string): Promise<ProviderAuthorization>;
  revokeAuthorization(id: string): Promise<void>;
  getUser(id: string): Promise<ProviderUser>;
  getUserPlaylists(id: string): Promise<ProviderPlaylist[]>;
  getLikedTracks(id: string): Promise<ProviderTrack[]>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable = false,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

const neteaseShareHosts = new Set(['music.163.com', 'y.music.163.com', 'm.music.163.com']);
const urlPattern = /https?:\/\/[^\s)]+/gi;

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const octets = normalized.split('.').map((part) => Number(part));
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  if (ipVersion === 6) {
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80');
  }

  return false;
}

function isPrivateServiceHostname(hostname: string) {
  return isPrivateHostname(hostname) || !hostname.includes('.');
}

function validateProviderBaseUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('UNSAFE_PROVIDER_ENDPOINT', 'Provider endpoint protocol is not allowed');
  }
  if (!isPrivateServiceHostname(url.hostname)) {
    throw new ProviderError('UNSAFE_PROVIDER_ENDPOINT', 'Enhanced provider endpoint must be private');
  }
  return url;
}

function validateShareUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (error) {
    throw new ProviderError('INVALID_SHARE_LINK', 'Share link is not a valid URL', false, error);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ProviderError('UNSAFE_SHARE_LINK', 'Share link protocol is not allowed');
  }

  if (isPrivateHostname(url.hostname)) {
    throw new ProviderError('UNSAFE_SHARE_LINK', 'Share link hostname is private or local');
  }

  if (!neteaseShareHosts.has(url.hostname.toLowerCase())) {
    throw new ProviderError('UNSAFE_SHARE_LINK', 'Share link hostname is not in the allowlist');
  }

  return url;
}

export function resolveNeteasePlaylistId(input: string) {
  const trimmed = input.trim();
  if (/^\d{3,}$/.test(trimmed)) return trimmed;

  const urls = [...trimmed.matchAll(urlPattern)].map((match) => validateShareUrl(match[0]));
  if (urls.length > 0) {
    for (const url of urls) {
      const directId = url.searchParams.get('id');
      const hashId = url.hash.match(/[?&]id=(\d{3,})/)?.[1];
      const pathId = url.pathname.match(/(?:playlist|songlist)\/(\d{3,})/)?.[1];
      const id = directId ?? hashId ?? pathId;
      if (id && /^\d{3,}$/.test(id)) return id;
    }

    throw new ProviderError('INVALID_SHARE_LINK', 'No playlist id found in the share link');
  }

  if (/\b(?:file|ftp):\/\//i.test(trimmed)) {
    throw new ProviderError('UNSAFE_SHARE_LINK', 'Share link protocol is not allowed');
  }

  const looseId = trimmed.match(/(?:playlist\D+|id=)?(\d{3,})/)?.[1];
  if (looseId) return looseId;

  throw new ProviderError('INVALID_SHARE_LINK', 'No playlist id found');
}

const mockCapabilities: ProviderCapabilities = {
  playlistRead: true,
  privatePlaylistRead: false,
  lyrics: true,
  wordByWordLyrics: false,
  directPlayback: false,
  accountAuthorization: false,
  likedTracks: false,
  userPlaylists: false,
};

export class MockMusicProvider implements MusicProvider {
  readonly name = 'mock' as const;

  capabilities() {
    return mockCapabilities;
  }

  async resolveShareLink(input: string) {
    return { provider: 'mock' as const, providerPlaylistId: resolveNeteasePlaylistId(input) };
  }

  async getPlaylist(id: string): Promise<ProviderPlaylist> {
    return { provider: 'mock', providerPlaylistId: id, name: `Mock playlist ${id}` };
  }

  async getPlaylistTracks(_id: string): Promise<ProviderTrack[]> {
    return [];
  }

  async getTrack(id: string): Promise<ProviderTrack> {
    return { provider: 'mock', providerTrackId: id, title: `Mock track ${id}`, artists: [] };
  }

  async getTracks(ids: string[]): Promise<ProviderTrack[]> {
    return Promise.all(ids.map((id) => this.getTrack(id)));
  }

  async getLyrics(_id: string) {
    return null;
  }

  async getPlayback(_id: string): Promise<PlaybackDescriptor> {
    return { kind: 'unavailable', reason: 'PROVIDER_UNAVAILABLE' };
  }

  async beginAuthorization(): Promise<ProviderAuthorization> {
    return { id: 'mock', status: 'failed' };
  }

  async pollAuthorization(id: string): Promise<ProviderAuthorization> {
    return { id, status: 'failed' };
  }

  async refreshAuthorization(id: string): Promise<ProviderAuthorization> {
    return { id, status: 'failed' };
  }

  async revokeAuthorization(_id: string) {
    return undefined;
  }

  async getUser(id: string): Promise<ProviderUser> {
    return { provider: 'mock', providerUserId: id, displayName: 'Mock User' };
  }

  async getUserPlaylists(_id: string): Promise<ProviderPlaylist[]> {
    return [];
  }

  async getLikedTracks(_id: string): Promise<ProviderTrack[]> {
    return [];
  }
}

export class NeteaseEnhancedProvider implements MusicProvider {
  readonly name = 'netease-enhanced' as const;

  constructor(private readonly baseUrl = process.env.NCM_API_URL ?? 'http://ncm-api:3000') {}

  capabilities(): ProviderCapabilities {
    return {
      playlistRead: true,
      privatePlaylistRead: true,
      lyrics: true,
      wordByWordLyrics: false,
      directPlayback: true,
      accountAuthorization: true,
      likedTracks: true,
      userPlaylists: true,
    };
  }

  async resolveShareLink(input: string) {
    return { provider: 'netease' as const, providerPlaylistId: resolveNeteasePlaylistId(input) };
  }

  async getPlaylist(id: string): Promise<ProviderPlaylist> {
    const raw = await this.getJson<{ playlist?: { name?: string; description?: string; coverImgUrl?: string; updateTime?: number } }>(
      '/playlist/detail',
      { id },
    );
    return {
      provider: 'netease',
      providerPlaylistId: id,
      name: raw.playlist?.name ?? `Netease playlist ${id}`,
      description: raw.playlist?.description,
      coverUrl: raw.playlist?.coverImgUrl,
      providerUpdatedAt: raw.playlist?.updateTime ? new Date(raw.playlist.updateTime) : undefined,
      raw,
    };
  }

  async getPlaylistTracks(id: string): Promise<ProviderTrack[]> {
    const raw = await this.getJson<{ songs?: unknown[]; playlist?: { tracks?: unknown[] } }>('/playlist/track/all', { id });
    const songs = raw.songs ?? raw.playlist?.tracks ?? [];
    return songs.map((song) => this.mapTrack(song));
  }

  async getTrack(id: string): Promise<ProviderTrack> {
    const [track] = await this.getTracks([id]);
    if (!track) throw new ProviderError('TRACK_NOT_FOUND', 'Track not found');
    return track;
  }

  async getTracks(ids: string[]): Promise<ProviderTrack[]> {
    if (ids.length === 0) return [];
    const raw = await this.getJson<{ songs?: unknown[] }>('/song/detail', { ids: `[${ids.join(',')}]` });
    return (raw.songs ?? []).map((song) => this.mapTrack(song));
  }

  async getLyrics(id: string) {
    const raw = await this.getJson<{ lrc?: { lyric?: string }; tlyric?: { lyric?: string } }>('/lyric', { id });
    return { lrc: raw.lrc?.lyric, tlyric: raw.tlyric?.lyric, raw };
  }

  async getPlayback(id: string): Promise<PlaybackDescriptor> {
    const raw = await this.getJson<{ data?: Array<{ url?: string; freeTrialInfo?: unknown; code?: number }> }>('/song/url/v1', {
      id,
      level: 'standard',
    });
    const item = raw.data?.[0];
    if (!item?.url) {
      return { kind: 'unavailable', reason: item?.freeTrialInfo ? 'TRIAL_ONLY' : 'COPYRIGHT_UNAVAILABLE' };
    }
    return { kind: 'redirect', url: item.url, expiresAt: new Date(Date.now() + 5 * 60 * 1000), quality: 'standard' };
  }

  async beginAuthorization(): Promise<ProviderAuthorization> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Authorization is not implemented for the enhanced provider yet');
  }

  async pollAuthorization(id: string): Promise<ProviderAuthorization> {
    throw new ProviderError('UNSUPPORTED_OPERATION', `Authorization polling is not implemented: ${id}`);
  }

  async refreshAuthorization(id: string): Promise<ProviderAuthorization> {
    throw new ProviderError('UNSUPPORTED_OPERATION', `Authorization refresh is not implemented: ${id}`);
  }

  async revokeAuthorization(_id: string) {
    return undefined;
  }

  async getUser(id: string): Promise<ProviderUser> {
    const raw = await this.getJson<{ profile?: { userId?: number; nickname?: string } }>('/user/detail', { uid: id });
    return {
      provider: 'netease',
      providerUserId: raw.profile?.userId?.toString() ?? id,
      displayName: raw.profile?.nickname,
      raw,
    };
  }

  async getUserPlaylists(id: string): Promise<ProviderPlaylist[]> {
    const raw = await this.getJson<{ playlist?: Array<{ id?: number; name?: string; description?: string; coverImgUrl?: string }> }>(
      '/user/playlist',
      { uid: id },
    );
    return (raw.playlist ?? [])
      .filter((playlist) => playlist.id !== undefined)
      .map((playlist) => ({
        provider: 'netease',
        providerPlaylistId: String(playlist.id),
        name: playlist.name ?? `Netease playlist ${playlist.id}`,
        description: playlist.description,
        coverUrl: playlist.coverImgUrl,
        raw: playlist,
      }));
  }

  async getLikedTracks(_id: string): Promise<ProviderTrack[]> {
    throw new ProviderError('UNSUPPORTED_OPERATION', 'Liked track retrieval requires an authorized connection');
  }

  private async getJson<T>(path: string, query: Record<string, string>, attempt = 0): Promise<T> {
    if (path.includes('/song/url/match')) {
      throw new ProviderError('UNSUPPORTED_OPERATION', 'Cross-platform matched playback endpoint is forbidden');
    }

    const url = new URL(path, validateProviderBaseUrl(this.baseUrl));
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (response.status === 429) {
        throw new ProviderError('PROVIDER_RATE_LIMITED', 'Provider rate limit exceeded', true);
      }
      if (!response.ok) {
        throw new ProviderError('PROVIDER_UNAVAILABLE', `Provider returned HTTP ${response.status}`, response.status >= 500);
      }
      return (await response.json()) as T;
    } catch (error) {
      const retryable = error instanceof ProviderError ? error.retryable : true;
      if (retryable && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
        return this.getJson<T>(path, query, attempt + 1);
      }

      if (error instanceof ProviderError) throw error;
      throw new ProviderError('PROVIDER_TIMEOUT', 'Provider request timed out or failed', true, error);
    } finally {
      clearTimeout(timer);
    }
  }

  private mapTrack(raw: unknown): ProviderTrack {
    const track = raw as {
      id?: number | string;
      name?: string;
      dt?: number;
      duration?: number;
      ar?: Array<{ name?: string }>;
      artists?: Array<{ name?: string }>;
      al?: { name?: string };
      album?: { name?: string };
    };
    const id = track.id?.toString();
    if (!id) throw new ProviderError('TRACK_NOT_FOUND', 'Provider track has no id');

    return {
      provider: 'netease',
      providerTrackId: id,
      title: track.name ?? `Netease track ${id}`,
      durationMs: track.dt ?? track.duration,
      album: { title: track.al?.name ?? track.album?.name ?? '' },
      artists: (track.ar ?? track.artists ?? []).map((artist) => ({ name: artist.name ?? '' })).filter((artist) => artist.name.length > 0),
      raw,
    };
  }
}

export class NeteaseOfficialProvider implements MusicProvider {
  readonly name = 'netease-official' as const;

  capabilities(): ProviderCapabilities {
    return {
      playlistRead: false,
      privatePlaylistRead: false,
      lyrics: false,
      wordByWordLyrics: false,
      directPlayback: false,
      accountAuthorization: false,
      likedTracks: false,
      userPlaylists: false,
    };
  }

  async resolveShareLink(_input: string): Promise<{ provider: 'netease'; providerPlaylistId: string }> {
    throw this.notConfigured();
  }

  async getPlaylist(_id: string): Promise<ProviderPlaylist> {
    throw this.notConfigured();
  }

  async getPlaylistTracks(_id: string): Promise<ProviderTrack[]> {
    throw this.notConfigured();
  }

  async getTrack(_id: string): Promise<ProviderTrack> {
    throw this.notConfigured();
  }

  async getTracks(_ids: string[]): Promise<ProviderTrack[]> {
    throw this.notConfigured();
  }

  async getLyrics(_id: string): Promise<{ lrc?: string; tlyric?: string; raw?: unknown } | null> {
    throw this.notConfigured();
  }

  async getPlayback(_id: string): Promise<PlaybackDescriptor> {
    throw this.notConfigured();
  }

  async beginAuthorization(): Promise<ProviderAuthorization> {
    throw this.notConfigured();
  }

  async pollAuthorization(_id: string): Promise<ProviderAuthorization> {
    throw this.notConfigured();
  }

  async refreshAuthorization(_id: string): Promise<ProviderAuthorization> {
    throw this.notConfigured();
  }

  async revokeAuthorization(_id: string): Promise<void> {
    throw this.notConfigured();
  }

  async getUser(_id: string): Promise<ProviderUser> {
    throw this.notConfigured();
  }

  async getUserPlaylists(_id: string): Promise<ProviderPlaylist[]> {
    throw this.notConfigured();
  }

  async getLikedTracks(_id: string): Promise<ProviderTrack[]> {
    throw this.notConfigured();
  }

  private notConfigured() {
    return new ProviderError('NOT_CONFIGURED', 'Netease official provider is not configured');
  }
}

export function createMusicProvider(mode = process.env.MUSIC_PROVIDER_MODE ?? 'enhanced'): MusicProvider {
  switch (mode) {
    case 'mock':
      return new MockMusicProvider();
    case 'official':
      return new NeteaseOfficialProvider();
    case 'hybrid':
      return new NeteaseEnhancedProvider();
    case 'enhanced':
      return new NeteaseEnhancedProvider();
    default:
      throw new ProviderError('NOT_CONFIGURED', `Unknown music provider mode: ${mode}`);
  }
}

import { describe, expect, it } from 'vitest';
import {
  createMusicProvider,
  MockMusicProvider,
  NeteaseEnhancedProvider,
  NeteaseOfficialProvider,
  ProviderError,
  resolveNeteasePlaylistId,
} from '../src/providers/music/types.js';

describe('music provider contract', () => {
  it('mock provider implements the full contract with stable normalized shapes', async () => {
    const provider = new MockMusicProvider();

    expect(provider.capabilities()).toMatchObject({ playlistRead: true, directPlayback: false });
    await expect(provider.resolveShareLink('https://music.163.com/#/playlist?id=123456')).resolves.toEqual({
      provider: 'mock',
      providerPlaylistId: '123456',
    });
    await expect(provider.getPlaylist('123456')).resolves.toMatchObject({ providerPlaylistId: '123456', name: 'Mock playlist 123456' });
    await expect(provider.getTrack('42')).resolves.toMatchObject({ providerTrackId: '42', title: 'Mock track 42' });
    await expect(provider.getPlayback('42')).resolves.toEqual({ kind: 'unavailable', reason: 'PROVIDER_UNAVAILABLE' });
  });

  it('official provider fails explicitly instead of pretending an API exists', async () => {
    const provider = new NeteaseOfficialProvider();

    expect(provider.capabilities()).toMatchObject({ playlistRead: false, accountAuthorization: false });
    await expect(provider.getPlaylist('123')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('factory supports all configured provider modes', () => {
    expect(createMusicProvider('mock').name).toBe('mock');
    expect(createMusicProvider('enhanced').name).toBe('netease-enhanced');
    expect(createMusicProvider('hybrid').name).toBe('netease-enhanced');
    expect(createMusicProvider('official').name).toBe('netease-official');
    expect(() => createMusicProvider('missing')).toThrow(ProviderError);
  });

  it('enhanced provider refuses public API endpoints', async () => {
    const provider = new NeteaseEnhancedProvider('https://public.example');
    await expect(provider.getPlayback('123')).rejects.toMatchObject({ code: 'UNSAFE_PROVIDER_ENDPOINT' });
  });
});

describe('netease share-link parsing and SSRF guardrails', () => {
  it('accepts numeric ids and allowlisted playlist URLs', () => {
    expect(resolveNeteasePlaylistId('123456')).toBe('123456');
    expect(resolveNeteasePlaylistId('分享 https://music.163.com/playlist?id=987654&userid=1')).toBe('987654');
    expect(resolveNeteasePlaylistId('https://music.163.com/#/playlist?id=555666')).toBe('555666');
  });

  it('rejects unsafe hosts and protocols', () => {
    expect(() => resolveNeteasePlaylistId('http://127.0.0.1/playlist?id=123456')).toThrow(ProviderError);
    expect(() => resolveNeteasePlaylistId('http://192.168.1.1/playlist?id=123456')).toThrow(ProviderError);
    expect(() => resolveNeteasePlaylistId('https://evil.example/playlist?id=123456')).toThrow(ProviderError);
    expect(() => resolveNeteasePlaylistId('file:///etc/passwd')).toThrow(ProviderError);
  });
});

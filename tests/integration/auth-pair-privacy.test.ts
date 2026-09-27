import '../../src/config/env.js';

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, closeDatabase } from '../../src/app.js';

const runIfDatabase = process.env.DATABASE_URL ? describe.sequential : describe.skip;

type TestApp = Awaited<ReturnType<typeof buildApp>>;

const mutableTables = [
  'audit_logs',
  'auth_sessions',
  'session_track_reactions',
  'listening_events',
  'event_batches',
  'playback_instance_stats',
  'session_track_stats',
  'session_summaries',
  'playback_instances',
  'session_queue_items',
  'listening_sessions',
  'playlist_snapshot_tracks',
  'playlist_snapshots',
  'playlists',
  'provider_authorization_attempts',
  'music_connections',
  'track_artists',
  'provider_tracks',
  'tracks',
  'artists',
  'albums',
  'pair_invites',
  'pair_members',
  'pair_spaces',
  'playback_tokens',
  'provider_cache',
  'users',
];

function cookieFrom(response: { headers: Record<string, string | string[] | undefined> }) {
  const setCookie = response.headers['set-cookie'];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!first) throw new Error('Expected Set-Cookie header');
  return first.split(';')[0];
}

async function register(app: TestApp, username: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, passphrase: `${username}-passphrase`, timezone: 'Asia/Shanghai' },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; username: string; timezone: string };
}

async function login(app: TestApp, username: string, headers: Record<string, string> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers,
    payload: { username, passphrase: `${username}-passphrase` },
  });
  expect(response.statusCode).toBe(200);
  return { cookie: cookieFrom(response), setCookie: response.headers['set-cookie'] as string | string[] };
}

async function registerAndLogin(app: TestApp, username: string) {
  const user = await register(app, username);
  const auth = await login(app, username);
  return { user, ...auth };
}

async function createPair(app: TestApp, cookie: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/pairs',
    headers: { cookie },
    payload: { name },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; name: string };
}

async function createInvite(app: TestApp, cookie: string, pairId: string) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/pairs/${pairId}/invite`, headers: { cookie } });
  expect(response.statusCode).toBe(201);
  return response.json().data.inviteToken as string;
}

async function acceptInvite(app: TestApp, cookie: string, token: string) {
  return app.inject({ method: 'POST', url: `/api/v1/pairs/invite/${token}/accept`, headers: { cookie } });
}

async function createSession(app: TestApp, cookie: string, pairId: string, visibility: 'private' | 'summary' | 'full', moodName: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sessions',
    headers: { cookie },
    payload: { pairId, moodName, moodIntensity: 3, visibility },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data as { id: string; visibility: string; moodNameSnapshot: string };
}

runIfDatabase('phase 2 auth, pair and privacy integration', () => {
  let pool: Pool;
  let app: TestApp;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;

  function restoreEnvironment() {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    if (previousCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousCorsOrigin;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const migrationSql = await readFile(new URL('../../src/database/migrations/0000_initial.sql', import.meta.url), 'utf8');
    await pool.query(migrationSql);
    app = await buildApp({ logger: false });
  });

  beforeEach(async () => {
    restoreEnvironment();
    await pool.query(`TRUNCATE TABLE ${mutableTables.join(', ')} RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    restoreEnvironment();
    await app.close();
    await closeDatabase();
    await pool.end();
  });

  it('uses Argon2id password hashes and strict HttpOnly cookies with expiry-aware sessions', async () => {
    const user = await register(app, 'alice');
    const storedUser = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    expect(storedUser.rows[0]?.password_hash).toContain('$argon2id$');

    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.example';
    const { cookie, setCookie } = await login(app, 'alice', { origin: 'https://app.example' });
    const setCookieText = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    expect(setCookieText).toContain('HttpOnly');
    expect(setCookieText).toContain('SameSite=Strict');
    expect(setCookieText).toContain('Secure');

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ id: user.id, username: 'alice' });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie, origin: 'https://app.example' },
    });
    expect(logout.statusCode).toBe(200);
    const afterLogout = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
    expect(afterLogout.statusCode).toBe(401);

    const relogin = await login(app, 'alice', { origin: 'https://app.example' });
    await pool.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 second'`);
    const expired = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: relogin.cookie } });
    expect(expired.statusCode).toBe(401);
  });

  it('stores invite tokens hashed, enforces expiry and prevents single-use token replay', async () => {
    const owner = await registerAndLogin(app, 'owner');
    const bob = await registerAndLogin(app, 'bob');
    const pair = await createPair(app, owner.cookie, 'owner-bob');
    const token = await createInvite(app, owner.cookie, pair.id);

    const storedInvite = await pool.query<{ token_hash: string }>('SELECT token_hash FROM pair_invites WHERE pair_id = $1', [pair.id]);
    expect(storedInvite.rows[0]?.token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(storedInvite.rows[0]?.token_hash).not.toBe(token);

    const accepted = await acceptInvite(app, bob.cookie, token);
    expect(accepted.statusCode).toBe(200);

    const replay = await acceptInvite(app, bob.cookie, token);
    expect(replay.statusCode).toBe(400);

    const secondPair = await createPair(app, owner.cookie, 'expired-pair');
    const expiredToken = await createInvite(app, owner.cookie, secondPair.id);
    await pool.query(`UPDATE pair_invites SET expires_at = now() - interval '1 second' WHERE pair_id = $1`, [secondPair.id]);
    const expired = await acceptInvite(app, bob.cookie, expiredToken);
    expect(expired.statusCode).toBe(400);
  });

  it('serializes concurrent invite acceptance so a pair never exceeds two members', async () => {
    const owner = await registerAndLogin(app, 'slot-owner');
    const bob = await registerAndLogin(app, 'slot-bob');
    const cara = await registerAndLogin(app, 'slot-cara');
    const pair = await createPair(app, owner.cookie, 'two-slots-only');
    const inviteA = await createInvite(app, owner.cookie, pair.id);
    const inviteB = await createInvite(app, owner.cookie, pair.id);

    const responses = await Promise.all([acceptInvite(app, bob.cookie, inviteA), acceptInvite(app, cara.cookie, inviteB)]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);

    const members = await pool.query<{ count: string }>('SELECT count(*) FROM pair_members WHERE pair_id = $1', [pair.id]);
    expect(Number(members.rows[0]?.count)).toBe(2);
  });

  it('enforces pair membership and filters private versus summary versus full session visibility', async () => {
    const alice = await registerAndLogin(app, 'privacy-alice');
    const bob = await registerAndLogin(app, 'privacy-bob');
    const mallory = await registerAndLogin(app, 'privacy-mallory');
    const pair = await createPair(app, alice.cookie, 'privacy-pair');
    const invite = await createInvite(app, alice.cookie, pair.id);
    expect((await acceptInvite(app, bob.cookie, invite)).statusCode).toBe(200);

    const nonMemberPairRead = await app.inject({ method: 'GET', url: `/api/v1/pairs/${pair.id}`, headers: { cookie: mallory.cookie } });
    expect(nonMemberPairRead.statusCode).toBe(403);

    const nonMemberInvite = await app.inject({ method: 'POST', url: `/api/v1/pairs/${pair.id}/invite`, headers: { cookie: mallory.cookie } });
    expect(nonMemberInvite.statusCode).toBe(403);

    const privateSession = await createSession(app, alice.cookie, pair.id, 'private', 'private mood');
    const summarySession = await createSession(app, alice.cookie, pair.id, 'summary', 'summary mood');
    const fullSession = await createSession(app, alice.cookie, pair.id, 'full', 'full mood');

    const privateRead = await app.inject({ method: 'GET', url: `/api/v1/sessions/${privateSession.id}`, headers: { cookie: bob.cookie } });
    expect(privateRead.statusCode).toBe(404);

    const summaryRead = await app.inject({ method: 'GET', url: `/api/v1/sessions/${summarySession.id}`, headers: { cookie: bob.cookie } });
    expect(summaryRead.statusCode).toBe(200);
    expect(summaryRead.json().data).toMatchObject({ access: 'summary', summary: null });
    expect(summaryRead.json().data.session).not.toHaveProperty('playlistSnapshotId');

    const fullRead = await app.inject({ method: 'GET', url: `/api/v1/sessions/${fullSession.id}`, headers: { cookie: bob.cookie } });
    expect(fullRead.statusCode).toBe(200);
    expect(fullRead.json().data).toMatchObject({ access: 'full', session: { id: fullSession.id } });

    const pairSessions = await app.inject({ method: 'GET', url: `/api/v1/pairs/${pair.id}/sessions`, headers: { cookie: bob.cookie } });
    expect(pairSessions.statusCode).toBe(200);
    const visibleIds = pairSessions.json().data.map((entry: { session: { id: string } }) => entry.session.id);
    expect(visibleIds).not.toContain(privateSession.id);
    expect(visibleIds).toEqual(expect.arrayContaining([summarySession.id, fullSession.id]));

    const auditActions = await pool.query<{ action: string }>('SELECT action FROM audit_logs ORDER BY created_at');
    expect(auditActions.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['auth.register', 'auth.login', 'pair.create', 'pair.invite.create', 'pair.invite.accept', 'session.create']),
    );
  });
});

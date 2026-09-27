import './config/env.js';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import argon2 from 'argon2';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { z, ZodError } from 'zod';
import { schema } from './database/schema.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

export async function closeDatabase() {
  await pool.end();
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const eventTypes = [
  'play',
  'pause',
  'resume',
  'seek',
  'heartbeat',
  'buffer_start',
  'buffer_end',
  'track_end',
  'session_end',
  'page_close',
  'manual_next',
  'manual_previous',
  'track_select',
  'heart_on',
  'heart_off',
] as const;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const ok = (request: { id: string }, data: unknown) => ({ success: true, requestId: request.id, data });
const fail = (request: { id: string }, code: string, message: string, details?: unknown) => ({
  success: false,
  requestId: request.id,
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

function assertOriginAllowed(request: { method: string; headers: Record<string, string | string[] | undefined>; url: string }) {
  if (!unsafeMethods.has(request.method) || !request.url.startsWith('/api/')) return;

  const configuredOrigin = process.env.CORS_ORIGIN;
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;

  if (!configuredOrigin || configuredOrigin === '*') return;
  if (!origin && process.env.NODE_ENV !== 'production') return;
  if (origin !== configuredOrigin) {
    throw new HttpError(403, 'INVALID_ORIGIN', 'Request origin is not allowed');
  }
}

async function auditLog(input: { userId?: string; pairId?: string; action: string; requestId?: string; metadata?: Record<string, unknown> }) {
  await db.insert(schema.auditLogs).values({
    userId: input.userId,
    pairId: input.pairId,
    action: input.action,
    requestId: input.requestId,
    metadata: input.metadata ?? {},
  });
}

async function requireUser(request: any, reply: any) {
  const raw = request.cookies.session;
  if (!raw) {
    return reply.code(401).send(fail(request, 'UNAUTHENTICATED', 'Login required'));
  }

  const rows = await db
    .select({ id: schema.users.id, username: schema.users.username, timezone: schema.users.timezone })
    .from(schema.users)
    .innerJoin(schema.authSessions, eq(schema.authSessions.userId, schema.users.id))
    .where(and(eq(schema.authSessions.tokenHash, hashToken(raw)), gt(schema.authSessions.expiresAt, new Date())));

  if (!rows[0]) {
    return reply.code(401).send(fail(request, 'UNAUTHENTICATED', 'Login required'));
  }

  request.user = rows[0];
  await db.update(schema.authSessions).set({ lastSeenAt: new Date() }).where(eq(schema.authSessions.tokenHash, hashToken(raw)));
}

async function requirePairMember(userId: string, pairId: string) {
  const rows = await db
    .select({ id: schema.pairMembers.id, memberSlot: schema.pairMembers.memberSlot })
    .from(schema.pairMembers)
    .where(and(eq(schema.pairMembers.userId, userId), eq(schema.pairMembers.pairId, pairId)));
  return rows[0];
}

async function assertPairMember(userId: string, pairId: string) {
  const member = await requirePairMember(userId, pairId);
  if (!member) {
    throw new HttpError(403, 'PAIR_ACCESS_DENIED', 'You are not a member of this pair');
  }
  return member;
}

function nextPairMemberSlot(members: Array<{ memberSlot: number }>) {
  const occupied = new Set(members.map((member) => member.memberSlot));
  if (!occupied.has(1)) return 1;
  if (!occupied.has(2)) return 2;
  return undefined;
}

type SessionRow = typeof schema.sessions.$inferSelect;
type SessionSummaryRow = typeof schema.sessionSummaries.$inferSelect;

function publicSessionSummary(session: SessionRow) {
  return {
    id: session.id,
    pairId: session.pairId,
    userId: session.userId,
    visibility: session.visibility,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    localStartedDate: session.localStartedDate,
    timezoneSnapshot: session.timezoneSnapshot,
    moodNameSnapshot: session.moodNameSnapshot,
    moodEmojiSnapshot: session.moodEmojiSnapshot,
    moodIntensity: session.moodIntensity,
  };
}

function sessionPayloadForViewer(session: SessionRow, viewerUserId: string, summary: SessionSummaryRow | null = null) {
  if (session.userId === viewerUserId || session.visibility === 'full') {
    return { access: 'full', session };
  }

  return { access: 'summary', session: publicSessionSummary(session), summary };
}

function parseClientWallTime(input: string) {
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'INVALID_CLIENT_TIME', 'clientWallTime must be an ISO timestamp');
  }

  const now = Date.now();
  const driftMs = Math.abs(now - parsed.getTime());
  if (driftMs > 7 * 24 * 60 * 60 * 1000) {
    throw new HttpError(422, 'CLIENT_TIME_OUT_OF_RANGE', 'clientWallTime is outside the accepted range');
  }

  return parsed;
}

type BuildAppOptions = {
  logger?: boolean;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const logger =
    options.logger === false
      ? false
      : {
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'password',
            'passphrase',
            'token',
            'inviteToken',
            'authorization',
            'credentialCiphertext',
            'credentialIv',
            'credentialAuthTag',
            'playbackUrl',
            'url',
          ],
        };

  const app = Fastify({
    logger,
    bodyLimit: 256 * 1024,
    genReqId: () => crypto.randomUUID(),
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, 'request failed');

    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send(fail(request, error.code, error.message, error.details));
    }

    if (error instanceof ZodError) {
      return reply.code(400).send(fail(request, 'VALIDATION_ERROR', 'Request validation failed', error.flatten()));
    }

    const pgCode = (error as { code?: string }).code;
    if (pgCode === '23505') {
      return reply.code(409).send(fail(request, 'CONFLICT', 'A unique database constraint was violated'));
    }

    if ((error as { statusCode?: number }).statusCode === 413) {
      return reply.code(413).send(fail(request, 'PAYLOAD_TOO_LARGE', 'Request body is too large'));
    }

    return reply.code(500).send(fail(request, 'INTERNAL_SERVER_ERROR', 'Unexpected server error'));
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    assertOriginAllowed(request);
  });

  await app.register(cookie);
  await app.register(helmet);
  await app.register(cors, { origin: process.env.CORS_ORIGIN ?? false, credentials: true });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: {
      info: { title: 'Music Dual Analysis API', version: '1.0.0' },
      servers: [{ url: '/api/v1' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async (request) => ok(request, { status: 'healthy' }));
  app.get('/ready', async (request) => {
    await pool.query('SELECT 1');
    return ok(request, { database: 'reachable' });
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const input = z
      .object({
        username: z.string().min(3).max(80),
        passphrase: z.string().min(10),
        timezone: z.string().default('UTC'),
      })
      .parse(request.body);

    const [user] = await db
      .insert(schema.users)
      .values({
        username: input.username,
        passwordHash: await argon2.hash(input.passphrase, { type: argon2.argon2id }),
        timezone: input.timezone,
      })
      .returning({ id: schema.users.id, username: schema.users.username, timezone: schema.users.timezone });

    await auditLog({ userId: user.id, action: 'auth.register', requestId: request.id });
    return reply.code(201).send(ok(request, user));
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const input = z.object({ username: z.string(), passphrase: z.string() }).parse(request.body);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.username, input.username));

    if (!user || !(await argon2.verify(user.passwordHash, input.passphrase))) {
      return reply.code(401).send(fail(request, 'INVALID_CREDENTIALS', 'Invalid credentials'));
    }

    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(schema.authSessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    reply.setCookie('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });

    await auditLog({ userId: user.id, action: 'auth.login', requestId: request.id });
    return reply.send(ok(request, { id: user.id, username: user.username, timezone: user.timezone }));
  });

  app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request: any, reply) => {
    const raw = request.cookies.session;
    if (raw) {
      await db.delete(schema.authSessions).where(eq(schema.authSessions.tokenHash, hashToken(raw)));
    }

    reply.clearCookie('session', { path: '/' });
    await auditLog({ userId: request.user.id, action: 'auth.logout', requestId: request.id });
    return reply.send(ok(request, null));
  });

  app.get('/api/v1/auth/me', { preHandler: requireUser }, async (request: any) => ok(request, request.user));

  app.post('/api/v1/pairs', { preHandler: requireUser }, async (request: any, reply) => {
    const input = z.object({ name: z.string().min(1).max(120) }).parse(request.body);
    const [pair] = await db.insert(schema.pairSpaces).values({ name: input.name }).returning();
    await db.insert(schema.pairMembers).values({ pairId: pair.id, userId: request.user.id, memberSlot: 1, role: 'owner' });
    await auditLog({ userId: request.user.id, pairId: pair.id, action: 'pair.create', requestId: request.id });
    return reply.code(201).send(ok(request, pair));
  });

  app.post('/api/v1/pairs/:id/invite', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await assertPairMember(request.user.id, params.id);

    const members = await db
      .select({ memberSlot: schema.pairMembers.memberSlot })
      .from(schema.pairMembers)
      .where(eq(schema.pairMembers.pairId, params.id));

    if (members.length >= 2) {
      return reply.code(409).send(fail(request, 'PAIR_FULL', 'Pair already has two members'));
    }

    const token = crypto.randomBytes(32).toString('base64url');
    await db.insert(schema.pairInvites).values({
      pairId: params.id,
      tokenHash: hashToken(token),
      createdBy: request.user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    await auditLog({ userId: request.user.id, pairId: params.id, action: 'pair.invite.create', requestId: request.id });
    return reply.code(201).send(ok(request, { inviteToken: token, expiresIn: 604_800 }));
  });

  app.post('/api/v1/pairs/invite/:token/accept', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ token: z.string().min(16) }).parse(request.params);
    const [invite] = await db
      .select()
      .from(schema.pairInvites)
      .where(and(eq(schema.pairInvites.tokenHash, hashToken(params.token)), gt(schema.pairInvites.expiresAt, new Date())));

    if (!invite || invite.usedAt) {
      return reply.code(400).send(fail(request, 'INVALID_INVITE', 'Invite is invalid or expired'));
    }

    if (await requirePairMember(request.user.id, invite.pairId)) {
      return reply.code(409).send(fail(request, 'ALREADY_MEMBER', 'Already a pair member'));
    }

    let joined = false;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM pair_spaces WHERE id = ${invite.pairId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM pair_invites WHERE id = ${invite.id} FOR UPDATE`);

      const [freshInvite] = await tx.select().from(schema.pairInvites).where(eq(schema.pairInvites.id, invite.id));
      if (!freshInvite || freshInvite.usedAt || freshInvite.expiresAt <= new Date()) {
        throw new HttpError(400, 'INVALID_INVITE', 'Invite is invalid or expired');
      }

      const members = await tx
        .select({ memberSlot: schema.pairMembers.memberSlot })
        .from(schema.pairMembers)
        .where(eq(schema.pairMembers.pairId, invite.pairId));
      const slot = nextPairMemberSlot(members);

      if (!slot) {
        throw new HttpError(409, 'PAIR_FULL', 'Pair already has two members');
      }

      await tx.insert(schema.pairMembers).values({ pairId: invite.pairId, userId: request.user.id, memberSlot: slot, role: 'member' });
      await tx.update(schema.pairInvites).set({ usedAt: new Date() }).where(eq(schema.pairInvites.id, invite.id));
      joined = true;
    });

    await auditLog({ userId: request.user.id, pairId: invite.pairId, action: 'pair.invite.accept', requestId: request.id });
    return reply.send(ok(request, { pairId: invite.pairId, joined }));
  });

  app.get('/api/v1/pairs/:id', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pair] = await db.select().from(schema.pairSpaces).where(eq(schema.pairSpaces.id, params.id));

    if (!pair) {
      return reply.code(404).send(fail(request, 'PAIR_NOT_FOUND', 'Pair not found'));
    }

    await assertPairMember(request.user.id, params.id);

    const members = await db
      .select({
        userId: schema.pairMembers.userId,
        username: schema.users.username,
        role: schema.pairMembers.role,
        memberSlot: schema.pairMembers.memberSlot,
        joinedAt: schema.pairMembers.joinedAt,
      })
      .from(schema.pairMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.pairMembers.userId))
      .where(eq(schema.pairMembers.pairId, params.id));

    return reply.send(ok(request, { pair, members }));
  });

  app.get('/api/v1/pairs/:id/sessions', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [pair] = await db.select({ id: schema.pairSpaces.id }).from(schema.pairSpaces).where(eq(schema.pairSpaces.id, params.id));

    if (!pair) {
      return reply.code(404).send(fail(request, 'PAIR_NOT_FOUND', 'Pair not found'));
    }

    await assertPairMember(request.user.id, params.id);

    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.pairId, params.id))
      .orderBy(desc(schema.sessions.createdAt));

    const visibleSessions = [];
    for (const session of sessions) {
      if (session.userId !== request.user.id && session.visibility === 'private') continue;

      if (session.userId !== request.user.id && session.visibility === 'summary') {
        const [summary] = await db.select().from(schema.sessionSummaries).where(eq(schema.sessionSummaries.sessionId, session.id));
        visibleSessions.push(sessionPayloadForViewer(session, request.user.id, summary ?? null));
      } else {
        visibleSessions.push(sessionPayloadForViewer(session, request.user.id));
      }
    }

    return reply.send(ok(request, visibleSessions));
  });

  app.post('/api/v1/sessions', { preHandler: requireUser }, async (request: any, reply) => {
    const input = z
      .object({
        pairId: z.string().uuid(),
        moodId: z.string().uuid().optional(),
        moodName: z.string().min(1),
        moodEmoji: z.string().optional(),
        moodIntensity: z.number().int().min(1).max(5),
        visibility: z.enum(['private', 'summary', 'full']).default('full'),
        playMode: z.enum(['ordered', 'shuffle', 'repeat_all', 'repeat_one']).default('ordered'),
        playlistId: z.string().uuid().optional(),
        playlistSnapshotId: z.string().uuid().optional(),
        clientVersion: z.string().max(80).optional(),
      })
      .parse(request.body);

    await assertPairMember(request.user.id, input.pairId);

    const [session] = await db
      .insert(schema.sessions)
      .values({
        pairId: input.pairId,
        userId: request.user.id,
        moodId: input.moodId,
        moodNameSnapshot: input.moodName,
        moodEmojiSnapshot: input.moodEmoji,
        moodIntensity: input.moodIntensity,
        visibility: input.visibility,
        playMode: input.playMode,
        playlistId: input.playlistId,
        playlistSnapshotId: input.playlistSnapshotId,
        timezoneSnapshot: request.user.timezone,
        localStartedDate: new Date().toISOString().slice(0, 10),
        status: 'CREATED',
        clientVersion: input.clientVersion,
      })
      .returning();

    await auditLog({ userId: request.user.id, pairId: input.pairId, action: 'session.create', requestId: request.id });
    return reply.code(201).send(ok(request, session));
  });

  app.post('/api/v1/sessions/:id/start', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const active = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, request.user.id), eq(schema.sessions.status, 'ACTIVE')));

    if (active[0]) {
      return reply.code(409).send(fail(request, 'ACTIVE_SESSION_EXISTS', 'End the active session first', { existingSessionId: active[0].id }));
    }

    const now = new Date();
    const [session] = await db
      .update(schema.sessions)
      .set({ status: 'ACTIVE', startedAt: now, lastEventAt: now })
      .where(and(eq(schema.sessions.id, params.id), eq(schema.sessions.userId, request.user.id), eq(schema.sessions.status, 'CREATED')))
      .returning();

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Created session not found'));
    }

    await auditLog({ userId: request.user.id, pairId: session.pairId, action: 'session.start', requestId: request.id });
    return reply.send(ok(request, session));
  });

  app.post('/api/v1/sessions/:id/end', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [session] = await db
      .update(schema.sessions)
      .set({ status: 'ENDING', endedAt: new Date() })
      .where(and(eq(schema.sessions.id, params.id), eq(schema.sessions.userId, request.user.id), eq(schema.sessions.status, 'ACTIVE')))
      .returning();

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Active session not found'));
    }

    await auditLog({ userId: request.user.id, pairId: session.pairId, action: 'session.end', requestId: request.id });
    return reply.send(ok(request, { sessionId: params.id, status: 'ENDING', job: 'aggregate-session' }));
  });

  app.post('/api/v1/sessions/:id/abandon', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [session] = await db
      .update(schema.sessions)
      .set({ status: 'ABANDONED', abandonedAt: new Date(), endedAt: new Date() })
      .where(and(eq(schema.sessions.id, params.id), eq(schema.sessions.userId, request.user.id), eq(schema.sessions.status, 'ACTIVE')))
      .returning();

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Active session not found'));
    }

    await auditLog({ userId: request.user.id, pairId: session.pairId, action: 'session.abandon', requestId: request.id });
    return reply.send(ok(request, { sessionId: params.id, status: 'ABANDONED' }));
  });

  app.post('/api/v1/sessions/:id/playback-instances', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({
        trackId: z.string().uuid(),
        queueItemId: z.string().uuid().optional(),
        selectionSource: z
          .enum(['queue', 'shuffle', 'repeat', 'manual_next', 'manual_previous', 'track_select', 'resume'])
          .default('queue'),
        initialPositionMs: z.number().int().nonnegative().default(0),
      })
      .parse(request.body);

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, params.id), eq(schema.sessions.userId, request.user.id)));

    if (!session || session.status !== 'ACTIVE') {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Active session not found'));
    }

    const [track] = await db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, input.trackId));
    if (!track) {
      return reply.code(422).send(fail(request, 'TRACK_NOT_FOUND', 'Track must exist before creating a playback instance'));
    }

    const [instance] = await db.transaction(async (tx) => {
      const [latest] = await tx
        .select({ sequence: schema.playbackInstances.sequence })
        .from(schema.playbackInstances)
        .where(eq(schema.playbackInstances.sessionId, params.id))
        .orderBy(desc(schema.playbackInstances.sequence))
        .limit(1);

      return tx
        .insert(schema.playbackInstances)
        .values({
          sessionId: params.id,
          trackId: input.trackId,
          queueItemId: input.queueItemId,
          sequence: (latest?.sequence ?? 0) + 1,
          startedBy: request.user.id,
          selectionSource: input.selectionSource,
          initialPositionMs: input.initialPositionMs,
        })
        .returning();
    });

    return reply.code(201).send(ok(request, instance));
  });

  app.patch('/api/v1/playback-instances/:id/end', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({
        endPositionMs: z.number().int().nonnegative(),
        endedReason: z.enum([
          'natural',
          'manual_next',
          'manual_previous',
          'track_select',
          'pause_timeout',
          'session_end',
          'page_close',
          'abandoned',
          'error',
        ]),
      })
      .parse(request.body);

    const [joined] = await db
      .select({ sessionUserId: schema.sessions.userId })
      .from(schema.playbackInstances)
      .innerJoin(schema.sessions, eq(schema.playbackInstances.sessionId, schema.sessions.id))
      .where(eq(schema.playbackInstances.id, params.id));

    if (!joined || joined.sessionUserId !== request.user.id) {
      return reply.code(404).send(fail(request, 'PLAYBACK_INSTANCE_NOT_FOUND', 'Playback instance not found'));
    }

    const [instance] = await db
      .update(schema.playbackInstances)
      .set({ endedAt: new Date(), endPositionMs: input.endPositionMs, endedReason: input.endedReason })
      .where(eq(schema.playbackInstances.id, params.id))
      .returning();

    return reply.send(ok(request, instance));
  });

  app.post('/api/v1/events/batch', { preHandler: requireUser }, async (request: any, reply) => {
    const input = z
      .object({
        sessionId: z.string().uuid(),
        batchId: z.string().uuid(),
        events: z
          .array(
            z.object({
              playbackInstanceId: z.string().uuid(),
              trackId: z.string().uuid(),
              seq: z.number().int().positive(),
              eventType: z.enum(eventTypes),
              positionMs: z.number().int().nonnegative(),
              durationMs: z.number().int().positive().optional(),
              clientWallTime: z.string(),
              clientMonotonicMs: z.number().int().nonnegative().optional(),
              metadata: z.record(z.unknown()).optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(request.body);

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, input.sessionId), eq(schema.sessions.userId, request.user.id)));

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    if (session.status !== 'ACTIVE') {
      return reply.code(409).send(fail(request, 'SESSION_NOT_ACTIVE', 'Session is not active'));
    }

    const seenSeq = new Set<number>();
    for (const event of input.events) {
      if (seenSeq.has(event.seq)) {
        return reply.code(422).send(fail(request, 'DUPLICATE_SEQUENCE_IN_BATCH', 'Batch contains duplicate seq values'));
      }
      seenSeq.add(event.seq);

      const [instance] = await db
        .select({ id: schema.playbackInstances.id, trackId: schema.playbackInstances.trackId })
        .from(schema.playbackInstances)
        .where(and(eq(schema.playbackInstances.id, event.playbackInstanceId), eq(schema.playbackInstances.sessionId, input.sessionId)));

      if (!instance || instance.trackId !== event.trackId) {
        return reply
          .code(422)
          .send(fail(request, 'EVENT_INTEGRITY_ERROR', 'Playback instance and track do not belong to this session'));
      }

      if (event.durationMs !== undefined) {
        const [track] = await db.select({ durationMs: schema.tracks.durationMs }).from(schema.tracks).where(eq(schema.tracks.id, event.trackId));
        if (track?.durationMs !== null && track?.durationMs !== undefined && Math.abs(track.durationMs - event.durationMs) > 1500) {
          return reply.code(422).send(fail(request, 'DURATION_MISMATCH', 'Event duration differs from catalog duration'));
        }
      }
    }

    let accepted = 0;
    let duplicates = 0;

    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.eventBatches).values({ sessionId: input.sessionId, batchId: input.batchId, eventCount: input.events.length });

        for (const event of input.events) {
          const clientWallTime = parseClientWallTime(event.clientWallTime);
          await tx.insert(schema.listeningEvents).values({
            ...event,
            sessionId: input.sessionId,
            batchId: input.batchId,
            clientWallTime,
            metadata: event.metadata ?? {},
          });

          if (event.eventType === 'heart_on' || event.eventType === 'heart_off') {
            await tx.execute(sql`
              INSERT INTO session_track_reactions (session_id, track_id, hearted_final, heart_toggle_count, last_event_seq)
              VALUES (${input.sessionId}, ${event.trackId}, ${event.eventType === 'heart_on'}, 1, ${event.seq})
              ON CONFLICT (session_id, track_id)
              DO UPDATE SET
                hearted_final = EXCLUDED.hearted_final,
                heart_toggle_count = session_track_reactions.heart_toggle_count + 1,
                last_event_seq = EXCLUDED.last_event_seq,
                updated_at = now()
              WHERE session_track_reactions.last_event_seq IS NULL OR EXCLUDED.last_event_seq > session_track_reactions.last_event_seq
            `);
          }

          accepted += 1;
        }
      });
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505' && pgError.constraint?.includes('event_batches')) {
        accepted = 0;
        duplicates = input.events.length;
      } else if (pgError.code === '23505' && pgError.constraint?.includes('listening_events')) {
        return reply.code(409).send(fail(request, 'DUPLICATE_EVENT_SEQUENCE', 'Event sequence was already used in this session'));
      } else {
        throw error;
      }
    }

    await db.update(schema.sessions).set({ lastEventAt: new Date() }).where(eq(schema.sessions.id, input.sessionId));
    return reply.send(ok(request, { accepted, duplicates }));
  });

  app.post('/api/v1/sessions/:id/reactions', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const input = z
      .object({
        trackId: z.string().uuid(),
        playbackInstanceId: z.string().uuid(),
        batchId: z.string().uuid().default(() => crypto.randomUUID()),
        seq: z.number().int().positive(),
        hearted: z.boolean(),
        positionMs: z.number().int().nonnegative(),
        durationMs: z.number().int().positive().optional(),
        clientWallTime: z.string(),
        clientMonotonicMs: z.number().int().nonnegative().optional(),
        metadata: z.record(z.unknown()).optional(),
      })
      .parse(request.body);

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, params.id), eq(schema.sessions.userId, request.user.id)));

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    if (session.status !== 'ACTIVE') {
      return reply.code(409).send(fail(request, 'SESSION_NOT_ACTIVE', 'Session is not active'));
    }

    const [instance] = await db
      .select({ id: schema.playbackInstances.id, trackId: schema.playbackInstances.trackId })
      .from(schema.playbackInstances)
      .where(and(eq(schema.playbackInstances.id, input.playbackInstanceId), eq(schema.playbackInstances.sessionId, params.id)));

    if (!instance || instance.trackId !== input.trackId) {
      return reply
        .code(422)
        .send(fail(request, 'EVENT_INTEGRITY_ERROR', 'Playback instance and track do not belong to this session'));
    }

    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.eventBatches).values({ sessionId: params.id, batchId: input.batchId, eventCount: 1 });
        await tx.insert(schema.listeningEvents).values({
          sessionId: params.id,
          batchId: input.batchId,
          playbackInstanceId: input.playbackInstanceId,
          trackId: input.trackId,
          seq: input.seq,
          eventType: input.hearted ? 'heart_on' : 'heart_off',
          positionMs: input.positionMs,
          durationMs: input.durationMs,
          clientWallTime: parseClientWallTime(input.clientWallTime),
          clientMonotonicMs: input.clientMonotonicMs,
          metadata: input.metadata ?? {},
        });
        await tx.execute(sql`
          INSERT INTO session_track_reactions (session_id, track_id, hearted_final, heart_toggle_count, last_event_seq)
          VALUES (${params.id}, ${input.trackId}, ${input.hearted}, 1, ${input.seq})
          ON CONFLICT (session_id, track_id)
          DO UPDATE SET
            hearted_final = EXCLUDED.hearted_final,
            heart_toggle_count = session_track_reactions.heart_toggle_count + 1,
            last_event_seq = EXCLUDED.last_event_seq,
            updated_at = now()
          WHERE session_track_reactions.last_event_seq IS NULL OR EXCLUDED.last_event_seq > session_track_reactions.last_event_seq
        `);
      });
    } catch (error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505' && pgError.constraint?.includes('event_batches')) {
        const [reaction] = await db
          .select()
          .from(schema.sessionTrackReactions)
          .where(and(eq(schema.sessionTrackReactions.sessionId, params.id), eq(schema.sessionTrackReactions.trackId, input.trackId)));
        return reply.send(ok(request, { reaction: reaction ?? null, duplicate: true }));
      }
      if (pgError.code === '23505' && pgError.constraint?.includes('listening_events')) {
        return reply.code(409).send(fail(request, 'DUPLICATE_EVENT_SEQUENCE', 'Event sequence was already used in this session'));
      }
      throw error;
    }

    await db.update(schema.sessions).set({ lastEventAt: new Date() }).where(eq(schema.sessions.id, params.id));
    const [reaction] = await db
      .select()
      .from(schema.sessionTrackReactions)
      .where(and(eq(schema.sessionTrackReactions.sessionId, params.id), eq(schema.sessionTrackReactions.trackId, input.trackId)));

    return reply.send(ok(request, { reaction, duplicate: false }));
  });

  app.get('/api/v1/sessions/:id/reactions', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, params.id));

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    await assertPairMember(request.user.id, session.pairId);
    if (session.userId !== request.user.id && session.visibility === 'private') {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    const reactions = await db.select().from(schema.sessionTrackReactions).where(eq(schema.sessionTrackReactions.sessionId, params.id));
    return reply.send(ok(request, reactions));
  });

  app.get('/api/v1/sessions/:id', { preHandler: requireUser }, async (request: any, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, params.id));

    if (!session) {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    await assertPairMember(request.user.id, session.pairId);
    if (session.userId !== request.user.id && session.visibility === 'private') {
      return reply.code(404).send(fail(request, 'SESSION_NOT_FOUND', 'Session not found'));
    }

    if (session.userId !== request.user.id && session.visibility === 'summary') {
      const [summary] = await db.select().from(schema.sessionSummaries).where(eq(schema.sessionSummaries.sessionId, session.id));
      return reply.send(ok(request, sessionPayloadForViewer(session, request.user.id, summary ?? null)));
    }

    return reply.send(ok(request, sessionPayloadForViewer(session, request.user.id)));
  });

  app.get('/openapi.json', async () => app.swagger());
  return app;
}

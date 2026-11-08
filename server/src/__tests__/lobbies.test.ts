import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  MAX_TIER,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type LobbyErrorReason,
  type MatchFoundPayload,
  type Question,
  type QuestionType,
  type RoundResultPayload,
  type RoundStartPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { attachGame } from '../gameServer';
import { LOBBY_ALPHABET } from '../lobby';
import { correctAnswerFor, gradeSubmission, nextQuestion } from '../matchQuestions';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Job {
  fn: () => void;
  ms: number;
  cancelled: boolean;
  ran: boolean;
}

function questionOf(type: QuestionType): Question {
  const seen: string[] = [];
  for (let tier = 1; tier <= MAX_TIER; tier++) {
    for (let i = 0; i < 20; i++) {
      const question = nextQuestion(tier, seen, () => 0, seen, type);
      seen.push(question.id);
      if (question.type !== type) continue;
      const answer = correctAnswerFor(question.id);
      if (answer && gradeSubmission(question, answer, 0).status === 'correct') return question;
    }
  }
  throw new Error(`no ${type} question`);
}

class Box<T> {
  private items: T[] = [];
  private waiting: ((value: T) => void)[] = [];

  push(value: T) {
    const resolve = this.waiting.shift();
    if (resolve) resolve(value);
    else this.items.push(value);
  }

  next(): Promise<T> {
    const value = this.items.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise((resolve) => this.waiting.push(resolve));
  }
}

describe('private lobbies', () => {
  const sockets: Client[] = [];
  let httpServer: http.Server | null = null;
  let ioServer: Server | null = null;
  let now = 10_000;

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    ioServer?.close();
    ioServer = null;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = null;
    }
    now = 10_000;
  });

  function jobsOf() {
    const jobs: Job[] = [];
    return {
      schedule(fn: () => void, ms: number) {
        const job: Job = { fn, ms, cancelled: false, ran: false };
        jobs.push(job);
        return () => {
          job.cancelled = true;
        };
      },
      pending() {
        return jobs.filter((job) => !job.cancelled && !job.ran);
      },
      flush() {
        const next = jobs.filter((job) => !job.cancelled && !job.ran).sort((a, b) => a.ms - b.ms)[0];
        if (!next) return false;
        next.ran = true;
        next.fn();
        return true;
      },
    };
  }

  async function boot(lobbyTtlMs = 600_000) {
    const timers = jobsOf();
    const question = questionOf('name_concept');
    httpServer = http.createServer();
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
    attachGame(ioServer, {
      clock: { now: () => now },
      schedule: timers.schedule,
      chooseQuestion: () => question,
      pacing: { matchStartMs: 0, roundGapMs: 0, roundGapUltimateMs: 0, matchEndMs: 0, lobbyTtlMs },
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    return {
      url: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`,
      timers,
      answer: correctAnswerFor(question.id)!,
    };
  }

  function client(url: string): Client {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    return socket;
  }

  async function connected(socket: Client) {
    if (socket.connected) return;
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
  }

  it('plays a lobby match, then the code is gone', async () => {
    const { url, timers, answer } = await boot();
    const host = client(url);
    const guest = client(url);
    const third = client(url);
    await Promise.all([connected(host), connected(guest), connected(third)]);
    const created = new Box<string>();
    const matched = new Box<MatchFoundPayload>();
    const starts = new Box<RoundStartPayload>();
    const results = new Box<RoundResultPayload>();
    const thirdErrors = new Box<LobbyErrorReason>();
    host.on(SERVER_EVENTS.LOBBY_CREATED, (payload) => created.push(payload.code));
    host.on(SERVER_EVENTS.MATCH_FOUND, (payload) => matched.push(payload));
    guest.on(SERVER_EVENTS.MATCH_FOUND, (payload) => matched.push(payload));
    host.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
    host.on(SERVER_EVENTS.ROUND_RESULT, (payload) => results.push(payload));
    third.on(SERVER_EVENTS.LOBBY_ERROR, (payload) => thirdErrors.push(payload.reason));

    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: '  Ada\n' });
    const code = await created.next();
    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: `  ${code.toLowerCase()}  `, displayName: 'Bea\u0007' });
    const hostFound = await matched.next();
    const guestFound = await matched.next();
    expect(hostFound.you.name).toBe('Ada');
    expect(hostFound.opponent.name).toBe('Bea');
    expect(guestFound.you.name).toBe('Bea');
    expect(guestFound.opponent.name).toBe('Ada');
    expect(timers.flush()).toBe(true);
    const start = await starts.next();
    host.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
      matchId: start.matchId,
      round: start.round,
      questionId: start.question.id,
      answer,
    });
    const result = await results.next();
    expect(result.outcomes[host.id ?? '']?.correct).toBe(true);

    third.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: 'Cora' });
    expect(await thirdErrors.next()).toBe('not_found');
    const busy = new Box<LobbyErrorReason>();
    host.on(SERVER_EVENTS.LOBBY_ERROR, (payload) => busy.push(payload.reason));
    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada' });
    expect(await busy.next()).toBe('busy');
  });

  it("uses each player's character in a lobby match, and 'player' when it is missing or invalid", async () => {
    const { url } = await boot();
    const pair = async (hostCharacter: unknown, guestCharacter: unknown) => {
      const host = client(url);
      const guest = client(url);
      await Promise.all([connected(host), connected(guest)]);
      const created = new Box<string>();
      const matched = new Box<MatchFoundPayload>();
      host.on(SERVER_EVENTS.LOBBY_CREATED, (payload) => created.push(payload.code));
      host.on(SERVER_EVENTS.MATCH_FOUND, (payload) => matched.push(payload));
      host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada', characterId: hostCharacter as string });
      const code = await created.next();
      guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: 'Bea', characterId: guestCharacter as string });
      return matched.next();
    };

    const found = await pair('glitch', ' skye ');
    expect(found.you.characterId).toBe('glitch');
    expect(found.opponent.characterId).toBe('skye');

    const fallback = await pair(undefined, '<img src=x>');
    expect(fallback.you.characterId).toBe('player');
    expect(fallback.opponent.characterId).toBe('player');
  });

  it('rejects a wrong code, your own lobby, and a socket that is already busy', async () => {
    const { url } = await boot();
    const host = client(url);
    const guest = client(url);
    await Promise.all([connected(host), connected(guest)]);
    const created = new Box<string>();
    const hostErrors = new Box<LobbyErrorReason>();
    const guestErrors = new Box<LobbyErrorReason>();
    host.on(SERVER_EVENTS.LOBBY_CREATED, (payload) => created.push(payload.code));
    host.on(SERVER_EVENTS.LOBBY_ERROR, (payload) => hostErrors.push(payload.reason));
    guest.on(SERVER_EVENTS.LOBBY_ERROR, (payload) => guestErrors.push(payload.reason));

    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: 'nope', displayName: 'Bea' });
    expect(await guestErrors.next()).toBe('not_found');

    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada' });
    const code = await created.next();
    host.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: 'Ada' });
    expect(await hostErrors.next()).toBe('own_lobby');
    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Other' });
    expect(await hostErrors.next()).toBe('busy');

    guest.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: 'Bea' });
    expect(await guestErrors.next()).toBe('busy');
  });

  it('uses a 5-character code from the lobby alphabet', async () => {
    const { url } = await boot();
    const host = client(url);
    await connected(host);
    const created = new Box<string>();
    const closed = new Box<string>();
    host.on(SERVER_EVENTS.LOBBY_CREATED, (payload) => created.push(payload.code));
    host.on(SERVER_EVENTS.LOBBY_CLOSED, (payload) => closed.push(payload.reason));
    expect(LOBBY_ALPHABET).not.toMatch(/[01IOL]/);
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada' });
      const code = await created.next();
      expect(code).toHaveLength(5);
      expect(code).toMatch(new RegExp(`^[${LOBBY_ALPHABET}]{5}$`));
      codes.push(code);
      host.emit(CLIENT_EVENTS.LOBBY_LEAVE);
      expect(await closed.next()).toBe('host_left');
    }
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it('removes a lobby when it expires or the host disconnects, and rate limits failures', async () => {
    const { url, timers } = await boot(40);
    const host = client(url);
    const guest = client(url);
    await Promise.all([connected(host), connected(guest)]);
    const created = new Box<string>();
    const closed = new Box<string>();
    const errors = new Box<LobbyErrorReason>();
    host.on(SERVER_EVENTS.LOBBY_CREATED, (payload) => created.push(payload.code));
    host.on(SERVER_EVENTS.LOBBY_CLOSED, (payload) => closed.push(payload.reason));
    guest.on(SERVER_EVENTS.LOBBY_ERROR, (payload) => errors.push(payload.reason));

    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada' });
    await created.next();
    expect(timers.pending().map((job) => job.ms)).toContain(40);
    expect(timers.flush()).toBe(true);
    expect(await closed.next()).toBe('expired');

    host.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: 'Ada' });
    const code = await created.next();
    const gone = new Promise<void>((resolve) => host.on('disconnect', () => resolve()));
    host.disconnect();
    await gone;
    for (let i = 0; i < 20 && timers.pending().some((job) => !job.cancelled); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(timers.pending()).toEqual([]);
    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: 'Bea' });
    expect(await errors.next()).toBe('not_found');

    for (let i = 0; i < 4; i++) {
      guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: 'ZZZZZ', displayName: 'Bea' });
      expect(await errors.next()).toBe('not_found');
    }
    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: 'ZZZZZ', displayName: 'Bea' });
    expect(await errors.next()).toBe('rate_limited');
    now += 60_000;
    guest.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: 'ZZZZZ', displayName: 'Bea' });
    expect(await errors.next()).toBe('not_found');
  });
});

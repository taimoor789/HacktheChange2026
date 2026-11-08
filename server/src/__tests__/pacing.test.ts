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
  type MatchEndPayload,
  type Question,
  type QuestionType,
  type RoundResultPayload,
  type RoundStartPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { attachGame, type Pacing } from '../gameServer';
import { correctAnswerFor, gradeSubmission, nextQuestion } from '../matchQuestions';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Job {
  fn: () => void;
  ms: number;
  cancelled: boolean;
  ran: boolean;
}

const pacing: Pacing = {
  matchStartMs: 40,
  roundGapMs: 25,
  roundGapUltimateMs: 80,
  matchEndMs: 30,
  lobbyTtlMs: 600_000,
};

function questionOf(type: QuestionType): Question {
  const seen: string[] = [];
  for (let tier = 1; tier <= MAX_TIER; tier++) {
    for (let i = 0; i < 30; i++) {
      const question = nextQuestion(tier, seen, () => 0, seen, type);
      seen.push(question.id);
      if (question.type !== type) continue;
      const answer = correctAnswerFor(question.id);
      if (answer && gradeSubmission(question, answer, 0).status === 'correct') return question;
    }
  }
  throw new Error(`no ${type} question`);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('round pacing', () => {
  const sockets: Client[] = [];
  let httpServer: http.Server | null = null;
  let ioServer: Server | null = null;

  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    ioServer?.close();
    ioServer = null;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = null;
    }
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
        const next = jobs
          .filter((job) => !job.cancelled && !job.ran)
          .sort((a, b) => a.ms - b.ms)[0];
        if (!next) return false;
        next.ran = true;
        next.fn();
        return true;
      },
    };
  }

  async function boot(schedule: (fn: () => void, ms: number) => () => void) {
    const question = questionOf('name_concept');
    httpServer = http.createServer();
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
    attachGame(ioServer, {
      clock: { now: () => 5_000 },
      schedule,
      chooseQuestion: () => question,
      pacing,
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    return {
      url: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`,
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

  function submit(socket: Client, start: RoundStartPayload, answer: string) {
    socket.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
      matchId: start.matchId,
      round: start.round,
      questionId: start.question.id,
      answer,
    });
  }

  it('sends round:start only after the start delay, not with match:found', async () => {
    httpServer = http.createServer();
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
    attachGame(ioServer, {
      clock: { now: () => 5_000 },
      chooseQuestion: () => questionOf('name_concept'),
      pacing: { ...pacing, matchStartMs: 50 },
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    let started = false;
    b.on(SERVER_EVENTS.ROUND_START, () => {
      started = true;
    });
    const found = new Promise<void>((resolve) => b.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await found;
    await wait(15);
    expect(started).toBe(false);
    await wait(80);
    expect(started).toBe(true);
  });

  it('uses the longer gap after an ultimate and delays match:end', async () => {
    const timers = jobsOf();
    const { url, answer } = await boot(timers.schedule);
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    const starts: RoundStartPayload[] = [];
    const results: RoundResultPayload[] = [];
    const ends: MatchEndPayload[] = [];
    const nextStart = () =>
      new Promise<RoundStartPayload>((resolve) => {
        const ready = starts.length;
        const timer = setInterval(() => {
          if (starts.length > ready) {
            clearInterval(timer);
            resolve(starts[starts.length - 1]);
          }
        }, 5);
      });
    const nextResult = () =>
      new Promise<RoundResultPayload>((resolve) => {
        const ready = results.length;
        const timer = setInterval(() => {
          if (results.length > ready) {
            clearInterval(timer);
            resolve(results[results.length - 1]);
          }
        }, 5);
      });
    a.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
    a.on(SERVER_EVENTS.ROUND_RESULT, (payload) => results.push(payload));
    a.on(SERVER_EVENTS.MATCH_END, (payload) => ends.push(payload));
    const matched = new Promise<void>((resolve) => a.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await matched;
    expect(timers.pending().map((job) => job.ms)).toEqual([pacing.matchStartMs]);
    expect(starts).toEqual([]);

    let ultimateGap = false;
    for (let guard = 0; guard < 12 && !ultimateGap && ends.length === 0; guard++) {
      expect(timers.flush()).toBe(true);
      const start = await nextStart();
      const resultPromise = nextResult();
      submit(a, start, answer);
      const result = await resultPromise;
      const pending = timers.pending();
      if (result.damage.some((hit) => hit.attackSize === 'ultimate')) {
        expect(pending.map((job) => job.ms)).toEqual([pacing.roundGapUltimateMs]);
        ultimateGap = true;
      } else if (pending.length === 1 && pending[0]?.ms === pacing.matchEndMs) {
        break;
      } else {
        expect(pending.map((job) => job.ms)).toEqual([pacing.roundGapMs]);
      }
    }
    expect(ultimateGap).toBe(true);

    while (timers.pending().length > 0) timers.flush();
    await wait(20);
    expect(ends).toHaveLength(1);
    const startsAtEnd = starts.length;
    expect(timers.flush()).toBe(false);
    await wait(10);
    expect(starts).toHaveLength(startsAtEnd);
  });

  it('forfeits during a gap and does not start another round', async () => {
    const timers = jobsOf();
    const { url, answer } = await boot(timers.schedule);
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    const starts: RoundStartPayload[] = [];
    const results: RoundResultPayload[] = [];
    const started = new Promise<RoundStartPayload>((resolve) => {
      b.on(SERVER_EVENTS.ROUND_START, (payload) => {
        starts.push(payload);
        resolve(payload);
      });
    });
    const resulted = new Promise<void>((resolve) => {
      b.on(SERVER_EVENTS.ROUND_RESULT, (payload) => {
        results.push(payload);
        resolve();
      });
    });
    const ended = new Promise<MatchEndPayload>((resolve) => b.on(SERVER_EVENTS.MATCH_END, resolve));
    const matched = new Promise<void>((resolve) => b.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await matched;
    expect(timers.flush()).toBe(true);
    const start = await started;
    submit(a, start, answer);
    await resulted;
    expect(results).toHaveLength(1);
    expect(timers.pending().map((job) => job.ms)).toEqual([pacing.roundGapMs]);
    a.disconnect();
    const end = await ended;
    expect(end.reason).toBe('forfeit');
    expect(end.winnerId).toBe(b.id);
    expect(timers.pending()).toEqual([]);
    expect(timers.flush()).toBe(false);
    await wait(10);
    expect(starts).toHaveLength(1);
  });
});

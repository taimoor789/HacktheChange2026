import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  MAX_ROUNDS,
  MAX_TIER,
  ROUNDS_PER_TIER,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type MatchEndPayload,
  type MatchFoundPayload,
  type Question,
  type QuestionType,
  type RoundResultPayload,
  type RoundStartPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { attachGame, type GameServerOptions } from '../gameServer';
import { correctAnswerFor, gradeSubmission, nextQuestion } from '../matchQuestions';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Job {
  fn: () => void;
  ms: number;
  cancelled: boolean;
  ran: boolean;
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

  tryNext(): T | undefined {
    return this.items.shift();
  }
}

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

function nearMiss(question: Question): string {
  for (const answer of question.acceptedAnswers) {
    for (let i = 0; i < answer.length; i++) {
      const cut = answer.slice(0, i) + answer.slice(i + 1);
      if (cut && gradeSubmission(question, cut, 0).status === 'suggest') return cut;
    }
  }
  throw new Error('no hintable typo');
}

function sid(socket: Client): string {
  if (!socket.id) throw new Error('socket id missing');
  return socket.id;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('socket edge cases', () => {
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

  async function boot(options: GameServerOptions): Promise<string> {
    httpServer = http.createServer();
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
    attachGame(ioServer, {
      pacing: { matchStartMs: 0, roundGapMs: 0, roundGapUltimateMs: 0, matchEndMs: 0 },
      ...options,
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
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

  function jobsOf() {
    const jobs: Job[] = [];
    return {
      jobs,
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

  function submit(socket: Client, start: RoundStartPayload, answer: string) {
    socket.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
      matchId: start.matchId,
      round: start.round,
      questionId: start.question.id,
      answer,
    });
  }

  it('forfeits a disconnect during round 1 before any result, and clears timers', async () => {
    const clock = { now: () => 1_000 };
    const timers = jobsOf();
    const url = await boot({ clock, schedule: timers.schedule, chooseQuestion: () => questionOf('name_concept') });
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    const found = new Promise<MatchFoundPayload>((resolve) => b.on(SERVER_EVENTS.MATCH_FOUND, resolve));
    const started = new Promise<void>((resolve) => b.on(SERVER_EVENTS.ROUND_START, () => resolve()));
    const ended = new Promise<MatchEndPayload>((resolve) => b.on(SERVER_EVENTS.MATCH_END, resolve));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    const match = await found;
    expect(timers.flush()).toBe(true);
    await started;
    a.disconnect();
    const end = await ended;
    expect(end.reason).toBe('forfeit');
    expect(end.winnerId).toBe(match.you.id);
    expect(end.review).toEqual([]);
    expect(timers.pending()).toEqual([]);
    expect(timers.flush()).toBe(false);
  });

  it('forfeits a disconnect while the first round has not started', async () => {
    const timers = jobsOf();
    const url = await boot({
      clock: { now: () => 1_000 },
      schedule: timers.schedule,
      chooseQuestion: () => questionOf('name_concept'),
    });
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    const found = new Promise<MatchFoundPayload>((resolve) => b.on(SERVER_EVENTS.MATCH_FOUND, resolve));
    const starts: RoundStartPayload[] = [];
    b.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
    const ended = new Promise<MatchEndPayload>((resolve) => b.on(SERVER_EVENTS.MATCH_END, resolve));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    const match = await found;
    expect(timers.pending()).toHaveLength(1);
    a.disconnect();
    const end = await ended;
    expect(end.reason).toBe('forfeit');
    expect(end.winnerId).toBe(match.you.id);
    expect(end.review).toEqual([]);
    expect(timers.pending()).toEqual([]);
    expect(timers.flush()).toBe(false);
    expect(starts).toEqual([]);
  });

  it('drops a waiting socket and ignores a second join', async () => {
    const url = await boot({ clock: { now: () => 1_000 }, schedule: () => () => {} });
    const ada = client(url);
    await connected(ada);
    ada.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    await wait(30);
    const gone = new Promise<void>((resolve) => ada.on('disconnect', () => resolve()));
    ada.disconnect();
    await gone;

    const bea = client(url);
    const cora = client(url);
    await Promise.all([connected(bea), connected(cora)]);
    const paired = new Promise<MatchFoundPayload>((resolve) => bea.on(SERVER_EVENTS.MATCH_FOUND, resolve));
    bea.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    cora.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Cora', characterId: 'cora' });
    const match = await paired;
    expect(match.you.name).toBe('Bea');
    expect(match.opponent.name).toBe('Cora');

    const again = client(url);
    await connected(again);
    let joins = 0;
    again.on(SERVER_EVENTS.MATCH_FOUND, () => {
      joins += 1;
    });
    again.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Dee', characterId: 'dee' });
    again.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Dee', characterId: 'dee' });
    const partner = client(url);
    await connected(partner);
    const found = new Promise<MatchFoundPayload>((resolve) => partner.on(SERVER_EVENTS.MATCH_FOUND, resolve));
    partner.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Eve', characterId: 'eve' });
    const second = await found;
    expect(second.opponent.name).toBe('Dee');
    expect(joins).toBe(1);
    again.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Dee', characterId: 'dee' });
    const extra = client(url);
    await connected(extra);
    const ignored = new Promise<string>((resolve) => {
      extra.on(SERVER_EVENTS.MATCH_FOUND, () => resolve('matched'));
      setTimeout(() => resolve('waiting'), 80);
    });
    extra.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Fay', characterId: 'fay' });
    expect(await ignored).toBe('waiting');
  });

  it('ignores malformed, oversized, late, foreign, and duplicate submissions', async () => {
    const question = questionOf('name_concept');
    const right = correctAnswerFor(question.id)!;
    let now = 10_000;
    const timers = jobsOf();
    const url = await boot({
      clock: { now: () => now },
      schedule: timers.schedule,
      chooseQuestion: () => question,
    });
    const a = client(url);
    const b = client(url);
    const outsider = client(url);
    await Promise.all([connected(a), connected(b), connected(outsider)]);
    const starts = new Box<RoundStartPayload>();
    const results = new Box<RoundResultPayload>();
    const ended = new Box<MatchEndPayload>();
    b.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
    b.on(SERVER_EVENTS.ROUND_RESULT, (payload) => results.push(payload));
    b.on(SERVER_EVENTS.MATCH_END, (payload) => ended.push(payload));
    const matched = new Promise<void>((resolve) => b.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await matched;
    expect(timers.flush()).toBe(true);
    const start = await starts.next();

    const bad = { matchId: start.matchId, round: start.round, questionId: start.question.id, answer: right };
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, null as never);
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { ...bad, answer: 12 } as never);
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { ...bad, answer: 'z'.repeat(2001) });
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { ...bad, matchId: 'other-match' });
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { ...bad, round: start.round + 3 });
    a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { ...bad, questionId: 'other-question' });
    outsider.emit(CLIENT_EVENTS.ANSWER_SUBMIT, bad);
    now = start.deadline + 1;
    submit(a, start, right);
    await wait(40);
    now = start.serverNow;
    const counted = 'z'.repeat(2000);
    submit(a, start, counted);
    submit(a, start, right);
    submit(b, start, right);

    const result = await results.next();
    expect(result.outcomes[sid(a)]?.answered).toBe(true);
    expect(result.outcomes[sid(a)]?.correct).toBe(false);
    expect(result.outcomes[sid(b)]?.correct).toBe(true);
    expect(a.connected).toBe(true);
    const adaId = sid(a);
    a.disconnect();
    const end = await ended.next();
    expect(end.reason).toBe('forfeit');
    expect(end.winnerId).toBe(sid(b));
    expect(end.review).toHaveLength(1);
    expect(end.review[0]?.answers[adaId]?.submitted).toBe(counted);
    expect(timers.pending()).toEqual([]);
  });

  it('gives one hint for a repeated near-miss and does not send it to the opponent', async () => {
    const question = questionOf('name_concept');
    const miss = nearMiss(question);
    expect(gradeSubmission(question, miss, 1).status).toBe('wrong');
    const right = correctAnswerFor(question.id)!;
    const timers = jobsOf();
    const url = await boot({
      clock: { now: () => 1_000 },
      schedule: timers.schedule,
      chooseQuestion: () => question,
    });
    const a = client(url);
    const b = client(url);
    await Promise.all([connected(a), connected(b)]);
    const starts = new Box<RoundStartPayload>();
    const hintsA = new Box<string>();
    const hintsB: string[] = [];
    const results = new Box<RoundResultPayload>();
    a.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
    a.on(SERVER_EVENTS.ANSWER_HINT, (payload) => hintsA.push(payload.suggestion));
    b.on(SERVER_EVENTS.ANSWER_HINT, (payload) => hintsB.push(payload.suggestion));
    b.on(SERVER_EVENTS.ROUND_RESULT, (payload) => results.push(payload));
    const matched = new Promise<void>((resolve) => a.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await matched;
    expect(timers.flush()).toBe(true);
    const start = await starts.next();
    submit(a, start, miss);
    expect(await hintsA.next()).toEqual(expect.any(String));
    submit(a, start, miss);
    submit(a, start, miss);
    submit(b, start, right);
    const result = await results.next();
    expect(hintsA.tryNext()).toBeUndefined();
    expect(hintsB).toEqual([]);
    expect(result.outcomes[sid(a)]?.answered).toBe(true);
    expect(result.outcomes[sid(a)]?.correct).toBe(false);
    expect(result.outcomes[sid(b)]?.correct).toBe(true);
  });

  it('leaves no round timer after a knockout, a finished ladder, the round cap, or a forfeit', async () => {
    const knockout = questionOf('name_concept');
    const right = correctAnswerFor(knockout.id)!;
    const koTimers = jobsOf();
    const koUrl = await boot({
      clock: { now: () => 2_000 },
      schedule: koTimers.schedule,
      chooseQuestion: () => knockout,
    });
    const koA = client(koUrl);
    const koB = client(koUrl);
    await Promise.all([connected(koA), connected(koB)]);
    const koStarts = new Box<RoundStartPayload>();
    const koResults = new Box<RoundResultPayload>();
    const koEnds = new Box<MatchEndPayload>();
    koA.on(SERVER_EVENTS.ROUND_START, (payload) => koStarts.push(payload));
    koA.on(SERVER_EVENTS.ROUND_RESULT, (payload) => koResults.push(payload));
    koB.on(SERVER_EVENTS.MATCH_END, (payload) => koEnds.push(payload));
    const koMatched = new Promise<void>((resolve) => koA.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    koA.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    koB.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await koMatched;
    let ko: MatchEndPayload | null = null;
    for (let guard = 0; guard < 20 && !ko; guard++) {
      expect(koTimers.flush()).toBe(true);
      const start = await koStarts.next();
      submit(koA, start, right);
      const result = await koResults.next();
      const knockedOut = Object.values(result.players).some((player) => player.hp <= 0);
      if (knockedOut) {
        expect(koTimers.flush()).toBe(true);
        ko = koEnds.tryNext() ?? (await koEnds.next());
      }
    }
    expect(ko?.reason).toBe('hp_zero');
    expect(koTimers.pending()).toEqual([]);

    for (const socket of sockets) socket.close();
    sockets.length = 0;
    ioServer?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));

    const scored = questionOf('spot_the_bug');
    const scoredAnswer = correctAnswerFor(scored.id)!;
    let now = 3_000;
    const ladderTimers = jobsOf();
    const ladderUrl = await boot({
      clock: { now: () => now },
      schedule: ladderTimers.schedule,
      chooseQuestion: () => scored,
    });
    const ladA = client(ladderUrl);
    const ladB = client(ladderUrl);
    await Promise.all([connected(ladA), connected(ladB)]);
    const ladderStarts = new Box<RoundStartPayload>();
    const ladderResults = new Box<RoundResultPayload>();
    const ladderEnds = new Box<MatchEndPayload>();
    ladA.on(SERVER_EVENTS.ROUND_START, (payload) => ladderStarts.push(payload));
    ladA.on(SERVER_EVENTS.ROUND_RESULT, (payload) => ladderResults.push(payload));
    ladA.on(SERVER_EVENTS.MATCH_END, (payload) => ladderEnds.push(payload));
    const ladderMatched = new Promise<void>((resolve) => ladA.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    ladA.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    ladB.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await ladderMatched;
    for (let round = 0; round < MAX_TIER * ROUNDS_PER_TIER; round++) {
      expect(ladderTimers.flush()).toBe(true);
      const start = await ladderStarts.next();
      now = start.deadline;
      submit(ladA, start, scoredAnswer);
      submit(ladB, start, scoredAnswer);
      await ladderResults.next();
    }
    expect(ladderTimers.flush()).toBe(true);
    const ladderEnd = await ladderEnds.next();
    expect(ladderEnd.reason).toBe('tiers_complete');
    expect(ladderTimers.pending()).toEqual([]);

    for (const socket of sockets) socket.close();
    sockets.length = 0;
    ioServer?.close();
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));

    const capTimers = jobsOf();
    const capUrl = await boot({
      clock: { now: () => 4_000 },
      schedule: capTimers.schedule,
      chooseQuestion: () => questionOf('name_concept'),
    });
    const capA = client(capUrl);
    const capB = client(capUrl);
    await Promise.all([connected(capA), connected(capB)]);
    const capEnd = new Promise<MatchEndPayload>((resolve) => capB.on(SERVER_EVENTS.MATCH_END, resolve));
    const capMatched = new Promise<void>((resolve) => capB.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
    capA.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    capB.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
    await capMatched;
    while (capTimers.pending().length > 0) capTimers.flush();
    const capped = await capEnd;
    expect(capped.reason).toBe('max_rounds');
    expect(capped.review).toHaveLength(MAX_ROUNDS);
    expect(capped.players[sid(capA)]?.hp).toBeGreaterThan(0);
    expect(capped.players[sid(capB)]?.hp).toBeGreaterThan(0);
    expect(capTimers.pending()).toEqual([]);
  });

  it('logs a handler error and keeps the process serving', async () => {
    const question = questionOf('name_concept');
    const right = correctAnswerFor(question.id)!;
    const timers = jobsOf();
    let calls = 0;
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const url = await boot({
        clock: { now: () => 1_000 },
        chooseQuestion: () => question,
        schedule: (fn, ms) => {
          calls += 1;
          if (calls === 3) throw new Error('timer failed');
          return timers.schedule(fn, ms);
        },
      });
      const a = client(url);
      const b = client(url);
      await Promise.all([connected(a), connected(b)]);
      const starts = new Box<RoundStartPayload>();
      const results = new Box<RoundResultPayload>();
      a.on(SERVER_EVENTS.ROUND_START, (payload) => starts.push(payload));
      a.on(SERVER_EVENTS.ROUND_RESULT, (payload) => results.push(payload));
      const matched = new Promise<void>((resolve) => a.on(SERVER_EVENTS.MATCH_FOUND, () => resolve()));
      a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
      b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });
      await matched;
      expect(timers.flush()).toBe(true);
      const start = await starts.next();
      submit(a, start, right);
      const result = await results.next();
      expect(result.outcomes[sid(a)]?.correct).toBe(true);
      expect(errors.some((args) => String(args[0]).includes('[socket] handler error'))).toBe(true);
      expect(a.connected).toBe(true);
      expect(b.connected).toBe(true);
      submit(a, start, right);
      await wait(20);
      expect(a.connected).toBe(true);
    } finally {
      console.error = original;
    }
  });
});

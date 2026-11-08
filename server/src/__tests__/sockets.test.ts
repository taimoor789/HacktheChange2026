import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type MatchEndPayload,
  type Question,
  type RoundResultPayload,
  type RoundStartPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { attachGame } from '../gameServer';
import { correctAnswerFor, gradeSubmission, nextQuestion } from '../matchQuestions';

function leaks(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(leaks);
  const record = value as Record<string, unknown>;
  if ('acceptedAnswers' in record || 'explanation' in record) return true;
  return Object.values(record).some(leaks);
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

function nearMisses(question: Question): string[] {
  const found: string[] = [];
  for (const answer of question.acceptedAnswers) {
    for (let i = 0; i < answer.length; i++) {
      const cut = answer.slice(0, i) + answer.slice(i + 1);
      if (cut && gradeSubmission(question, cut, 0).status === 'suggest' && !found.includes(cut)) {
        found.push(cut);
      }
    }
  }
  return found;
}

function hintQuestion(): Question {
  const seen: string[] = [];
  for (let i = 0; i < 40; i++) {
    const question = nextQuestion(1, seen, () => 0, seen, 'name_concept');
    seen.push(question.id);
    if (!question.options && nearMisses(question).length >= 2) return question;
  }
  throw new Error('no name_concept question with two hintable typos');
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('two human players over sockets', () => {
  const closers: (() => void)[] = [];
  const sockets: Socket[] = [];
  let httpServer: http.Server | null = null;
  let ioServer: Server | null = null;

  afterEach(async () => {
    for (const cancel of closers) cancel();
    closers.length = 0;
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    ioServer?.close();
    ioServer = null;
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = null;
    }
  });

  it('pairs two players, hints once, locks a wrong answer, and ends with a reason', async () => {
    const question = hintQuestion();
    const [firstMiss, secondMiss] = nearMisses(question);
    const right = correctAnswerFor(question.id);
    expect(right).toBeTruthy();

    httpServer = http.createServer();
    ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
    attachGame(ioServer, {
      clock: { now: () => 1_700_000_000_000 },
      chooseQuestion: () => question,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        const cancel = () => clearTimeout(timer);
        closers.push(cancel);
        return cancel;
      },
    });
    await new Promise<void>((resolve) => httpServer?.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const a = connect(url, { transports: ['websocket'], forceNew: true });
    const b = connect(url, { transports: ['websocket'], forceNew: true });
    sockets.push(a, b);

    const eventsA = new Box<
      | { kind: 'start'; payload: RoundStartPayload }
      | { kind: 'result'; payload: RoundResultPayload }
      | { kind: 'hint'; suggestion: string }
      | { kind: 'end'; payload: MatchEndPayload }
    >();
    let hintsForB = 0;
    const seen: unknown[] = [];

    a.on(SERVER_EVENTS.MATCH_FOUND, (payload) => seen.push(payload));
    b.on(SERVER_EVENTS.MATCH_FOUND, (payload) => seen.push(payload));
    a.on(SERVER_EVENTS.ROUND_START, (payload) => {
      seen.push(payload);
      eventsA.push({ kind: 'start', payload });
    });
    b.on(SERVER_EVENTS.ROUND_START, (payload) => seen.push(payload));
    a.on(SERVER_EVENTS.ROUND_RESULT, (payload) => {
      seen.push(payload);
      eventsA.push({ kind: 'result', payload });
    });
    b.on(SERVER_EVENTS.ROUND_RESULT, (payload) => seen.push(payload));
    a.on(SERVER_EVENTS.ANSWER_HINT, (payload) => {
      seen.push(payload);
      eventsA.push({ kind: 'hint', suggestion: payload.suggestion });
    });
    b.on(SERVER_EVENTS.ANSWER_HINT, (payload) => {
      hintsForB += 1;
      seen.push(payload);
    });
    a.on(SERVER_EVENTS.ULTIMATE_READY, (payload) => seen.push(payload));
    b.on(SERVER_EVENTS.ULTIMATE_READY, (payload) => seen.push(payload));
    a.on(SERVER_EVENTS.MATCH_END, (payload) => eventsA.push({ kind: 'end', payload }));

    await Promise.all([
      new Promise<void>((resolve) => a.on('connect', () => resolve())),
      new Promise<void>((resolve) => b.on('connect', () => resolve())),
    ]);
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Ada', characterId: 'ada' });
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'Bea', characterId: 'bea' });

    const started = await eventsA.next();
    expect(started.kind).toBe('start');
    if (started.kind !== 'start') return;
    expect(started.payload.question.id).toBe(question.id);

    const submit = (socket: Socket, answer: string) =>
      socket.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
        matchId: started.payload.matchId,
        round: started.payload.round,
        questionId: question.id,
        answer,
      });

    submit(a, firstMiss);
    const hint = await eventsA.next();
    expect(hint.kind).toBe('hint');

    submit(a, secondMiss);
    await wait(40);
    submit(a, right!);
    submit(b, right!);

    const firstResult = await eventsA.next();
    expect(firstResult.kind).toBe('result');
    if (firstResult.kind !== 'result') return;
    const wrong = Object.values(firstResult.payload.outcomes).filter((outcome) => outcome.correct === false);
    const scored = Object.values(firstResult.payload.outcomes).filter((outcome) => outcome.correct === true);
    expect(wrong).toHaveLength(1);
    expect(wrong[0].answered).toBe(true);
    expect(scored).toHaveLength(1);
    expect(hintsForB).toBe(0);

    let ended: MatchEndPayload | null = null;
    let hintsForA = 1;
    for (let guard = 0; guard < 30 && !ended; guard++) {
      const event = await eventsA.next();
      if (event.kind === 'hint') hintsForA += 1;
      if (event.kind === 'end') ended = event.payload;
      if (event.kind === 'start') {
        a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
          matchId: event.payload.matchId,
          round: event.payload.round,
          questionId: event.payload.question.id,
          answer: right!,
        });
      }
    }

    expect(hintsForA).toBe(1);
    expect(ended?.reason).toMatch(/hp_zero|tiers_complete|max_rounds/);
    expect(seen.some(leaks)).toBe(false);
  });
});

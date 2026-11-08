import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type ClientToServerEvents,
  type ConnectUpdatePayload,
  type MatchFoundPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { attachGame } from '../gameServer';
import { sanitizeLinkedinUrl } from '../lobby';
import { correctAnswerFor } from '../matchQuestions';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

describe('sanitizeLinkedinUrl', () => {
  it.each([
    ['https://www.linkedin.com/in/ada-lovelace', 'https://www.linkedin.com/in/ada-lovelace'],
    ['linkedin.com/in/ada/', 'https://www.linkedin.com/in/ada'],
    ['http://ca.linkedin.com/in/ada?trk=x', 'https://www.linkedin.com/in/ada'],
  ])('accepts %s', (raw, want) => expect(sanitizeLinkedinUrl(raw)).toBe(want));

  it.each([
    'javascript:alert(1)',
    'https://evil.com/in/ada',
    'https://linkedin.com.evil.com/in/ada',
    'https://evil.com/linkedin.com/in/ada',
    'https://www.linkedin.com/company/acme',
    'https://user@linkedin.com/in/ada',
    'ada',
    '',
    42,
    undefined,
  ])('rejects %s', (raw) => expect(sanitizeLinkedinUrl(raw)).toBeNull());
});

describe('connect after a match', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  const once = <T>(c: Client, event: string) =>
    new Promise<T>((resolve) => (c as unknown as Socket).once(event, resolve));
  const update = (c: Client) => once<ConnectUpdatePayload>(c, SERVER_EVENTS.CONNECT_UPDATE);

  /** Two players finish a match. Player a answers every round correctly. */
  async function finishedMatch(aLink?: string, bLink?: string) {
    const server = http.createServer();
    const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);
    attachGame(io, {
      preferredType: 'fill_blank',
      pacing: { matchStartMs: 0, roundGapMs: 0, roundGapUltimateMs: 0, matchEndMs: 0 },
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const url = `http://localhost:${(server.address() as AddressInfo).port}`;
    const a: Client = connect(url, { transports: ['websocket'] });
    const b: Client = connect(url, { transports: ['websocket'] });
    cleanup = async () => {
      a.disconnect();
      b.disconnect();
      await io.close();
    };
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);
    const foundA = once<MatchFoundPayload>(a, SERVER_EVENTS.MATCH_FOUND);
    const foundB = once<MatchFoundPayload>(b, SERVER_EVENTS.MATCH_FOUND);
    const endA = once(a, SERVER_EVENTS.MATCH_END);
    const endB = once(b, SERVER_EVENTS.MATCH_END);
    a.on(SERVER_EVENTS.ROUND_START, (p) => {
      a.emit(CLIENT_EVENTS.ANSWER_SUBMIT, {
        matchId: p.matchId,
        round: p.round,
        questionId: p.question.id,
        answer: correctAnswerFor(p.question.id) ?? '',
      });
    });
    a.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'A', characterId: 'glitch', linkedinUrl: aLink });
    await new Promise((resolve) => setTimeout(resolve, 20));
    b.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: 'B', characterId: 'bram', linkedinUrl: bLink });
    const [fa, fb] = await Promise.all([foundA, foundB]);
    await Promise.all([endA, endB]);
    return { a, b, fa, fb, matchId: fa.matchId, aId: fa.you.id, bId: fb.you.id };
  }

  const A = 'https://www.linkedin.com/in/player-a';
  const B = 'https://www.linkedin.com/in/player-b';

  it('never sends a link in match:found, and only swaps links once both press Connect', async () => {
    const { a, b, fa, fb, matchId, aId, bId } = await finishedMatch(A, B);
    expect(JSON.stringify([fa, fb])).not.toContain('linkedin');

    const waiting = update(a);
    const requested = update(b);
    a.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: bId });
    expect(await waiting).toEqual({ matchId, status: 'waiting' });
    expect(await requested).toEqual({ matchId, status: 'requested' });

    const toA = update(a);
    const toB = update(b);
    b.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: aId });
    expect(await toA).toEqual({ matchId, status: 'connected', opponentLinkedinUrl: B });
    expect(await toB).toEqual({ matchId, status: 'connected', opponentLinkedinUrl: A });
  });

  it('sends null when the opponent added no link or an invalid one', async () => {
    const { a, b, matchId, aId, bId } = await finishedMatch(A, 'https://evil.com/in/x');
    const first = update(a);
    const second = update(b);
    a.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: bId });
    await Promise.all([first, second]);
    const toA = update(a);
    const toB = update(b);
    b.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: aId });
    expect(await toA).toEqual({ matchId, status: 'connected', opponentLinkedinUrl: null });
    expect(await toB).toEqual({ matchId, status: 'connected', opponentLinkedinUrl: A });
  });

  it('tells the waiting player when the opponent leaves first', async () => {
    const { a, b, matchId, bId } = await finishedMatch(A, B);
    const first = update(a);
    a.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: bId });
    await first;
    const gone = update(a);
    b.disconnect();
    expect(await gone).toEqual({ matchId, status: 'unavailable' });
  });

  it('ignores a request with the wrong match or player', async () => {
    const { a, matchId, bId } = await finishedMatch(A, B);
    const updates: ConnectUpdatePayload[] = [];
    a.on(SERVER_EVENTS.CONNECT_UPDATE, (p) => updates.push(p));
    a.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId: 'nope', targetPlayerId: bId });
    a.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId, targetPlayerId: 'nope' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(updates).toEqual([]);
  });
});

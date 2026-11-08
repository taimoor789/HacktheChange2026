// OWNER A: human vs human matches over Socket.IO.
// The pure engine is resolveRound. This file only times rounds and maps events.
import type { Server, Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  LOBBY_TTL_MS,
  MATCH_END_DELAY_MS,
  MATCH_START_DELAY_MS,
  ROUND_GAP_MS,
  ROUND_GAP_ULTIMATE_MS,
  SERVER_EVENTS,
  STARTING_HP,
  type AnswerSubmitPayload,
  type ClientToServerEvents,
  type ConnectRequestPayload,
  type ConnectUpdatePayload,
  type DamageEvent,
  type MatchEndPayload,
  type PlayerRoundOutcome,
  type PlayerState,
  type QueueJoinPayload,
  type QuestionType,
  type LobbyCreatePayload,
  type LobbyErrorReason,
  type LobbyJoinPayload,
  type Question,
  type ReviewItem,
  type ServerToClientEvents,
} from '@beatcode/shared';
import type { Clock } from './match';
import { Match, type MatchPlayer } from './match';
import {
  joinRateLimited,
  makeLobbyCode,
  normalizeLobbyCode,
  recentFailures,
  sanitizeDisplayName,
  sanitizeLinkedinUrl,
} from './lobby';
import { correctAnswerFor } from './matchQuestions';
import type { ResolveRoundResult } from './engine/resolveRound';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface Pacing {
  matchStartMs: number;
  roundGapMs: number;
  roundGapUltimateMs: number;
  matchEndMs: number;
  lobbyTtlMs: number;
}

export interface GameServerOptions {
  clock?: Clock;
  /** Returns a cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  rng?: () => number;
  preferredType?: QuestionType;
  chooseQuestion?: (tier: number, usedIds: readonly string[], rng: () => number) => Question;
  /** Overrides the shared delays. Missing fields fall back to env, then the shared constants. */
  pacing?: Partial<Pacing>;
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function resolvePacing(override?: Partial<Pacing>): Pacing {
  const pacing: Pacing = {
    matchStartMs: envMs('MATCH_START_DELAY_MS', MATCH_START_DELAY_MS),
    roundGapMs: envMs('ROUND_GAP_MS', ROUND_GAP_MS),
    roundGapUltimateMs: envMs('ROUND_GAP_ULTIMATE_MS', ROUND_GAP_ULTIMATE_MS),
    matchEndMs: envMs('MATCH_END_DELAY_MS', MATCH_END_DELAY_MS),
    lobbyTtlMs: envMs('LOBBY_TTL_MS', LOBBY_TTL_MS),
  };
  if (!override) return pacing;
  for (const key of Object.keys(override) as (keyof Pacing)[]) {
    const value = override[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) pacing[key] = value;
  }
  return pacing;
}

interface Waiting {
  socket: Sock;
  payload: QueueJoinPayload;
}

interface Room {
  matchId: string;
  match: Match;
  sockets: Map<string, Sock>;
  profiles: Map<string, { name: string; characterId: string; linkedinUrl: string | null }>;
  /** Players who pressed Connect after the match. Links are only sent once both have. */
  connectRequests: Set<string>;
  timers: (() => void)[];
  ended: boolean;
  round: number;
  questionId: string;
}

const MAX_SUBMIT_CHARS = 2000;

function reportHandlerError(error: unknown) {
  console.error('[socket] handler error', error);
}

function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args) => {
    try {
      fn(...args);
    } catch (error) {
      reportHandlerError(error);
    }
  };
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function attachGame(io: IO, options: GameServerOptions = {}): void {
  const clock = options.clock ?? { now: () => Date.now() };
  const schedule = options.schedule ?? defaultSchedule;
  const pacing = resolvePacing(options.pacing);
  const waiting: Waiting[] = [];
  const rooms = new Map<string, Room>();
  const lobbies = new Map<
    string,
    { host: Sock; displayName: string; linkedinUrl?: string; createdAt: number; cancel: () => void }
  >();
  const lobbyBySocket = new Map<string, string>();
  const joinFailures = new Map<string, number[]>();
  let matchSeq = 1;

  const isBusy = (socketId: string) =>
    rooms.has(socketId) || lobbyBySocket.has(socketId) || waiting.some((item) => item.socket.id === socketId);

  const removeLobby = (code: string) => {
    const lobby = lobbies.get(code);
    if (!lobby) return;
    lobby.cancel();
    lobbies.delete(code);
    lobbyBySocket.delete(lobby.host.id);
  };

  const failJoin = (socket: Sock, reason: LobbyErrorReason) => {
    const now = clock.now();
    const stamps = recentFailures(joinFailures.get(socket.id) ?? [], now);
    stamps.push(now);
    joinFailures.set(socket.id, stamps);
    socket.emit(SERVER_EVENTS.LOBBY_ERROR, { reason });
  };

  const dropWaiting = (socketId: string) => {
    const index = waiting.findIndex((item) => item.socket.id === socketId);
    if (index >= 0) waiting.splice(index, 1);
  };

  const playerState = (room: Room, id: string): PlayerState => {
    const profile = room.profiles.get(id);
    const live = room.match.livePlayers.find((player) => player.id === id);
    return {
      id,
      name: profile?.name ?? id,
      characterId: profile?.characterId ?? 'player',
      hp: live?.hp ?? STARTING_HP,
      maxHp: STARTING_HP,
      combo: live?.combo ?? 0,
      ultimateCharge: live?.ultimateCharge ?? 0,
      tier: room.match.history.at(-1)?.result.nextTier ?? 1,
      isBot: false,
    };
  };

  const reviewOf = (room: Room): ReviewItem[] =>
    room.match.history.map((round) => {
      const item: ReviewItem = {
        questionId: round.question.id,
        type: round.question.type,
        concept: round.question.concept,
        prompt: round.question.prompt,
        correctAnswer: correctAnswerFor(round.question.id) ?? '',
        explanation: round.question.explanation,
        answers: {},
      };
      if (round.question.code) item.code = round.question.code;
      if (round.question.options) item.options = round.question.options;
      for (const answer of round.answers) {
        item.answers[answer.playerId] = {
          submitted: answer.submitted,
          correct: answer.status === 'correct',
        };
      }
      return item;
    });

  const playersOf = (room: Room): Record<string, PlayerState> => {
    const players: Record<string, PlayerState> = {};
    for (const id of room.profiles.keys()) players[id] = playerState(room, id);
    return players;
  };

  const clearTimers = (room: Room) => {
    for (const cancel of room.timers) cancel();
    room.timers = [];
  };

  const arm = (room: Room, fn: () => void, ms: number) => {
    let cancel = () => {};
    cancel = schedule(() => {
      room.timers = room.timers.filter((item) => item !== cancel);
      if (room.ended) return;
      fn();
    }, ms);
    room.timers.push(cancel);
  };

  const endMatch = (room: Room, payload: MatchEndPayload) => {
    if (room.ended) return;
    room.ended = true;
    clearTimers(room);
    io.to(room.matchId).emit(SERVER_EVENTS.MATCH_END, payload);
  };

  const publish = (room: Room, result: ResolveRoundResult) => {
    const round = room.match.history[room.match.history.length - 1];
    if (!round) return;
    if (result.ultimateFired && result.hitterId) {
      io.to(room.matchId).emit(SERVER_EVENTS.ULTIMATE_READY, {
        matchId: room.matchId,
        playerId: result.hitterId,
      });
    }
    const outcomes: Record<string, PlayerRoundOutcome> = {};
    for (const answer of round.answers) {
      outcomes[answer.playerId] = {
        answered: answer.status !== 'timeout',
        correct: answer.status === 'correct',
        ...(answer.answerMs === null ? {} : { answerMs: answer.answerMs }),
      };
    }
    const damage: DamageEvent[] = result.damage.map((hit) => ({
      to: hit.to,
      amount: hit.amount,
      attackSize: hit.attackSize,
      attacker: hit.attacker,
    }));
    io.to(room.matchId).emit(SERVER_EVENTS.ROUND_RESULT, {
      matchId: room.matchId,
      round: round.roundNumber,
      questionId: round.question.id,
      outcomes,
      damage,
      players: playersOf(room),
      nextTier: result.nextTier,
    });
    if (result.matchEnd) {
      const payload: MatchEndPayload = {
        matchId: room.matchId,
        winnerId: result.matchEnd.winnerId,
        players: playersOf(room),
        review: reviewOf(room),
        reason: result.matchEnd.reason,
      };
      arm(room, () => endMatch(room, payload), pacing.matchEndMs);
      return;
    }
    const gap = result.ultimateFired ? pacing.roundGapUltimateMs : pacing.roundGapMs;
    startRound(room, gap);
  };

  const openLiveRound = (room: Room) => {
    if (room.ended) return;
    const open = room.match.beginLiveRound();
    if (!open) return;
    room.round = open.roundNumber;
    room.questionId = open.questionId;
    const now = clock.now();
    io.to(room.matchId).emit(SERVER_EVENTS.ROUND_START, {
      matchId: room.matchId,
      round: open.roundNumber,
      tier: open.tier,
      question: open.shown,
      deadline: open.startedAtMs + open.durationMs,
      serverNow: now,
    });
    arm(room, () => {
      const result = room.match.closeLiveRound();
      if (result) publish(room, result);
    }, open.durationMs);
  };

  const startRound = (room: Room, delayMs: number) => {
    if (room.ended) return;
    arm(room, () => openLiveRound(room), delayMs);
  };

  const openRoom = (first: Waiting, second: Waiting) => {
    const matchId = `m${matchSeq++}`;
    const players = [first, second].map((item): MatchPlayer => ({
      id: item.socket.id,
      respond: () => ({ answer: null, answerMs: null }),
    })) as [MatchPlayer, MatchPlayer];
    const room: Room = {
      matchId,
      match: new Match({
        players,
        clock,
        rng: options.rng,
        preferredType: options.preferredType,
        chooseQuestion: options.chooseQuestion,
      }),
      sockets: new Map([
        [first.socket.id, first.socket],
        [second.socket.id, second.socket],
      ]),
      profiles: new Map(
        [first, second].map((item) => [
          item.socket.id,
          {
            name: sanitizeDisplayName(item.payload.name),
            characterId: item.payload.characterId,
            linkedinUrl: sanitizeLinkedinUrl(item.payload.linkedinUrl),
          },
        ]),
      ),
      connectRequests: new Set(),
      timers: [],
      ended: false,
      round: 0,
      questionId: '',
    };
    rooms.set(first.socket.id, room);
    rooms.set(second.socket.id, room);
    first.socket.join(matchId);
    second.socket.join(matchId);
    first.socket.emit(SERVER_EVENTS.MATCH_FOUND, {
      matchId,
      you: playerState(room, first.socket.id),
      opponent: playerState(room, second.socket.id),
    });
    second.socket.emit(SERVER_EVENTS.MATCH_FOUND, {
      matchId,
      you: playerState(room, second.socket.id),
      opponent: playerState(room, first.socket.id),
    });
    startRound(room, pacing.matchStartMs);
  };

  const onSubmit = (socket: Sock, payload: AnswerSubmitPayload) => {
    const room = rooms.get(socket.id);
    if (!room || room.ended) return;
    if (!payload || typeof payload !== 'object') return;
    if (payload.matchId !== room.matchId || payload.round !== room.round) return;
    if (payload.questionId !== room.questionId) return;
    if (typeof payload.answer !== 'string' || payload.answer.length > MAX_SUBMIT_CHARS) return;
    const action = room.match.submitLive(socket.id, payload.answer, clock.now());
    if (action.kind === 'hint') {
      socket.emit(SERVER_EVENTS.ANSWER_HINT, {
        matchId: room.matchId,
        round: room.round,
        suggestion: action.suggestion,
      });
      return;
    }
    if (action.kind === 'finished') {
      clearTimers(room);
      publish(room, action.result);
    }
  };

  const sendConnect = (
    socket: Sock,
    room: Room,
    status: ConnectUpdatePayload['status'],
    opponentLinkedinUrl?: string | null,
  ) => {
    socket.emit(SERVER_EVENTS.CONNECT_UPDATE, {
      matchId: room.matchId,
      status,
      ...(opponentLinkedinUrl === undefined ? {} : { opponentLinkedinUrl }),
    });
  };

  const onConnectRequest = (socket: Sock, payload: ConnectRequestPayload) => {
    const room = rooms.get(socket.id);
    if (!room || !room.ended) return;
    if (!payload || typeof payload !== 'object' || payload.matchId !== room.matchId) return;
    const otherId = [...room.profiles.keys()].find((id) => id !== socket.id);
    if (!otherId || payload.targetPlayerId !== otherId) return;
    const other = room.sockets.get(otherId);
    if (!other?.connected || !rooms.has(otherId)) {
      sendConnect(socket, room, 'unavailable');
      return;
    }
    room.connectRequests.add(socket.id);
    if (room.connectRequests.size < 2) {
      sendConnect(socket, room, 'waiting');
      sendConnect(other, room, 'requested');
      return;
    }
    sendConnect(socket, room, 'connected', room.profiles.get(otherId)?.linkedinUrl ?? null);
    sendConnect(other, room, 'connected', room.profiles.get(socket.id)?.linkedinUrl ?? null);
  };

  io.on('connection', (socket) => {
    socket.on(
      CLIENT_EVENTS.QUEUE_JOIN,
      safe((payload: QueueJoinPayload) => {
        if (!payload || typeof payload.name !== 'string' || typeof payload.characterId !== 'string') return;
        if (isBusy(socket.id)) return;
        waiting.push({ socket, payload });
        if (waiting.length < 2) return;
        const first = waiting.shift();
        const second = waiting.shift();
        if (first && second) openRoom(first, second);
      }),
    );

    socket.on(
      CLIENT_EVENTS.ANSWER_SUBMIT,
      safe((payload: AnswerSubmitPayload) => onSubmit(socket, payload)),
    );

    socket.on(
      CLIENT_EVENTS.CONNECT_REQUEST,
      safe((payload: ConnectRequestPayload) => onConnectRequest(socket, payload)),
    );

    socket.on(
      CLIENT_EVENTS.LOBBY_CREATE,
      safe((payload?: LobbyCreatePayload) => {
        if (isBusy(socket.id)) {
          socket.emit(SERVER_EVENTS.LOBBY_ERROR, { reason: 'busy' });
          return;
        }
        const code = makeLobbyCode(new Set(lobbies.keys()));
        const cancel = schedule(() => {
          const lobby = lobbies.get(code);
          if (!lobby) return;
          const host = lobby.host;
          removeLobby(code);
          host.emit(SERVER_EVENTS.LOBBY_CLOSED, { reason: 'expired' });
        }, pacing.lobbyTtlMs);
        lobbies.set(code, {
          host: socket,
          displayName: sanitizeDisplayName(payload?.displayName),
          linkedinUrl: payload?.linkedinUrl,
          createdAt: clock.now(),
          cancel,
        });
        lobbyBySocket.set(socket.id, code);
        socket.emit(SERVER_EVENTS.LOBBY_CREATED, { code });
      }),
    );

    socket.on(
      CLIENT_EVENTS.LOBBY_JOIN,
      safe((payload?: LobbyJoinPayload) => {
        const now = clock.now();
        const stamps = recentFailures(joinFailures.get(socket.id) ?? [], now);
        joinFailures.set(socket.id, stamps);
        if (joinRateLimited(stamps, now)) {
          socket.emit(SERVER_EVENTS.LOBBY_ERROR, { reason: 'rate_limited' });
          return;
        }
        const code = normalizeLobbyCode(payload?.code);
        const lobby = lobbies.get(code);
        if (lobby && lobby.host.id === socket.id) {
          failJoin(socket, 'own_lobby');
          return;
        }
        if (isBusy(socket.id)) {
          failJoin(socket, 'busy');
          return;
        }
        if (!lobby) {
          failJoin(socket, 'not_found');
          return;
        }
        if (now >= lobby.createdAt + pacing.lobbyTtlMs) {
          const host = lobby.host;
          removeLobby(code);
          host.emit(SERVER_EVENTS.LOBBY_CLOSED, { reason: 'expired' });
          failJoin(socket, 'expired');
          return;
        }
        if (!lobby.host.connected) {
          removeLobby(code);
          failJoin(socket, 'not_found');
          return;
        }
        const host = lobby.host;
        const hostName = lobby.displayName;
        const hostLinkedin = lobby.linkedinUrl;
        removeLobby(code);
        openRoom(
          { socket: host, payload: { name: hostName, characterId: 'player', linkedinUrl: hostLinkedin } },
          {
            socket,
            payload: {
              name: sanitizeDisplayName(payload?.displayName),
              characterId: 'player',
              linkedinUrl: payload?.linkedinUrl,
            },
          },
        );
      }),
    );

    socket.on(
      CLIENT_EVENTS.LOBBY_LEAVE,
      safe(() => {
        const code = lobbyBySocket.get(socket.id);
        if (!code) return;
        const lobby = lobbies.get(code);
        removeLobby(code);
        lobby?.host.emit(SERVER_EVENTS.LOBBY_CLOSED, { reason: 'host_left' });
      }),
    );

    socket.on(
      'disconnect',
      safe(() => {
        dropWaiting(socket.id);
        joinFailures.delete(socket.id);
        const code = lobbyBySocket.get(socket.id);
        if (code) removeLobby(code);
        const room = rooms.get(socket.id);
        if (!room || room.ended) {
          rooms.delete(socket.id);
          if (room && room.connectRequests.size < 2) {
            for (const [id, other] of room.sockets) {
              if (id !== socket.id && rooms.has(id) && other.connected) sendConnect(other, room, 'unavailable');
            }
          }
          return;
        }
        const otherId = [...room.profiles.keys()].find((id) => id !== socket.id) ?? null;
        endMatch(room, {
          matchId: room.matchId,
          winnerId: otherId,
          players: playersOf(room),
          review: reviewOf(room),
          reason: 'forfeit',
        });
        for (const id of room.profiles.keys()) rooms.delete(id);
      }),
    );
  });
}

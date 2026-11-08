// OWNER A: human vs human matches over Socket.IO.
// The pure engine is resolveRound. This file only times rounds and maps events.
import type { Server, Socket } from 'socket.io';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  STARTING_HP,
  type AnswerSubmitPayload,
  type ClientToServerEvents,
  type DamageEvent,
  type MatchEndPayload,
  type PlayerRoundOutcome,
  type PlayerState,
  type QueueJoinPayload,
  type QuestionType,
  type Question,
  type ReviewItem,
  type ServerToClientEvents,
} from '@beatcode/shared';
import type { Clock } from './match';
import { Match, type MatchPlayer } from './match';
import { correctAnswerFor } from './matchQuestions';
import type { ResolveRoundResult } from './engine/resolveRound';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface GameServerOptions {
  clock?: Clock;
  /** Returns a cancel function. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void;
  rng?: () => number;
  preferredType?: QuestionType;
  chooseQuestion?: (tier: number, usedIds: readonly string[], rng: () => number) => Question;
}

interface Waiting {
  socket: Sock;
  payload: QueueJoinPayload;
}

interface Room {
  matchId: string;
  match: Match;
  sockets: Map<string, Sock>;
  profiles: Map<string, { name: string; characterId: string }>;
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
  const waiting: Waiting[] = [];
  const rooms = new Map<string, Room>();
  let matchSeq = 1;

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
      endMatch(room, {
        matchId: room.matchId,
        winnerId: result.matchEnd.winnerId,
        players: playersOf(room),
        review: reviewOf(room),
        reason: result.matchEnd.reason,
      });
      return;
    }
    startRound(room);
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

  const startRound = (room: Room) => {
    if (room.ended) return;
    arm(room, () => openLiveRound(room), 0);
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
      profiles: new Map([
        [first.socket.id, { name: first.payload.name, characterId: first.payload.characterId }],
        [second.socket.id, { name: second.payload.name, characterId: second.payload.characterId }],
      ]),
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
    startRound(room);
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

  io.on('connection', (socket) => {
    socket.on(
      CLIENT_EVENTS.QUEUE_JOIN,
      safe((payload: QueueJoinPayload) => {
        if (!payload || typeof payload.name !== 'string' || typeof payload.characterId !== 'string') return;
        if (rooms.has(socket.id) || waiting.some((item) => item.socket.id === socket.id)) return;
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

    socket.on(CLIENT_EVENTS.CONNECT_REQUEST, safe(() => {}));

    socket.on(
      'disconnect',
      safe(() => {
        dropWaiting(socket.id);
        const room = rooms.get(socket.id);
        if (!room || room.ended) {
          rooms.delete(socket.id);
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

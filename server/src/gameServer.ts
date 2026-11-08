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
  cancel: (() => void) | null;
  ended: boolean;
  round: number;
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

  const endMatch = (room: Room, payload: MatchEndPayload) => {
    if (room.ended) return;
    room.ended = true;
    room.cancel?.();
    room.cancel = null;
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

  const startRound = (room: Room) => {
    if (room.ended) return;
    const open = room.match.beginLiveRound();
    if (!open) return;
    room.round = open.roundNumber;
    const now = clock.now();
    io.to(room.matchId).emit(SERVER_EVENTS.ROUND_START, {
      matchId: room.matchId,
      round: open.roundNumber,
      tier: open.tier,
      question: open.shown,
      deadline: open.startedAtMs + open.durationMs,
      serverNow: now,
    });
    room.cancel?.();
    room.cancel = schedule(() => {
      room.cancel = null;
      if (room.ended) return;
      const result = room.match.closeLiveRound();
      if (result) publish(room, result);
    }, open.durationMs);
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
      cancel: null,
      ended: false,
      round: 0,
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
    if (!room || room.ended || room.matchId !== payload.matchId) return;
    if (typeof payload.answer !== 'string') return;
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
      room.cancel?.();
      room.cancel = null;
      publish(room, action.result);
    }
  };

  io.on('connection', (socket) => {
    socket.on(CLIENT_EVENTS.QUEUE_JOIN, (payload) => {
      if (rooms.has(socket.id) || waiting.some((item) => item.socket.id === socket.id)) return;
      waiting.push({ socket, payload });
      if (waiting.length < 2) return;
      const first = waiting.shift();
      const second = waiting.shift();
      if (first && second) openRoom(first, second);
    });

    socket.on(CLIENT_EVENTS.ANSWER_SUBMIT, (payload) => onSubmit(socket, payload));

    socket.on(CLIENT_EVENTS.CONNECT_REQUEST, () => {});

    socket.on('disconnect', () => {
      dropWaiting(socket.id);
      const room = rooms.get(socket.id);
      if (!room || room.ended) {
        rooms.delete(socket.id);
        return;
      }
      // TODO(OWNER A): Step 7 forfeit handling is not designed yet.
      // The match stops so the remaining player is not left in a live round.
      // No new end reason: this reuses hp_zero until Step 7 decides what a dropout means.
      room.cancel?.();
      room.cancel = null;
      const otherId = [...room.profiles.keys()].find((id) => id !== socket.id);
      endMatch(room, {
        matchId: room.matchId,
        winnerId: otherId ?? null,
        players: playersOf(room),
        review: reviewOf(room),
        reason: 'hp_zero',
      });
      for (const id of room.profiles.keys()) rooms.delete(id);
    });
  });
}

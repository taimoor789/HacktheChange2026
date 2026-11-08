// SHARED CONTRACT. Owned by everyone: do not change without all three owners agreeing.
// Socket events: A emits/handles on the server, B consumes on the client.
import type {
  AttackSize,
  PlayerId,
  PlayerState,
  PublicQuestion,
  QuestionType,
} from './types';

export const CLIENT_EVENTS = {
  QUEUE_JOIN: 'queue:join',
  ANSWER_SUBMIT: 'answer:submit',
  CONNECT_REQUEST: 'connect:request',
} as const;

export const SERVER_EVENTS = {
  MATCH_FOUND: 'match:found',
  ROUND_START: 'round:start',
  ROUND_RESULT: 'round:result',
  ULTIMATE_READY: 'ultimate:ready',
  MATCH_END: 'match:end',
} as const;

// ---------- client -> server payloads ----------

export interface QueueJoinPayload {
  name: string;
  characterId: string;
  linkedinUrl?: string;
  /** True = skip the queue and match against the bot immediately (judge demo). */
  vsBot?: boolean;
}

export interface AnswerSubmitPayload {
  matchId: string;
  round: number;
  questionId: string;
  answer: string;
}

export interface ConnectRequestPayload {
  matchId: string;
  /** The opponent the player wants to connect with. */
  targetPlayerId: PlayerId;
}

// ---------- server -> client payloads ----------

export interface MatchFoundPayload {
  matchId: string;
  you: PlayerState;
  opponent: PlayerState;
}

export interface RoundStartPayload {
  matchId: string;
  round: number;
  tier: number;
  question: PublicQuestion;
  /** Unix ms when the round ends (server clock). */
  deadline: number;
  /** Server clock at send time, so the client can correct for clock skew. */
  serverNow: number;
}

export interface PlayerRoundOutcome {
  answered: boolean;
  correct: boolean;
  /** ms from round start; undefined if no answer. */
  answerMs?: number;
}

export interface RoundResultPayload {
  matchId: string;
  round: number;
  questionId: string;
  outcomes: Record<PlayerId, PlayerRoundOutcome>;
  /** Who got hit (null = nobody took damage). */
  damage: { to: PlayerId | null; amount: number; attackSize: AttackSize; attacker: PlayerId | null };
  /** Authoritative state after the round: new HP, combo, ultimate charge for both. */
  players: Record<PlayerId, PlayerState>;
  /** Tier of the next round. */
  nextTier: number;
}

export interface UltimateReadyPayload {
  matchId: string;
  playerId: PlayerId;
}

export interface ReviewItem {
  questionId: string;
  type: QuestionType;
  concept: string;
  prompt: string;
  code?: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  answers: Record<PlayerId, { submitted: string | null; correct: boolean }>;
}

export interface MatchEndPayload {
  matchId: string;
  winnerId: PlayerId | null;
  players: Record<PlayerId, PlayerState>;
  review: ReviewItem[];
}

// ---------- typed Socket.IO maps ----------

export interface ClientToServerEvents {
  [CLIENT_EVENTS.QUEUE_JOIN]: (p: QueueJoinPayload) => void;
  [CLIENT_EVENTS.ANSWER_SUBMIT]: (p: AnswerSubmitPayload) => void;
  [CLIENT_EVENTS.CONNECT_REQUEST]: (p: ConnectRequestPayload) => void;
}

export interface ServerToClientEvents {
  [SERVER_EVENTS.MATCH_FOUND]: (p: MatchFoundPayload) => void;
  [SERVER_EVENTS.ROUND_START]: (p: RoundStartPayload) => void;
  [SERVER_EVENTS.ROUND_RESULT]: (p: RoundResultPayload) => void;
  [SERVER_EVENTS.ULTIMATE_READY]: (p: UltimateReadyPayload) => void;
  [SERVER_EVENTS.MATCH_END]: (p: MatchEndPayload) => void;
}

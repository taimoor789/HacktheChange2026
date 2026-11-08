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
  LOBBY_CREATE: 'lobby:create',
  LOBBY_JOIN: 'lobby:join',
  LOBBY_LEAVE: 'lobby:leave',
} as const;

export const SERVER_EVENTS = {
  MATCH_FOUND: 'match:found',
  ROUND_START: 'round:start',
  ROUND_RESULT: 'round:result',
  ANSWER_HINT: 'answer:hint',
  ULTIMATE_READY: 'ultimate:ready',
  MATCH_END: 'match:end',
  CONNECT_UPDATE: 'connect:update',
  LOBBY_CREATED: 'lobby:created',
  LOBBY_CLOSED: 'lobby:closed',
  LOBBY_ERROR: 'lobby:error',
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

export interface LobbyCreatePayload {
  displayName?: string;
  /** The host's fighter, as in queue:join. Missing or invalid is 'player'. */
  characterId?: string;
  linkedinUrl?: string;
}

export interface LobbyJoinPayload {
  code: string;
  displayName?: string;
  /** The joining player's fighter, as in queue:join. Missing or invalid is 'player'. */
  characterId?: string;
  linkedinUrl?: string;
}

export type LobbyClosedReason = 'expired' | 'host_left';

export interface LobbyCreatedPayload {
  code: string;
}

export interface LobbyClosedPayload {
  reason: LobbyClosedReason;
}

export type LobbyErrorReason = 'not_found' | 'full' | 'expired' | 'busy' | 'rate_limited' | 'own_lobby';

export interface LobbyErrorPayload {
  reason: LobbyErrorReason;
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

export interface DamageEvent {
  to: PlayerId;
  amount: number;
  attackSize: AttackSize;
  /** Null when the hit is mutual miss damage. */
  attacker: PlayerId | null;
}

export interface RoundResultPayload {
  matchId: string;
  round: number;
  questionId: string;
  outcomes: Record<PlayerId, PlayerRoundOutcome>;
  /** One element per player who lost HP. Empty on a tie or a safety-cap double miss. */
  damage: DamageEvent[];
  /** Authoritative state after the round: new HP, combo, ultimate charge for both. */
  players: Record<PlayerId, PlayerState>;
  /** Tier of the next round. */
  nextTier: number;
}

export interface AnswerHintPayload {
  matchId: string;
  round: number;
  suggestion: string;
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

export type MatchEndReason = 'hp_zero' | 'tiers_complete' | 'max_rounds' | 'forfeit';

export interface MatchEndPayload {
  matchId: string;
  winnerId: PlayerId | null;
  players: Record<PlayerId, PlayerState>;
  review: ReviewItem[];
  reason: MatchEndReason;
}

/**
 * waiting: you clicked, your opponent has not. requested: your opponent clicked, you have not.
 * connected: both clicked, links exchanged. unavailable: your opponent left first.
 */
export type ConnectStatus = 'waiting' | 'requested' | 'connected' | 'unavailable';

export interface ConnectUpdatePayload {
  matchId: string;
  status: ConnectStatus;
  /** Only on 'connected'. Null if the opponent added no link. */
  opponentLinkedinUrl?: string | null;
}

// ---------- typed Socket.IO maps ----------

export interface ClientToServerEvents {
  [CLIENT_EVENTS.QUEUE_JOIN]: (p: QueueJoinPayload) => void;
  [CLIENT_EVENTS.ANSWER_SUBMIT]: (p: AnswerSubmitPayload) => void;
  [CLIENT_EVENTS.CONNECT_REQUEST]: (p: ConnectRequestPayload) => void;
  [CLIENT_EVENTS.LOBBY_CREATE]: (p: LobbyCreatePayload) => void;
  [CLIENT_EVENTS.LOBBY_JOIN]: (p: LobbyJoinPayload) => void;
  [CLIENT_EVENTS.LOBBY_LEAVE]: () => void;
}

export interface ServerToClientEvents {
  [SERVER_EVENTS.MATCH_FOUND]: (p: MatchFoundPayload) => void;
  [SERVER_EVENTS.ROUND_START]: (p: RoundStartPayload) => void;
  [SERVER_EVENTS.ROUND_RESULT]: (p: RoundResultPayload) => void;
  [SERVER_EVENTS.ANSWER_HINT]: (p: AnswerHintPayload) => void;
  [SERVER_EVENTS.ULTIMATE_READY]: (p: UltimateReadyPayload) => void;
  [SERVER_EVENTS.MATCH_END]: (p: MatchEndPayload) => void;
  [SERVER_EVENTS.CONNECT_UPDATE]: (p: ConnectUpdatePayload) => void;
  [SERVER_EVENTS.LOBBY_CREATED]: (p: LobbyCreatedPayload) => void;
  [SERVER_EVENTS.LOBBY_CLOSED]: (p: LobbyClosedPayload) => void;
  [SERVER_EVENTS.LOBBY_ERROR]: (p: LobbyErrorPayload) => void;
}

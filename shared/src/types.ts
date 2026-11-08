// SHARED CONTRACT. Owned by everyone: do not change without all three owners agreeing.

// ---------- Questions (schema owned by C, read by A and B) ----------

export type QuestionType =
  | 'fill_blank'
  | 'name_concept'
  | 'output_prediction'
  | 'spot_the_bug'
  /** Heavy, multi-line: the player rewrites buggy code. Race: the round ends on the first correct answer. */
  | 'rewrite_code';

export interface Question {
  id: string;
  type: QuestionType;
  /** Tier number, starting at 1. */
  difficulty: number;
  /** e.g. "loops", "recursion". Must exist in the ladder for this tier. */
  concept: string;
  prompt: string;
  /** Code snippet the player sees (output_prediction, spot_the_bug, fill_blank). */
  code?: string;
  /** Multiple-choice options. If present, answers may be the option text or its 0-based index. */
  options?: string[];
  /**
   * Optional minimum time in seconds for this question. The round timer is
   * max(tier timer, seconds), so long/hard questions keep a longer limit even at high tiers.
   */
  seconds?: number;
  /** NEVER sent to the client during a round. For rewrite_code: each entry is a full accepted solution. */
  acceptedAnswers: string[];
  /** Shown in post-match review only. */
  explanation: string;
}

/** What the server sends during a round: no answers, no explanation. */
export type PublicQuestion = Omit<Question, 'acceptedAnswers' | 'explanation'>;

// ---------- Game state (A changes it, B only renders it) ----------

export type PlayerId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  characterId: string;
  hp: number;
  maxHp: number;
  /** Consecutive correct answers. */
  combo: number;
  /** 0..ULTIMATE_CHARGE_NEEDED */
  ultimateCharge: number;
  /** Current tier (shared ladder: both players share the match tier). */
  tier: number;
  isBot: boolean;
}

export type MatchStatus = 'waiting' | 'round_active' | 'round_resolving' | 'finished';

export interface MatchState {
  matchId: string;
  round: number;
  tier: number;
  status: MatchStatus;
  players: Record<PlayerId, PlayerState>;
}

export type AttackSize = 'light' | 'medium' | 'heavy' | 'ultimate';

// ---------- Profiles (basic) ----------

export interface Profile {
  id: string;
  displayName: string;
  avatar?: string;
  favoriteCharacter?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  bio?: string;
  stats: { wins: number; losses: number; winStreak: number; highestTier: number };
  strongestConcepts: string[];
  weakestConcepts: string[];
}

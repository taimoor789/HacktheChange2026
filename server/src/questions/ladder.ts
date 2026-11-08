// OWNER C: concept ladder + timer table access.
// Responsible for: ordered concepts by tier (simple -> advanced) and the timer per tier.
// Others expect: A calls getTimerSeconds(tier) to set round deadlines; MAX_TIER comes from shared.
import {
  MAX_TIER,
  QUESTIONS_PER_TIER,
  TIMER_SECONDS_BY_TIER,
  type Question,
} from '@beatcode/shared';

export { MAX_TIER };

// TODO(OWNER C): refine concepts per tier as the bank grows.
export const LADDER: Record<number, string[]> = {
  1: ['variables', 'syntax', 'sql basics'],
  2: ['conditionals', 'loops', 'sql filtering'],
  3: ['functions', 'scope', 'sql aggregates'],
  4: ['arrays', 'strings', 'sql joins'],
  5: ['hash maps', 'recursion', 'algorithms', 'sql advanced'],
  6: ['time complexity', 'trees', 'algorithms', 'sql design'],
};

export function conceptsForTier(tier: number): string[] {
  return LADDER[clampTier(tier)] ?? [];
}

export function clampTier(tier: number): number {
  return Math.min(MAX_TIER, Math.max(1, Math.round(tier)));
}

/** Seconds a player gets for a question at this tier. */
export function getTimerSeconds(tier: number): number {
  // TODO(OWNER C): tune with shared TIMER_SECONDS_BY_TIER after playtesting.
  return TIMER_SECONDS_BY_TIER[clampTier(tier) - 1];
}

/**
 * Seconds for a specific question: the tier timer, but never less than the question's own `seconds`.
 * Normal questions get shorter as tiers rise; long/hard ones (e.g. rewrite_code) keep their longer limit.
 */
export function getQuestionSeconds(question: Pick<Question, 'difficulty' | 'seconds'>): number {
  return Math.max(getTimerSeconds(question.difficulty), question.seconds ?? 0);
}

export interface TierProgress {
  /** Tier of the question that was just asked. */
  tier: number;
  /** Questions finished in this tier so far, NOT counting the one being completed. Start at 0. */
  askedInTier: number;
}

/**
 * Call once each time a question has been asked and resolved. Moves up a tier after
 * QUESTIONS_PER_TIER questions in the current tier, all the way to MAX_TIER.
 * `finished` is true when the last question of the last tier was just completed (the ladder is done);
 * what happens then (match over, or sudden death at the top tier) is the server's decision.
 */
export function completeQuestion(p: TierProgress): TierProgress & { finished: boolean } {
  const asked = p.askedInTier + 1;
  if (asked < QUESTIONS_PER_TIER) return { tier: p.tier, askedInTier: asked, finished: false };
  if (p.tier >= MAX_TIER) return { tier: MAX_TIER, askedInTier: asked, finished: true };
  return { tier: p.tier + 1, askedInTier: 0, finished: false };
}

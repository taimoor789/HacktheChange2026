// OWNER C: concept ladder + timer table access.
// Responsible for: ordered concepts by tier (simple -> advanced) and the timer per tier.
// Others expect: A calls getTimerSeconds(tier) to set round deadlines; MAX_TIER comes from shared.
import { MAX_TIER, TIMER_SECONDS_BY_TIER } from '@beatcode/shared';

export { MAX_TIER };

// TODO(OWNER C): refine concepts per tier as the bank grows.
export const LADDER: Record<number, string[]> = {
  1: ['variables', 'syntax'],
  2: ['conditionals', 'loops'],
  3: ['functions', 'scope'],
  4: ['arrays', 'strings'],
  5: ['hash maps', 'recursion'],
  6: ['time complexity', 'trees'],
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

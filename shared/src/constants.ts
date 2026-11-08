// SHARED CONTRACT. Owned by everyone: do not change without all three owners agreeing.
// Every number below is a TUNABLE PLACEHOLDER. Change after playtesting (with everyone's OK).
import type { QuestionType } from './types';

export const STARTING_HP = 100;

/** Highest tier in the concept ladder. */
export const MAX_TIER = 6;

/** Base damage by tier, index 0 = tier 1. TUNABLE. */
export const DAMAGE_BY_TIER = [8, 10, 12, 15, 18, 22] as const;

/** Combo multiplier by consecutive correct answers (index = combo count, clamped to last). TUNABLE. */
export const COMBO_MULTIPLIERS = [1, 1, 1.25, 1.5, 1.75, 2] as const;

/** Ultimate charge needed to fire the ultimate. TUNABLE. */
export const ULTIMATE_CHARGE_NEEDED = 100;

/** Charge gained per correct answer by tier, index 0 = tier 1 (heavier = faster). TUNABLE. */
export const ULTIMATE_CHARGE_BY_TIER = [10, 12, 15, 18, 22, 25] as const;

/** Ultimate deals this multiple of normal damage. TUNABLE. */
export const ULTIMATE_DAMAGE_MULTIPLIER = 2.5;

/** Below this fraction of max HP, the comeback boost applies. TUNABLE. */
export const COMEBACK_HP_THRESHOLD = 0.25;
/** Comeback: extra ultimate charge multiplier and damage buff. TUNABLE. */
export const COMEBACK_CHARGE_MULTIPLIER = 1.5;
export const COMEBACK_DAMAGE_MULTIPLIER = 1.2;

/** Seconds per question by tier, index 0 = tier 1. Shrinks as tiers rise. TUNABLE. */
export const TIMER_SECONDS_BY_TIER = [25, 22, 20, 18, 15, 12] as const;

/** Lockout after a wrong answer in race mode. TUNABLE. */
export const WRONG_ANSWER_LOCKOUT_MS = 2000;

/** Quick types use race mode (first correct wins). Others use scored mode. */
export const RACE_MODE_TYPES: readonly QuestionType[] = [
  'fill_blank',
  'name_concept',
  'output_prediction',
];

/** Default: advance one tier every N rounds where at least one player answered correctly. TUNABLE. */
export const ROUNDS_PER_TIER = 2;

/** Match ends after this many rounds if nobody has reached 0 HP. */
export const MAX_ROUNDS = 12;

/**
 * Max extra fraction of tier base damage for an instant answer. Linear down to 0 at the deadline.
 * An instant tier-1 hit is 8 * 1.5 = 12; an answer at the deadline is just the base.
 */
export const SPEED_BONUS_MAX = 0.5;

/**
 * Flat chip when neither player is correct. 4 is half of the smallest hit (tier 1 base 8)
 * and 4% of starting HP (100), so misses sting without competing with a real hit.
 */
export const MISS_DAMAGE = 4;

/** Consecutive correct answers (combo) required to fire an ultimate on a round that player wins. */
export const ULT_STREAK = 3;

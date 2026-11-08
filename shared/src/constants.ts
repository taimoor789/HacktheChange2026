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

/**
 * Questions asked in each tier before moving up. A full climb is QUESTIONS_PER_TIER * MAX_TIER questions
 * (tier 1, 2 questions, tier 2, 2 questions ... tier 6). Counted per tier, not by round number. TUNABLE.
 */
export const QUESTIONS_PER_TIER = 2;

// OWNER A: pure battle-rule functions. No sockets, no timers, no I/O.
// Numbers come from @beatcode/shared. Deferred and intentionally unused here:
// COMBO_MULTIPLIERS, ULTIMATE_CHARGE_BY_TIER, COMEBACK_*, WRONG_ANSWER_LOCKOUT_MS.
import type { AttackSize } from '@beatcode/shared';
import {
  DAMAGE_BY_TIER,
  MISS_DAMAGE,
  SPEED_BONUS_MAX,
  ULT_STREAK,
  ULTIMATE_CHARGE_NEEDED,
  ULTIMATE_DAMAGE_MULTIPLIER,
} from '@beatcode/shared';

/** How much of the speed-bonus range an answer earned. 0 at the deadline, 1 at round start. */
const LIGHT_BELOW = 0.15;
const HEAVY_AT = 0.35;

export type StreakOutcome = 'correct' | 'wrong' | 'timeout' | 'closed_early';

export interface HpChange {
  hp: number;
  /** HP actually removed. Less than the requested amount when a floor applies. */
  lost: number;
}

/**
 * Fraction of the speed bonus still available. 1 at round start, 0 at the deadline.
 * This is the value to pass to attackSizeFor.
 */
export function speedBonusRatio(timeLeftMs: number, roundDurationMs: number): number {
  if (roundDurationMs <= 0) return 0;
  const ratio = timeLeftMs / roundDurationMs;
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}

/** Tier base damage plus a linear speed bonus. SPEED_BONUS_MAX at the start, 0 at the deadline. */
export function calculateHitDamage(tier: number, timeLeftMs: number, roundDurationMs: number): number {
  const base = DAMAGE_BY_TIER[tier - 1];
  if (base === undefined) {
    throw new RangeError(`tier ${tier} is outside 1..${DAMAGE_BY_TIER.length}`);
  }
  const bonus = SPEED_BONUS_MAX * speedBonusRatio(timeLeftMs, roundDurationMs);
  return Math.round(base * (1 + bonus));
}

/** light below 15% of the speed-bonus range, medium below 35%, heavy at or above 35%. */
export function attackSizeFor(speedBonusRatio: number): AttackSize {
  if (speedBonusRatio < LIGHT_BELOW) return 'light';
  if (speedBonusRatio < HEAVY_AT) return 'medium';
  return 'heavy';
}

/** Apply a real hit. HP never goes below 0. */
export function applyDamage(hp: number, amount: number): HpChange {
  const lost = Math.max(0, Math.min(hp, amount));
  return { hp: hp - lost, lost };
}

/** Flat miss chip. HP never falls below 1, so a miss cannot end the match. */
export function applyMissDamage(hp: number): HpChange {
  if (hp <= 1) return { hp, lost: 0 };
  const lost = Math.min(MISS_DAMAGE, hp - 1);
  return { hp: hp - lost, lost };
}

/** Correct increments. Wrong and timeout reset. A race that closed early freezes the streak. */
export function updateStreak(combo: number, outcome: StreakOutcome): number {
  switch (outcome) {
    case 'correct':
      return combo + 1;
    case 'wrong':
    case 'timeout':
      return 0;
    case 'closed_early':
      return combo;
  }
}

/** Ultimate bar, 0..ULTIMATE_CHARGE_NEEDED, filled from the streak. */
export function chargeFromStreak(combo: number): number {
  const raw = Math.round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED);
  return Math.min(ULTIMATE_CHARGE_NEEDED, Math.max(0, raw));
}

/** Fires only when the streak is long enough and this player won the round. */
export function shouldFireUltimate(combo: number, wonRound: boolean): boolean {
  return wonRound && combo >= ULT_STREAK;
}

/** Hit damage times ULTIMATE_DAMAGE_MULTIPLIER, rounded to the nearest integer. */
export function ultimateDamage(hitDamage: number): number {
  return Math.round(hitDamage * ULTIMATE_DAMAGE_MULTIPLIER);
}

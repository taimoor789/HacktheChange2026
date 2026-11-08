import { describe, expect, it } from 'vitest';
import {
  DAMAGE_BY_TIER,
  MISS_DAMAGE,
  SPEED_BONUS_MAX,
  ULT_STREAK,
  ULTIMATE_CHARGE_NEEDED,
  ULTIMATE_DAMAGE_MULTIPLIER,
} from '@beatcode/shared';
import {
  applyDamage,
  applyMissDamage,
  attackSizeFor,
  calculateHitDamage,
  chargeFromStreak,
  shouldFireUltimate,
  speedBonusRatio,
  ultimateDamage,
  updateStreak,
} from '../battleRules';

const ROUND_MS = 10_000;

describe('calculateHitDamage', () => {
  it('deals each tier base when the answer arrives at the deadline', () => {
    expect(DAMAGE_BY_TIER).toEqual([8, 10, 12, 15, 18, 22]);
    DAMAGE_BY_TIER.forEach((base, index) => {
      expect(calculateHitDamage(index + 1, 0, ROUND_MS)).toBe(base);
    });
  });

  it('adds the full speed bonus at the start of the round', () => {
    expect(SPEED_BONUS_MAX).toBe(0.5);
    // base * 1.5, with 22.5 rounding to 23
    expect([1, 2, 3, 4, 5, 6].map((tier) => calculateHitDamage(tier, ROUND_MS, ROUND_MS))).toEqual([
      12, 15, 18, 23, 27, 33,
    ]);
  });

  it('uses half the speed bonus at the midpoint', () => {
    // tier 1: 8 * 1.25 = 10. tier 4: 15 * 1.25 = 18.75 → 19
    expect(calculateHitDamage(1, ROUND_MS / 2, ROUND_MS)).toBe(10);
    expect(calculateHitDamage(4, ROUND_MS / 2, ROUND_MS)).toBe(19);
    expect(speedBonusRatio(ROUND_MS / 2, ROUND_MS)).toBe(0.5);
  });
});

describe('attackSizeFor', () => {
  it('switches at 15% and 35% of the speed-bonus range', () => {
    expect(attackSizeFor(0)).toBe('light');
    expect(attackSizeFor(0.149)).toBe('light');
    expect(attackSizeFor(0.15)).toBe('medium');
    expect(attackSizeFor(0.349)).toBe('medium');
    expect(attackSizeFor(0.35)).toBe('heavy');
    expect(attackSizeFor(1)).toBe('heavy');
  });
});

describe('applyDamage', () => {
  it('subtracts the hit and floors HP at 0', () => {
    expect(applyDamage(100, 8)).toEqual({ hp: 92, lost: 8 });
    expect(applyDamage(3, 8)).toEqual({ hp: 0, lost: 3 });
    expect(applyDamage(0, 8)).toEqual({ hp: 0, lost: 0 });
  });
});

describe('applyMissDamage', () => {
  it('chips both players but never drops HP below 1', () => {
    expect(MISS_DAMAGE).toBe(4);
    expect(applyMissDamage(100)).toEqual({ hp: 96, lost: 4 });
    expect(applyMissDamage(3)).toEqual({ hp: 1, lost: 2 });
    expect(applyMissDamage(1)).toEqual({ hp: 1, lost: 0 });
  });
});

describe('updateStreak', () => {
  it('increments on a correct answer', () => {
    expect(updateStreak(0, 'correct')).toBe(1);
    expect(updateStreak(2, 'correct')).toBe(3);
  });

  it('resets on a wrong answer or a timeout', () => {
    expect(updateStreak(4, 'wrong')).toBe(0);
    expect(updateStreak(4, 'timeout')).toBe(0);
  });

  it('freezes the streak when a race closes early', () => {
    expect(updateStreak(3, 'closed_early')).toBe(3);
    expect(updateStreak(0, 'closed_early')).toBe(0);
  });
});

describe('chargeFromStreak', () => {
  it('fills the bar from the streak and caps it at full', () => {
    expect(ULT_STREAK).toBe(3);
    expect(ULTIMATE_CHARGE_NEEDED).toBe(100);
    expect(chargeFromStreak(0)).toBe(0);
    expect(chargeFromStreak(1)).toBe(33);
    expect(chargeFromStreak(2)).toBe(67);
    expect(chargeFromStreak(3)).toBe(100);
    expect(chargeFromStreak(4)).toBe(100);
  });
});

describe('shouldFireUltimate', () => {
  it('fires only when combo is at least ULT_STREAK and this player won', () => {
    expect(shouldFireUltimate(2, true)).toBe(false);
    expect(shouldFireUltimate(3, false)).toBe(false);
    expect(shouldFireUltimate(3, true)).toBe(true);
  });

  it('still fires at streak 4 after the player lost the round where they reached 3', () => {
    let combo = 0;
    combo = updateStreak(combo, 'correct');
    combo = updateStreak(combo, 'correct');
    combo = updateStreak(combo, 'correct');
    expect(combo).toBe(3);
    expect(shouldFireUltimate(combo, false)).toBe(false);

    combo = updateStreak(combo, 'correct');
    expect(combo).toBe(4);
    expect(shouldFireUltimate(combo, true)).toBe(true);
  });
});

describe('ultimateDamage', () => {
  it('multiplies the hit and rounds to the nearest integer', () => {
    expect(ULTIMATE_DAMAGE_MULTIPLIER).toBe(2.5);
    expect(ultimateDamage(8)).toBe(20);
    expect(ultimateDamage(15)).toBe(38);
  });
});

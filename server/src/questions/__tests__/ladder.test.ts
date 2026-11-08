import { describe, expect, it } from 'vitest';
import { MAX_TIER, TIMER_SECONDS_BY_TIER } from '@beatcode/shared';
import { clampTier, conceptsForTier, getTimerSeconds, LADDER } from '../ladder';

describe('ladder', () => {
  it('defines concepts for every tier 1..MAX_TIER', () => {
    for (let t = 1; t <= MAX_TIER; t++) expect(conceptsForTier(t).length).toBeGreaterThan(0);
    expect(Object.keys(LADDER).length).toBe(MAX_TIER);
  });

  it('has one timer value per tier, and the timer never grows with the tier', () => {
    expect(TIMER_SECONDS_BY_TIER.length).toBe(MAX_TIER);
    for (let t = 2; t <= MAX_TIER; t++) {
      expect(getTimerSeconds(t)).toBeLessThanOrEqual(getTimerSeconds(t - 1));
    }
  });

  it('clamps tiers outside the ladder', () => {
    expect(clampTier(-3)).toBe(1);
    expect(clampTier(100)).toBe(MAX_TIER);
    expect(getTimerSeconds(100)).toBe(getTimerSeconds(MAX_TIER));
    expect(getTimerSeconds(0)).toBe(getTimerSeconds(1));
  });
});

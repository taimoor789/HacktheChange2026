import { describe, expect, it } from 'vitest';
import { MAX_TIER, ROUNDS_PER_TIER } from '@beatcode/shared';
import { getNextQuestion, toPublicQuestion } from '../selector';
import { isCorrect } from '../answerMatching';
import { getTimerSeconds } from '../ladder';
import { loadBank } from '../schema';

/** Plays a whole match the way Owner A's server will: one question per round, shared by both players. */
function playMatch(rounds: number, rng: () => number) {
  const usedIds: string[] = [];
  let tier = 1;
  const log: { id: string; tier: number; timer: number }[] = [];
  for (let round = 1; round <= rounds; round++) {
    const q = getNextQuestion({ tier, usedIds }, rng);
    const pub = toPublicQuestion(q);
    // what travels over the socket must survive JSON and carry no answers
    const wire = JSON.parse(JSON.stringify(pub));
    expect(wire).not.toHaveProperty('acceptedAnswers');
    expect(wire).not.toHaveProperty('explanation');
    // a correct answer is accepted, a junk answer is not
    expect(isCorrect(q, q.acceptedAnswers[0])).toBe(true);
    expect(isCorrect(q, '???')).toBe(false);
    usedIds.push(q.id);
    log.push({ id: q.id, tier, timer: getTimerSeconds(tier) });
    if (round % ROUNDS_PER_TIER === 0) tier = Math.min(MAX_TIER, tier + 1);
  }
  return { usedIds, log };
}

describe('simulated matches', () => {
  it('a long match climbs the ladder, shrinks the timer and never repeats a question', () => {
    const { usedIds, log } = playMatch(24, Math.random);
    expect(new Set(usedIds).size).toBe(usedIds.length);
    expect(log[0].timer).toBeGreaterThan(log[log.length - 1].timer);
    const tiers = log.map((l) => l.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers[tiers.length - 1]).toBe(MAX_TIER);
  });

  it('survives 500 random matches without throwing or repeating a question', () => {
    for (let i = 0; i < 500; i++) {
      const { usedIds } = playMatch(20, Math.random);
      expect(new Set(usedIds).size).toBe(usedIds.length);
    }
  });

  it('survives going past the size of the whole bank (repeats allowed, no crash)', () => {
    const total = loadBank().length;
    expect(() => playMatch(total + 15, Math.random)).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import { getNextQuestion, tierSearchOrder, toPublicQuestion } from '../selector';
import { loadBank } from '../schema';

const q = (id: string, difficulty: number, type: Question['type'] = 'name_concept'): Question => ({
  id,
  type,
  difficulty,
  concept: 'c',
  prompt: 'p',
  acceptedAnswers: ['a'],
  explanation: 'e',
});

describe('tierSearchOrder', () => {
  it('goes nearest first, lower before higher', () => {
    expect(tierSearchOrder(3)).toEqual([3, 2, 4, 1, 5, 6]);
    expect(tierSearchOrder(1)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tierSearchOrder(6)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it('clamps out-of-range tiers', () => {
    expect(tierSearchOrder(0)[0]).toBe(1);
    expect(tierSearchOrder(99)[0]).toBe(6);
  });
});

describe('getNextQuestion', () => {
  it('returns a question from the requested tier', () => {
    for (let tier = 1; tier <= 6; tier++) {
      expect(getNextQuestion({ tier, usedIds: [] }).difficulty).toBe(tier);
    }
  });

  it('never repeats until the tier is used up, and never reuses an id', () => {
    const bank = loadBank();
    const total = bank.filter((x) => x.difficulty === 2).length;
    const used: string[] = [];
    for (let i = 0; i < total; i++) {
      const next = getNextQuestion({ tier: 2, usedIds: used });
      expect(next.difficulty).toBe(2);
      expect(used).not.toContain(next.id);
      used.push(next.id);
    }
  });

  it('falls back to the nearest tier (lower first) when the tier is used up', () => {
    const bank = [q('a1', 1), q('a2', 2), q('a3', 3)];
    expect(getNextQuestion({ tier: 2, usedIds: ['a2'] }, () => 0, bank).id).toBe('a1');
    expect(getNextQuestion({ tier: 2, usedIds: ['a2', 'a1'] }, () => 0, bank).id).toBe('a3');
  });

  it('repeats a question instead of failing when the whole bank is used up', () => {
    const bank = [q('a1', 1), q('a2', 2)];
    const next = getNextQuestion({ tier: 2, usedIds: ['a1', 'a2'] }, () => 0, bank);
    expect(next.id).toBe('a2');
  });

  it('honours preferredType when one is available, otherwise ignores it', () => {
    const bank = [q('n1', 1), q('f1', 1, 'fill_blank'), q('n2', 1)];
    for (let i = 0; i < 5; i++) {
      expect(
        getNextQuestion({ tier: 1, usedIds: [], preferredType: 'fill_blank' }, Math.random, bank)
          .id,
      ).toBe('f1');
    }
    const next = getNextQuestion(
      { tier: 1, usedIds: ['f1'], preferredType: 'fill_blank' },
      () => 0,
      bank,
    );
    expect(['n1', 'n2']).toContain(next.id);
  });

  it('picks randomly using the injected rng', () => {
    const bank = [q('a', 1), q('b', 1), q('c', 1)];
    expect(getNextQuestion({ tier: 1, usedIds: [] }, () => 0, bank).id).toBe('a');
    expect(getNextQuestion({ tier: 1, usedIds: [] }, () => 0.99, bank).id).toBe('c');
  });

  it('throws on an empty bank', () => {
    expect(() => getNextQuestion({ tier: 1, usedIds: [] }, Math.random, [])).toThrow();
  });
});

describe('toPublicQuestion', () => {
  it('never contains acceptedAnswers or explanation for any bank question', () => {
    for (const question of loadBank()) {
      const pub = toPublicQuestion(question);
      expect(pub).not.toHaveProperty('acceptedAnswers');
      expect(pub).not.toHaveProperty('explanation');
      expect(JSON.stringify(pub)).not.toContain(question.explanation);
      expect(pub.id).toBe(question.id);
    }
  });
});

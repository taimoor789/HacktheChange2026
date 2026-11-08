import { describe, expect, it } from 'vitest';
import { loadBank, loadBankReport } from '../schema';

const good = {
  id: 'x-1',
  type: 'output_prediction',
  difficulty: 1,
  concept: 'variables',
  prompt: 'p',
  code: 'print(1)',
  acceptedAnswers: ['1'],
  explanation: 'e',
};

describe('typing speed rule', () => {
  it('rejects free-text answers that need brackets, quotes or newlines', () => {
    for (const answer of ['[1, 2]', "{'a': 1}", "'hi'", '1\n2', 'f()']) {
      const { errors } = loadBankReport({ 'tier1.json': [{ ...good, acceptedAnswers: [answer] }] });
      expect(errors.join('\n'), answer).toMatch(/brackets\/quotes/);
    }
  });

  it('allows bracketed answers when the player clicks an option', () => {
    const q = {
      ...good,
      type: 'name_concept',
      code: undefined,
      options: ['O(1)', 'O(n)'],
      acceptedAnswers: ['O(1)'],
    };
    expect(loadBankReport({ 'tier1.json': [q] }).errors).toEqual([]);
  });

  it('no free-text answer in the real bank needs brackets, quotes or a newline', () => {
    for (const q of loadBank()) {
      if (q.options || q.type === 'spot_the_bug' || q.type === 'rewrite_code') continue;
      for (const a of q.acceptedAnswers) {
        expect(/[[\]{}()"'`\n]/.test(a), `${q.id}: ${a}`).toBe(false);
      }
    }
  });

  it('keeps free-text answers short enough to type quickly', () => {
    for (const q of loadBank()) {
      if (q.options || q.type === 'rewrite_code') continue;
      expect(q.acceptedAnswers[0].length, q.id).toBeLessThanOrEqual(30);
    }
  });
});

describe('language mix', () => {
  it('has Python, JavaScript and SQL questions at every tier', () => {
    const bank = loadBank();
    for (let tier = 1; tier <= 6; tier++) {
      const atTier = bank.filter((q) => q.difficulty === tier);
      expect(
        atTier.some((q) => q.concept.startsWith('sql')),
        `sql t${tier}`,
      ).toBe(true);
      expect(
        atTier.some((q) => q.id.includes('-js-')),
        `js t${tier}`,
      ).toBe(true);
      expect(
        atTier.some((q) => !q.concept.startsWith('sql') && !q.id.includes('-js-')),
        `py t${tier}`,
      ).toBe(true);
    }
  });

  it('has at least 100 questions', () => {
    expect(loadBank().length).toBeGreaterThanOrEqual(100);
  });
});

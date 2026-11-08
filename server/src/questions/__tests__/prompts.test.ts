import { describe, expect, it } from 'vitest';
import { loadBank } from '../schema';

describe('prompts do not give away their answer', () => {
  it('no typed question contains its accepted answer (or a word starting with it) in the prompt', () => {
    for (const q of loadBank()) {
      if (q.options || q.type === 'spot_the_bug' || q.type === 'rewrite_code') continue;
      const prompt = q.prompt.toLowerCase();
      for (const answer of q.acceptedAnswers) {
        const word = answer
          .toLowerCase()
          .replace(/[^a-z ]/g, '')
          .trim();
        if (word.length < 3) continue;
        expect(
          new RegExp(`\\b${word}`).test(prompt),
          `${q.id}: "${answer}" is in "${q.prompt}"`,
        ).toBe(false);
      }
    }
  });

  it('the eight reworded prompts stay reworded', () => {
    const bank = new Map(loadBank().map((q) => [q.id, q]));
    for (const id of [
      't1-var-5',
      't1-syn-2',
      't4-str-3',
      't1-sql-2',
      't2-sql-2',
      't3-sql-1',
      't3-sql-2',
      't6-sql-1',
    ]) {
      expect(bank.has(id), id).toBe(true);
    }
    expect(bank.get('t1-sql-2')!.prompt).not.toMatch(/from/i);
    expect(bank.get('t3-sql-2')!.prompt).not.toMatch(/group/i);
    expect(bank.get('t4-str-3')!.prompt).not.toMatch(/upper/i);
    expect(bank.get('t6-sql-1')!.prompt).not.toMatch(/index/i);
  });
});

import { describe, expect, it } from 'vitest';
import { MAX_TIER } from '@beatcode/shared';
import { loadBank, loadBankReport, QUESTION_TYPES } from '../schema';

describe('question bank', () => {
  it('has no validation errors', () => {
    expect(loadBankReport().errors).toEqual([]);
  });

  it('loadBank returns the same validated list each time', () => {
    expect(loadBank()).toBe(loadBank());
  });

  it('has enough questions in every tier so matches do not repeat', () => {
    const bank = loadBank();
    for (let tier = 1; tier <= MAX_TIER; tier++) {
      expect(bank.filter((q) => q.difficulty === tier).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('uses every question type somewhere', () => {
    const types = new Set(loadBank().map((q) => q.type));
    for (const t of QUESTION_TYPES) expect(types.has(t)).toBe(true);
  });

  it('has unique ids', () => {
    const ids = loadBank().map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('loadBankReport catches bad data', () => {
  const good = {
    id: 'x-1',
    type: 'name_concept',
    difficulty: 1,
    concept: 'variables',
    prompt: 'p',
    acceptedAnswers: ['a'],
    explanation: 'e',
  };

  it('reports duplicate ids', () => {
    const { errors } = loadBankReport({ 'tier1.json': [good, good] });
    expect(errors.join('\n')).toMatch(/duplicate id/);
  });

  it('reports a concept that is not on the tier of the ladder', () => {
    const { errors } = loadBankReport({ 'tier1.json': [{ ...good, concept: 'recursion' }] });
    expect(errors.join('\n')).toMatch(/not in the ladder/);
  });

  it('reports a difficulty that does not match the file', () => {
    const { errors } = loadBankReport({ 'tier2.json': [good] });
    expect(errors.join('\n')).toMatch(/does not match file/);
  });

  it('reports missing answers and a missing blank', () => {
    const bad = { ...good, type: 'fill_blank', acceptedAnswers: [] };
    const text = loadBankReport({ 'tier1.json': [bad] }).errors.join('\n');
    expect(text).toMatch(/acceptedAnswers/);
    expect(text).toMatch(/___/);
  });

  it('reports spot_the_bug answers outside the code', () => {
    const bad = { ...good, type: 'spot_the_bug', code: 'a\nb', acceptedAnswers: ['5'] };
    expect(loadBankReport({ 'tier1.json': [bad] }).errors.join('\n')).toMatch(/line numbers/);
  });

  it('reports accepted answers that are not among the options', () => {
    const bad = { ...good, options: ['x', 'y'], acceptedAnswers: ['z'] };
    expect(loadBankReport({ 'tier1.json': [bad] }).errors.join('\n')).toMatch(/not one of the options/);
  });

  it('rejects non-array files and non-object questions', () => {
    expect(loadBankReport({ 'tier1.json': {} }).errors.length).toBe(1);
    expect(loadBankReport({ 'tier1.json': ['nope'] }).errors.length).toBe(1);
  });
});

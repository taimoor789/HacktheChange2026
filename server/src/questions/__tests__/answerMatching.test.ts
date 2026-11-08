import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import { isCorrect } from '../answerMatching';
import { loadBank } from '../schema';

const make = (over: Partial<Question>): Question => ({
  id: 'x',
  type: 'name_concept',
  difficulty: 1,
  concept: 'variables',
  prompt: 'p',
  acceptedAnswers: ['a'],
  explanation: 'e',
  ...over,
});

describe('fill_blank / name_concept', () => {
  const stack = make({ acceptedAnswers: ['stack'] });

  it('ignores case and surrounding whitespace', () => {
    expect(isCorrect(stack, '  STACK ')).toBe(true);
  });
  it('ignores wrapping quotes, trailing semicolon and ()', () => {
    expect(isCorrect(make({ acceptedAnswers: ['append'] }), '"append"')).toBe(true);
    expect(isCorrect(make({ acceptedAnswers: ['append'] }), 'append()')).toBe(true);
    expect(isCorrect(make({ acceptedAnswers: ['return'] }), 'return;')).toBe(true);
  });
  it('collapses inner whitespace', () => {
    expect(isCorrect(make({ acceptedAnswers: ['base case'] }), 'base    case')).toBe(true);
  });
  it('accepts any of several accepted answers', () => {
    const q = make({ acceptedAnswers: ['string', 'str'] });
    expect(isCorrect(q, 'str')).toBe(true);
    expect(isCorrect(q, 'String')).toBe(true);
  });
  it('rejects wrong, empty and oversized answers', () => {
    expect(isCorrect(stack, 'queue')).toBe(false);
    expect(isCorrect(stack, '')).toBe(false);
    expect(isCorrect(stack, '   ')).toBe(false);
    expect(isCorrect(stack, 'stack'.repeat(200))).toBe(false);
    expect(isCorrect(stack, undefined as unknown as string)).toBe(false);
  });
  it('keeps symbol-only answers intact', () => {
    expect(isCorrect(make({ type: 'fill_blank', acceptedAnswers: ['=='] }), '==')).toBe(true);
    expect(isCorrect(make({ type: 'fill_blank', acceptedAnswers: ['='] }), '==')).toBe(false);
    expect(isCorrect(make({ acceptedAnswers: ['#'] }), '#')).toBe(true);
  });
  it('does not strip the parentheses from O(1)', () => {
    expect(isCorrect(make({ acceptedAnswers: ['O(1)'] }), 'o(1)')).toBe(true);
    expect(isCorrect(make({ acceptedAnswers: ['O(1)'] }), 'o')).toBe(false);
  });
});

describe('output_prediction', () => {
  const lines = make({ type: 'output_prediction', acceptedAnswers: ['1\n2\n3'] });

  it('is case-sensitive', () => {
    const q = make({ type: 'output_prediction', acceptedAnswers: ['B'] });
    expect(isCorrect(q, 'B')).toBe(true);
    expect(isCorrect(q, 'b')).toBe(false);
  });
  it('ignores line endings and per-line whitespace', () => {
    expect(isCorrect(lines, '1\r\n 2 \r\n3\n')).toBe(true);
  });
  it('accepts a multi-line output typed on one line', () => {
    expect(isCorrect(lines, '1 2 3')).toBe(true);
    expect(isCorrect(lines, '1 3 2')).toBe(false);
  });
  it('requires exact structure for lists and dicts', () => {
    const q = make({ type: 'output_prediction', acceptedAnswers: ['[6, 7]'] });
    expect(isCorrect(q, '[6, 7]')).toBe(true);
    expect(isCorrect(q, '[6,7]')).toBe(false);
  });
});

describe('spot_the_bug', () => {
  const q = make({ type: 'spot_the_bug', code: 'a\nb\nc', acceptedAnswers: ['2'] });

  it('accepts the line number, with or without the word line', () => {
    expect(isCorrect(q, '2')).toBe(true);
    expect(isCorrect(q, ' line 2 ')).toBe(true);
    expect(isCorrect(q, 'Line2')).toBe(true);
  });
  it('rejects other lines and non-numbers', () => {
    expect(isCorrect(q, '3')).toBe(false);
    expect(isCorrect(q, 'two')).toBe(false);
    expect(isCorrect(q, '2.5')).toBe(false);
  });
});

describe('options', () => {
  const q = make({
    options: ['O(1)', 'O(n)', 'O(log n)', 'O(n^2)'],
    acceptedAnswers: ['O(log n)'],
  });

  it('accepts the option text', () => {
    expect(isCorrect(q, 'O(log n)')).toBe(true);
    expect(isCorrect(q, 'o(log n)')).toBe(true);
  });
  it('accepts the 0-based option index', () => {
    expect(isCorrect(q, '2')).toBe(true);
    expect(isCorrect(q, '0')).toBe(false);
    expect(isCorrect(q, '9')).toBe(false);
  });
  it('reads a submission equal to option text as text, not as an index', () => {
    const numeric = make({ options: ['1', '0', '2'], acceptedAnswers: ['2'] });
    expect(isCorrect(numeric, '2')).toBe(true); // text "2" (index 2 is also "2")
    const tricky = make({ options: ['2', '1', '0'], acceptedAnswers: ['2'] });
    expect(isCorrect(tricky, '1')).toBe(false); // text "1" is a wrong option, not index 1 -> "1"
    expect(isCorrect(tricky, '0')).toBe(false);
  });
});

describe('bank answers', () => {
  it('every accepted answer is judged correct for its own question', () => {
    for (const question of loadBank()) {
      for (const answer of question.acceptedAnswers) {
        expect(isCorrect(question, answer), `${question.id} should accept "${answer}"`).toBe(true);
      }
    }
  });

  it('no question accepts an obviously wrong answer', () => {
    for (const question of loadBank()) {
      expect(isCorrect(question, 'zzz-wrong-answer'), question.id).toBe(false);
      expect(isCorrect(question, '999'), question.id).toBe(false);
    }
  });
});

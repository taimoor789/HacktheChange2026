// What the engine (Owner A) relies on: isCorrect is a plain boolean, a typo hint never counts as correct,
// and rewrite_code grading is fast and deterministic.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import { isCorrect } from '../answerMatching';
import { getNextQuestion, toPublicQuestion } from '../selector';
import { getQuestionSeconds } from '../ladder';
import { checkAnswer, MAX_SUGGESTIONS_PER_QUESTION, suggestAnswer } from '../suggestion';
import { loadBank } from '../schema';

const bank = loadBank();
const byId = (id: string) => bank.find((q) => q.id === id)!;
const freeText = (q: Question) =>
  !q.options && q.type !== 'spot_the_bug' && q.type !== 'rewrite_code';

/** One-letter slips of a word: missing, extra, wrong and swapped letter. */
function typosOf(word: string): string[] {
  const m = Math.floor(word.length / 2);
  const out = [
    word.slice(0, m) + word.slice(m + 1),
    word.slice(0, m) + 'q' + word.slice(m),
    word.slice(0, m) + (word[m] === 'z' ? 'y' : 'z') + word.slice(m + 1),
  ];
  if (word[m] !== word[m + 1])
    out.push(word.slice(0, m) + word[m + 1] + word[m] + word.slice(m + 2));
  return out;
}

describe('isCorrect returns a plain boolean', () => {
  const inputs = [
    '',
    ' ',
    'x',
    '???',
    '0',
    '1',
    'None',
    'line 2',
    '\n\n',
    'x'.repeat(5000),
    '\u0000',
    'é'.repeat(50),
  ];

  it('is strictly true or false for every bank question and many kinds of input', () => {
    for (const q of bank) {
      for (const input of [...inputs, ...q.acceptedAnswers, q.code ?? '']) {
        const result = isCorrect(q, input);
        expect(typeof result, `${q.id} ${JSON.stringify(input.slice(0, 20))}`).toBe('boolean');
      }
      expect(isCorrect(q, undefined as unknown as string)).toBe(false);
      expect(isCorrect(q, null as unknown as string)).toBe(false);
      expect(isCorrect(q, 42 as unknown as string)).toBe(false);
    }
  });

  it('every accepted answer is true', () => {
    for (const q of bank)
      for (const a of q.acceptedAnswers) expect(isCorrect(q, a), q.id).toBe(true);
  });
});

describe('a typo hint never counts as correct', () => {
  it('the example: "strig" is false from isCorrect but still gets a suggestion from checkAnswer', () => {
    const q = byId('t1-var-4'); // "What data type holds text?" -> string / str
    expect(isCorrect(q, 'strig')).toBe(false);
    expect(suggestAnswer(q, 'strig')).toBe('string');
    expect(checkAnswer(q, 'strig')).toEqual({ status: 'suggest', suggestion: 'string' });
    // the hint is only a hint: confirming means submitting the full answer, which isCorrect judges as usual
    expect(isCorrect(q, 'string')).toBe(true);
  });

  it('holds for typos of every free-text answer in the bank', () => {
    let hinted = 0;
    for (const q of bank.filter(freeText)) {
      for (const answer of q.acceptedAnswers) {
        for (const typo of typosOf(answer)) {
          if (isCorrect(q, typo)) continue; // the typo happens to be another accepted spelling
          const check = checkAnswer(q, typo);
          expect(check.status, `${q.id} ${typo}`).not.toBe('correct');
          expect(isCorrect(q, typo), `${q.id} ${typo}`).toBe(false);
          if (check.status === 'suggest') {
            hinted++;
            expect(isCorrect(q, check.suggestion), `${q.id} suggestion`).toBe(true);
          }
        }
      }
    }
    expect(hinted).toBeGreaterThan(100); // the property was exercised, not skipped
  });

  it("checkAnswer says 'correct' exactly when isCorrect is true", () => {
    for (const q of bank) {
      for (const input of [
        '',
        '???',
        'x',
        ...q.acceptedAnswers,
        ...q.acceptedAnswers.flatMap(typosOf),
      ]) {
        expect(
          checkAnswer(q, input).status === 'correct',
          `${q.id} ${JSON.stringify(input.slice(0, 20))}`,
        ).toBe(isCorrect(q, input));
      }
    }
  });

  it('rewrite_code never produces a suggestion', () => {
    for (const q of bank.filter((x) => x.type === 'rewrite_code')) {
      for (const input of [q.acceptedAnswers[0].slice(0, -2), q.code!, 'retrun x']) {
        expect(checkAnswer(q, input).status).not.toBe('suggest');
      }
    }
  });
});

describe('rewrite_code grading is fast and deterministic', () => {
  const rewrites = bank.filter((q) => q.type === 'rewrite_code');
  const longest = rewrites.reduce((a, b) =>
    a.acceptedAnswers[0].length > b.acceptedAnswers[0].length ? a : b,
  );
  const worstCases: Record<string, string> = {
    'one 3000-char identifier': 'a'.repeat(3000),
    'punctuation tokens': '(){}[]<>+-=*/'.repeat(230),
    'many short words': 'ab cd ef '.repeat(330),
    'nested quotes': '"'.repeat(1500) + "'".repeat(1400),
    'comment lines': '# c\n'.repeat(700),
    'near-miss names': longest.acceptedAnswers[0].replace(
      /\b([a-z]{5,})\b/g,
      (w) => w.slice(0, 2) + w.slice(3),
    ),
  };

  it('judges every worst-case input in a few milliseconds (budget 25 ms, real cost is about 0.1 ms)', () => {
    for (const [name, input] of Object.entries(worstCases)) {
      const start = performance.now();
      for (let i = 0; i < 20; i++) isCorrect(longest, input);
      const perCall = (performance.now() - start) / 20;
      expect(perCall, name).toBeLessThan(25);
    }
  });

  it('gives the same answer every time for the same input', () => {
    for (const q of rewrites) {
      for (const input of [q.acceptedAnswers[0], q.code!, 'x', ...Object.values(worstCases)]) {
        const first = isCorrect(q, input);
        for (let i = 0; i < 25; i++) expect(isCorrect(q, input)).toBe(first);
      }
    }
  });

  it('does not depend on randomness, the clock, code execution or async work (source check)', () => {
    for (const file of ['../answerMatching.ts', '../editDistance.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const banned of [
        /Math\.random/,
        /Date\.now/,
        /new Date/,
        /performance\.now/,
        /\beval\s*\(/,
        /new Function/,
        /child_process/,
        /\bawait\b/,
        /\basync\b/,
        /setTimeout/,
        /Promise/,
        /from 'node:/,
      ]) {
        expect(code, `${file} must not use ${banned}`).not.toMatch(banned);
      }
    }
  });
});

describe('the four functions the engine imports keep their shape', () => {
  it('getNextQuestion({tier, usedIds}, rng), toPublicQuestion, isCorrect, getQuestionSeconds', () => {
    const q = getNextQuestion({ tier: 2, usedIds: [] }, () => 0.5);
    expect(q.difficulty).toBe(2);
    expect(toPublicQuestion(q)).not.toHaveProperty('acceptedAnswers');
    expect(typeof isCorrect(q, 'x')).toBe('boolean');
    expect(getQuestionSeconds(q)).toBeGreaterThan(0);
    expect(getNextQuestion.length).toBeGreaterThanOrEqual(1);
  });
});

describe('checkAnswer vs isCorrect across the whole bank, including typo variants', () => {
  /** Inputs that exercise every question type: right answers, typos, wrong lines, broken code, junk. */
  function variants(q: Question): string[] {
    const out = ['', ' ', '???', 'x', '0', '999', 'line 1', 'line 99', 'None', 'zzzz zzzz'];
    for (const a of q.acceptedAnswers) {
      out.push(a, a.toUpperCase(), `  ${a}  `, a.slice(0, -1), a.slice(1), a + 'x');
      out.push(...typosOf(a));
      if (q.type === 'rewrite_code') {
        out.push(a.replace(/\b([A-Za-z_]{5,})\b/, (w) => w.slice(0, 2) + w.slice(3))); // a misspelled name
        out.push(a.replace(/\n/g, ' '), a.replace(/^ +/gm, ''), a.split('\n').slice(1).join('\n'));
      }
    }
    if (q.code) out.push(q.code);
    return out;
  }

  it("is 'correct' exactly when isCorrect is true, never otherwise, for every question and variant", () => {
    let checked = 0;
    for (const q of bank) {
      for (const input of variants(q)) {
        for (const hintsUsed of [0, 1, 2]) {
          const status = checkAnswer(q, input, hintsUsed).status;
          const label = `${q.id} hintsUsed=${hintsUsed} ${JSON.stringify(input.slice(0, 30))}`;
          expect(status === 'correct', label).toBe(isCorrect(q, input));
          if (isCorrect(q, input)) expect(status, label).toBe('correct');
          else expect(status, label).not.toBe('correct');
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it("never says 'suggest' for rewrite_code, spot_the_bug or option questions, or once the cap is reached", () => {
    for (const q of bank) {
      for (const input of variants(q)) {
        const status0 = checkAnswer(q, input, 0).status;
        if (q.type === 'rewrite_code' || q.type === 'spot_the_bug' || q.options) {
          expect(status0, `${q.id} ${JSON.stringify(input.slice(0, 30))}`).not.toBe('suggest');
        }
        expect(checkAnswer(q, input, MAX_SUGGESTIONS_PER_QUESTION).status).not.toBe('suggest');
      }
    }
  });

  it('a hint is only ever given for input that isCorrect rejects, and confirming it is correct', () => {
    let hints = 0;
    for (const q of bank) {
      for (const input of variants(q)) {
        const check = checkAnswer(q, input, 0);
        if (check.status !== 'suggest') continue;
        hints++;
        expect(isCorrect(q, input), `${q.id} ${input}`).toBe(false);
        expect(isCorrect(q, check.suggestion), `${q.id} ${check.suggestion}`).toBe(true);
      }
    }
    expect(hints).toBeGreaterThan(100);
  });
});

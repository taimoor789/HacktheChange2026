import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import { codeTokens, isCorrect, matchesCode } from '../answerMatching';
import { checkAnswer, suggestAnswer } from '../suggestion';
import { getQuestionSeconds, getTimerSeconds } from '../ladder';
import { getNextQuestion } from '../selector';
import { loadBank, loadBankReport } from '../schema';

const rewrites = () => loadBank().filter((q) => q.type === 'rewrite_code');
const sql = (q: Question) => q.concept.startsWith('sql');

describe('rewrite_code bank', () => {
  it('has rewrite questions in several tiers, each with a long enough time limit', () => {
    const qs = rewrites();
    expect(qs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(qs.map((q) => q.difficulty)).size).toBeGreaterThanOrEqual(3);
    for (const q of qs) {
      expect(q.seconds, q.id).toBeGreaterThanOrEqual(30);
      expect(q.code, q.id).toBeTruthy();
    }
  });

  it('accepts every listed solution, and never the buggy code itself', () => {
    for (const q of rewrites()) {
      for (const a of q.acceptedAnswers)
        expect(isCorrect(q, a), `${q.id} should accept its solution`).toBe(true);
      expect(isCorrect(q, q.code!), `${q.id} must not accept the buggy code`).toBe(false);
    }
  });

  it('ignores indentation, line breaks, spacing and semicolons', () => {
    for (const q of rewrites()) {
      const flat = q.acceptedAnswers[0].replace(/\s+/g, ' ');
      expect(isCorrect(q, flat), `${q.id} one line`).toBe(true);
      expect(isCorrect(q, q.acceptedAnswers[0].replace(/^[ \t]+/gm, '')), `${q.id} no indent`).toBe(
        true,
      );
      expect(
        isCorrect(q, '\n\n  ' + q.acceptedAnswers[0].replace(/\n/g, '\r\n') + '\n\n'),
        `${q.id} crlf`,
      ).toBe(true);
    }
  });

  it('forgives a misspelled name or keyword but not a real change', () => {
    for (const q of rewrites()) {
      const answer = q.acceptedAnswers[0];
      const ref = codeTokens(answer, sql(q));
      const vocab = new Set(ref.filter((t) => /^[A-Za-z_]\w*$/.test(t)));
      // a long identifier whose misspelling is not another name in the code
      const word = [...vocab].find(
        (w) => w.length >= 5 && !vocab.has(w.slice(0, -1)) && !vocab.has(w + 's'),
      );
      if (!word) continue;
      const typo = word.slice(0, 2) + word.slice(3); // drop the third letter
      if (vocab.has(typo)) continue;
      const mutated = answer.replace(new RegExp(`\\b${word}\\b`), typo);
      expect(isCorrect(q, mutated), `${q.id}: ${word} -> ${typo}`).toBe(true);
    }
  });

  it('rejects removed lines, changed operators and changed numbers', () => {
    for (const q of rewrites()) {
      const answer = q.acceptedAnswers[0];
      const lines = answer.split('\n');
      if (lines.length > 1) {
        const dropped = lines.filter((_, i) => i !== Math.floor(lines.length / 2)).join('\n');
        expect(isCorrect(q, dropped), `${q.id} dropped a line`).toBe(false);
      }
      expect(isCorrect(q, answer.replace(/[<>+\-=]+/, ' ? ')), `${q.id} operator`).toBe(false);
      expect(isCorrect(q, answer + '\nextra_statement_here()'), `${q.id} extra line`).toBe(false);
    }
    expect(isCorrect(rewrites()[0], 'x')).toBe(false);
    expect(isCorrect(rewrites()[0], '   ')).toBe(false);
  });
});

describe('matchesCode', () => {
  const ref = codeTokens('return base * power(base, exp - 1)');
  it('allows up to 3 distinct misspelled names, not 4', () => {
    expect(matchesCode(codeTokens('retrun base * powr(base, exp - 1)'), ref)).toBe(true);
    expect(matchesCode(codeTokens('retrun bsae * powr(base, exp - 1)'), ref)).toBe(true);
    expect(matchesCode(codeTokens('retrun bsae * powr(bsae, exp - 1)'), ref)).toBe(true); // bsae twice = one slip
    expect(matchesCode(codeTokens('retrun bsae * powr(bsae, epxx - 1)'), ref)).toBe(false); // a 4th distinct slip
  });
  it('treats a different name used in the code as a real mistake, not a typo', () => {
    const r = codeTokens('for item in items: print(item)');
    expect(matchesCode(codeTokens('for items in items: print(item)'), r)).toBe(false);
  });
  it('never forgives short names, numbers or operators', () => {
    expect(matchesCode(codeTokens('x = lo + 1'), codeTokens('x = hi + 1'))).toBe(false);
    expect(matchesCode(codeTokens('x = low + 2'), codeTokens('x = low + 1'))).toBe(false);
    expect(matchesCode(codeTokens('x = low - 1'), codeTokens('x = low + 1'))).toBe(false);
  });
  it('ignores full-line comments but not code', () => {
    expect(codeTokens('# hi\nx = 1 // 2\n-- note\n')).toEqual(['x', '=', '1', '//', '2']);
  });
  it('is case-insensitive for SQL only', () => {
    const q: Question = {
      id: 'q',
      type: 'rewrite_code',
      difficulty: 5,
      concept: 'sql advanced',
      prompt: 'p',
      code: 'SELECT a FROM t JOIN u ON t.id = u.id',
      seconds: 60,
      explanation: 'e',
      acceptedAnswers: ['SELECT a FROM t LEFT JOIN u ON t.id = u.id'],
    };
    expect(isCorrect(q, 'select a from t left join u on t.id = u.id;')).toBe(true);
    const py: Question = {
      ...q,
      concept: 'functions',
      difficulty: 3,
      acceptedAnswers: ['return Value'],
    };
    expect(isCorrect(py, 'return value')).toBe(true); // a case slip is a spelling slip...
    expect(isCorrect({ ...py, acceptedAnswers: ['x = 1'] }, 'X = 1')).toBe(false); // ...but short names are exact
  });
});

describe('no suggestions for rewrite_code', () => {
  it('never returns a Did-you-mean for code questions', () => {
    for (const q of rewrites()) {
      expect(suggestAnswer(q, q.acceptedAnswers[0].slice(0, -3)), q.id).toBeNull();
      expect(checkAnswer(q, 'nonsense').status).toBe('wrong');
    }
  });
});

describe('per-question time limits', () => {
  it('keeps the tier timer for normal questions, so it shrinks as tiers rise', () => {
    const normal = (difficulty: number) => ({ difficulty });
    expect(getQuestionSeconds(normal(1))).toBe(getTimerSeconds(1));
    expect(getQuestionSeconds(normal(6))).toBe(getTimerSeconds(6));
    expect(getQuestionSeconds(normal(6))).toBeLessThan(getQuestionSeconds(normal(1)));
  });
  it('lets a long question keep its longer limit at any tier', () => {
    for (const q of rewrites()) {
      expect(getQuestionSeconds(q), q.id).toBe(Math.max(getTimerSeconds(q.difficulty), q.seconds!));
      expect(getQuestionSeconds(q), q.id).toBeGreaterThan(getTimerSeconds(q.difficulty));
    }
  });
});

describe('validation of rewrite_code', () => {
  const good = {
    id: 'rw-1',
    type: 'rewrite_code',
    difficulty: 3,
    concept: 'functions',
    prompt: 'p',
    code: 'def f():\n    return 1',
    seconds: 45,
    explanation: 'e',
    acceptedAnswers: ['def f():\n    return 2'],
  };
  const errorsFor = (over: object) =>
    loadBankReport({ 'tier3.json': [{ ...good, ...over }] }).errors.join('\n');

  it('accepts a well-formed question', () => expect(errorsFor({})).toBe(''));
  it('needs code and a time limit of at least 30 seconds', () => {
    expect(errorsFor({ code: undefined })).toMatch(/needs/);
    expect(errorsFor({ seconds: undefined })).toMatch(/seconds >= 30/);
    expect(errorsFor({ seconds: 10 })).toMatch(/seconds >= 30/);
  });
  it('rejects an accepted answer identical to the buggy code (spacing ignored)', () => {
    expect(errorsFor({ acceptedAnswers: ['def f():  return 1'] })).toMatch(
      /identical to the buggy code/,
    );
  });
  it('rejects options, empty answers and bad seconds', () => {
    expect(errorsFor({ options: ['a', 'b'] })).toMatch(/cannot have options/);
    expect(errorsFor({ acceptedAnswers: [';'] })).toMatch(/no code/);
    expect(errorsFor({ seconds: 999 })).toMatch(/between 5 and 300/);
  });
});

describe('selection', () => {
  it('can be requested by type and respects the tier', () => {
    for (let i = 0; i < 30; i++) {
      const q = getNextQuestion({ tier: 5, usedIds: [], preferredType: 'rewrite_code' });
      expect(q.type).toBe('rewrite_code');
      expect(q.difficulty).toBe(5);
    }
  });
});

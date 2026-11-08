import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import {
  codeTokens,
  forgivenTypos,
  hasSignificantIndentation,
  isCorrect,
  isPluralFlip,
  matchesCode,
} from '../answerMatching';
import { checkAnswer, suggestAnswer } from '../suggestion';
import { getQuestionSeconds, getTimerSeconds, MAX_QUESTION_SECONDS } from '../ladder';
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

  it('JavaScript and SQL ignore indentation, line breaks, spacing and semicolons', () => {
    const others = rewrites().filter((q) => !hasSignificantIndentation(q));
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const q of others) {
      const flat = q.acceptedAnswers[0].replace(/\s+/g, ' ');
      expect(isCorrect(q, flat), `${q.id} one line`).toBe(true);
      expect(isCorrect(q, q.acceptedAnswers[0].replace(/^[ \t]+/gm, '')), `${q.id} no indent`).toBe(
        true,
      );
    }
  });

  it('every question tolerates CRLF line endings and blank lines around the answer', () => {
    for (const q of rewrites()) {
      const typed = '\n\n' + q.acceptedAnswers[0].replace(/\n/g, '\r\n') + '\n\n';
      expect(isCorrect(q, typed), `${q.id} crlf`).toBe(true);
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
      expect(checkAnswer(q, 'nonsense', 0).status).toBe('wrong');
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
  it('rejects an accepted answer identical to the buggy code (indent width ignored)', () => {
    expect(errorsFor({ acceptedAnswers: ['def f():\n  return 1'] })).toMatch(
      /identical to the buggy code/,
    );
  });
  it('rejects options, empty answers and bad seconds', () => {
    expect(errorsFor({ options: ['a', 'b'] })).toMatch(/cannot have options/);
    expect(errorsFor({ acceptedAnswers: [';'] })).toMatch(/no code/);
    expect(errorsFor({ seconds: 999 })).toMatch(/between 5 and 60/);
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

describe('Python rewrite_code: indentation is significant', () => {
  const python = () => rewrites().filter((q) => hasSignificantIndentation(q));
  const multi = () => python().filter((q) => q.acceptedAnswers[0].includes('\n'));
  const reindent = (code: string, unit: string) =>
    code.replace(/^( +)/gm, (spaces) => unit.repeat(spaces.length / 4));

  it('finds the Python and the non-Python questions correctly', () => {
    expect(
      python()
        .map((q) => q.id)
        .sort(),
    ).toEqual(['t3-rw-1', 't4-rw-1', 't5-rw-1', 't5-rw-3', 't6-rw-1', 't6-rw-2'].sort());
    for (const q of rewrites().filter((x) => !python().includes(x))) {
      expect(q.code).not.toMatch(/^\s*def\b/m);
    }
  });

  it('rejects the right code with the indentation removed or flattened', () => {
    expect(multi().length).toBeGreaterThanOrEqual(5);
    for (const q of multi()) {
      const answer = q.acceptedAnswers[0];
      expect(isCorrect(q, answer.replace(/^[ \t]+/gm, '')), `${q.id} no indent`).toBe(false);
      expect(isCorrect(q, answer.replace(/\s+/g, ' ')), `${q.id} one line`).toBe(false);
    }
  });

  it('rejects the right lines at the wrong nesting level', () => {
    for (const q of multi()) {
      const lines = q.acceptedAnswers[0].split('\n');
      const last = lines.length - 1;
      // move the last line out one level, and push the second line in one level
      const out = [...lines.slice(0, last), lines[last].replace(/^ {4}/, '')].join('\n');
      const into = [lines[0], '    ' + lines[1], ...lines.slice(2)].join('\n');
      expect(isCorrect(q, out), `${q.id} last line dedented`).toBe(false);
      expect(isCorrect(q, into), `${q.id} second line indented`).toBe(false);
    }
  });

  it('accepts any consistent indent width: 2 spaces, 8 spaces, tabs, or a uniform extra indent', () => {
    for (const q of multi()) {
      const answer = q.acceptedAnswers[0];
      expect(isCorrect(q, reindent(answer, '  ')), `${q.id} 2 spaces`).toBe(true);
      expect(isCorrect(q, reindent(answer, '        ')), `${q.id} 8 spaces`).toBe(true);
      expect(isCorrect(q, reindent(answer, '\t')), `${q.id} tabs`).toBe(true);
      expect(isCorrect(q, answer.replace(/^/gm, '    ')), `${q.id} uniform extra indent`).toBe(
        true,
      );
    }
  });

  it('rejects a dedent to a level that was never opened', () => {
    const q = rewrites().find((x) => x.id === 't5-rw-1')!;
    const lines = q.acceptedAnswers[0].split('\n');
    const broken = [...lines.slice(0, 4), '  ' + lines[4], ...lines.slice(5)].join('\n'); // 2 spaces: between levels
    expect(isCorrect(q, broken)).toBe(false);
  });

  it('single-line fixes work at any indentation', () => {
    for (const q of python()) {
      for (const a of q.acceptedAnswers.filter((x) => !x.includes('\n'))) {
        expect(isCorrect(q, a), `${q.id} ${a}`).toBe(true);
        expect(isCorrect(q, '        ' + a), `${q.id} indented ${a}`).toBe(true);
      }
    }
  });

  it('ignores a trailing comment on a line, but not other extra code', () => {
    const q = rewrites().find((x) => x.id === 't5-rw-3')!;
    const answer = q.acceptedAnswers[0];
    expect(isCorrect(q, answer.replace('return 1', 'return 1  # base case'))).toBe(true);
    expect(isCorrect(q, answer.replace('return 1', 'return 1 + 0'))).toBe(false);
  });

  it('JavaScript and SQL are not affected', () => {
    const js = rewrites().find((x) => x.id === 't5-rw-2')!;
    expect(isCorrect(js, js.acceptedAnswers[0].replace(/\s+/g, ' '))).toBe(true);
    const sql = rewrites().find((x) => x.id === 't5-rw-4')!;
    expect(isCorrect(sql, sql.acceptedAnswers[0].replace(/\s+/g, ' '))).toBe(true);
  });
});

describe('forgivenTypos (post-match review)', () => {
  const q = rewrites().find((x) => x.id === 't5-rw-3')!; // def power(base, exp) ...

  it('reports nothing for an exact answer and null for a wrong one', () => {
    expect(forgivenTypos(q, q.acceptedAnswers[0])).toEqual([]);
    expect(forgivenTypos(q, q.code!)).toBeNull();
    expect(forgivenTypos(q, '')).toBeNull();
  });

  it('reports which misspellings were forgiven, once each', () => {
    const typed = q.acceptedAnswers[0].replace('return 1', 'retrun 1').replace(/base/g, 'bsae');
    expect(isCorrect(q, typed)).toBe(true);
    expect(forgivenTypos(q, typed)).toEqual([
      { typed: 'bsae', expected: 'base' },
      { typed: 'retrun', expected: 'return' },
    ]);
  });

  it('stays consistent with isCorrect for every rewrite question', () => {
    for (const r of rewrites()) {
      for (const a of r.acceptedAnswers) expect(forgivenTypos(r, a), r.id).toEqual([]);
      expect(forgivenTypos(r, r.code!), r.id).toBeNull();
    }
  });

  it('is null for question types other than rewrite_code', () => {
    const fb = loadBank().find((x) => x.type === 'fill_blank')!;
    expect(forgivenTypos(fb, fb.acceptedAnswers[0])).toBeNull();
  });
});

describe('real names are never forgiven as typos', () => {
  const rw = (id: string) => rewrites().find((q) => q.id === id)!;
  const synthetic = (code: string, answer: string): Question => ({
    id: 'syn',
    type: 'rewrite_code',
    difficulty: 3,
    concept: 'functions',
    prompt: 'p',
    code,
    seconds: 45,
    acceptedAnswers: [answer],
    explanation: 'e',
  });

  it('rejects item for items (singular/plural flip) in the real t4-rw-1 question', () => {
    const q = rw('t4-rw-1');
    const answer = q.acceptedAnswers[0];
    expect(answer).toContain('items');
    expect(isCorrect(q, answer.replace(/items/g, 'item'))).toBe(false); // every occurrence
    expect(isCorrect(q, answer.replace('items', 'item'))).toBe(false); // just one occurrence
    expect(isCorrect(q, answer)).toBe(true);
  });

  it('(a) treats a name shown in the question code as real, even if the solution does not use it', () => {
    const answer = 'def f(a, limit):\n    return limit';
    const withDecoy = synthetic('def f(a, limix, limit):\n    return a', answer);
    const withoutDecoy = synthetic('def f(a, limit):\n    return a', answer);
    const typed = 'def f(a, limit):\n    return limix'; // limix is one letter from limit
    expect(isCorrect(withDecoy, typed)).toBe(false); // limix is a real name in the shown code
    expect(isCorrect(withoutDecoy, typed)).toBe(true); // otherwise it is just a typo
    // a genuine typo of the right name is still forgiven when the decoy exists
    expect(isCorrect(withDecoy, 'def f(a, limit):\n    return limitt')).toBe(true);
    expect(isCorrect(withDecoy, answer)).toBe(true);
  });

  it('(b) rejects singular/plural flips in both directions and with any case', () => {
    for (const [typed, expected] of [
      ['item', 'items'],
      ['items', 'item'],
      ['box', 'boxes'],
      ['queries', 'query'],
      ['Items', 'item'],
    ]) {
      expect(isPluralFlip(typed, expected), `${typed}/${expected}`).toBe(true);
    }
    for (const [typed, expected] of [
      ['functio', 'function'],
      ['retrun', 'return'],
      ['lenght', 'length'],
      ['limix', 'limit'],
    ]) {
      expect(isPluralFlip(typed, expected), `${typed}/${expected}`).toBe(false);
    }
    expect(matchesCode(codeTokens('for item in x'), codeTokens('for items in x'))).toBe(false);
    expect(matchesCode(codeTokens('for items in y'), codeTokens('for item in y'))).toBe(false);
  });

  it('still forgives function -> functio and other ordinary typos', () => {
    expect(
      matchesCode(
        codeTokens('functio f(a) { return a }'),
        codeTokens('function f(a) { return a }'),
      ),
    ).toBe(true);
    const q = rw('t4-rw-2'); // JavaScript: function sumTo(nums) { ... }
    const typed = q.acceptedAnswers[0].replace('function sumTo', 'functio sumTo');
    expect(isCorrect(q, typed)).toBe(true);
    expect(forgivenTypos(q, typed)).toEqual([{ typed: 'functio', expected: 'function' }]);
    expect(isCorrect(q, q.acceptedAnswers[0].replace('return total', 'retrun total'))).toBe(true);
  });
});

describe('rewrite_code round length is capped at 60 seconds (agreed with Owner A)', () => {
  it('MAX_QUESTION_SECONDS is 60 and caps any question', () => {
    expect(MAX_QUESTION_SECONDS).toBe(60);
    expect(getQuestionSeconds({ difficulty: 6, seconds: 300 })).toBe(60);
    expect(getQuestionSeconds({ difficulty: 6, seconds: 120 })).toBe(60);
    expect(getQuestionSeconds({ difficulty: 1 })).toBe(getTimerSeconds(1)); // normal questions are not affected
    expect(getQuestionSeconds({ difficulty: 6, seconds: 45 })).toBe(45);
  });

  it('no question in the bank has a round longer than 60 seconds', () => {
    for (const q of loadBank()) {
      expect(getQuestionSeconds(q), q.id).toBeLessThanOrEqual(60);
      expect(q.seconds ?? 0, q.id).toBeLessThanOrEqual(60);
    }
  });

  it('is still longer than the tier timer, so the heavy question is not squeezed', () => {
    for (const q of rewrites())
      expect(getQuestionSeconds(q), q.id).toBeGreaterThan(getTimerSeconds(q.difficulty));
  });

  it('the shortest accepted answer can be typed in the time given (about 3 characters per second, 15 seconds to think)', () => {
    for (const q of rewrites()) {
      const shortest = Math.min(...q.acceptedAnswers.map((a) => a.length));
      const budget = (getQuestionSeconds(q) - 15) * 3;
      expect(
        shortest,
        `${q.id}: ${shortest} chars in ${getQuestionSeconds(q)}s`,
      ).toBeLessThanOrEqual(budget);
    }
  });

  it('the validator rejects a time limit above 60', () => {
    const q = {
      id: 'rw-1',
      type: 'rewrite_code',
      difficulty: 3,
      concept: 'functions',
      prompt: 'p',
      code: 'def f():\n    return 1',
      explanation: 'e',
      acceptedAnswers: ['def f():\n    return 2'],
    };
    expect(loadBankReport({ 'tier3.json': [{ ...q, seconds: 61 }] }).errors.join('\n')).toMatch(
      /between 5 and 60/,
    );
    expect(loadBankReport({ 'tier3.json': [{ ...q, seconds: 60 }] }).errors).toEqual([]);
  });
});

describe('natural, valid ways of writing a fix are accepted', () => {
  const rw = (id: string) => rewrites().find((q) => q.id === id)!;

  it.each([
    ['t3-rw-1', "best = float('-inf')"],
    ['t3-rw-1', 'best = -float("inf")'],
    ['t4-rw-1', 'temp = items[left]\nitems[left] = items[right]\nitems[right] = temp'],
    ['t4-rw-1', 'tmp = items[right]\nitems[right] = items[left]\nitems[left] = tmp'],
    ['t4-rw-1', 'items[right], items[left] = items[left], items[right]'],
    ['t4-rw-2', 'for (let i = 0; i < nums.length; i++)'],
    ['t4-rw-2', 'for (let i = 0; i < nums.length; i++) {'],
    ['t4-rw-2', 'for (let i = 0; i < nums.length; ++i)'],
    ['t5-rw-1', 'low = 1 + mid'],
    ['t5-rw-2', 'while (low <= high)'],
    ['t5-rw-2', 'while (high >= low)'],
    ['t5-rw-3', 'return power(base, exp - 1) * base'],
  ])('%s accepts %j', (id, typed) => {
    expect(isCorrect(rw(id), typed)).toBe(true);
  });

  it('accepts an alternative fix inside the whole rewritten function too', () => {
    const q = rw('t4-rw-1');
    const typed = q.code!.replace(
      '        items[left] = items[right]\n        items[right] = items[left]',
      '        temp = items[left]\n        items[left] = items[right]\n        items[right] = temp',
    );
    expect(isCorrect(q, typed)).toBe(true);
  });

  it.each([
    ['t4-rw-2', 'for (let i = 1; i < nums.length; i++)'],
    ['t5-rw-2', 'while (low < high)'],
    ['t5-rw-2', 'while (low <= high) }'],
    ['t5-rw-1', 'low = mid'],
    ['t5-rw-1', 'low = mid - 1'],
    ['t4-rw-1', 'items[left] = items[right]'],
    ['t3-rw-1', 'best = 0'],
  ])('%s still rejects the wrong fix %j', (id, typed) => {
    expect(isCorrect(rw(id), typed)).toBe(false);
  });

  it('only treats quotes as equal outside SQL', () => {
    expect(codeTokens("x = 'a'")).toEqual(codeTokens('x = "a"'));
    expect(codeTokens("x = 'a'", true)).not.toEqual(codeTokens('x = "a"', true));
  });

  it('no accepted answer already appears in the buggy code, so nothing is a free win', () => {
    for (const q of rewrites()) {
      const ci = q.concept.startsWith('sql');
      const buggy = ` ${codeTokens(q.code!, ci).join(' ')} `;
      for (const a of q.acceptedAnswers) {
        expect(buggy.includes(` ${codeTokens(a, ci).join(' ')} `), `${q.id}: ${a}`).toBe(false);
      }
    }
  });
});

describe('two-word SQL keywords', () => {
  const bank = () => new Map(loadBank().map((q) => [q.id, q]));
  it.each([
    ['t3-sql-2', 'GROUP'],
    ['t3-sql-2', 'group by'],
    ['t2-sql-1', 'ORDER'],
    ['t2-sql-1', 'Order By'],
    ['t4-sql-1', 'INNER'],
    ['t4-sql-1', 'inner join'],
  ])('%s accepts %j', (id, typed) => {
    expect(isCorrect(bank().get(id)!, typed)).toBe(true);
  });
  it('still rejects the wrong keyword', () => {
    expect(isCorrect(bank().get('t3-sql-2')!, 'ORDER BY')).toBe(false);
    expect(isCorrect(bank().get('t4-sql-1')!, 'LEFT JOIN')).toBe(false);
  });
});

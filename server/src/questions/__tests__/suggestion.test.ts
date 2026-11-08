import { describe, expect, it } from 'vitest';
import type { Question } from '@beatcode/shared';
import { isCorrect } from '../answerMatching';
import { checkAnswer, editDistance, suggestAnswer } from '../suggestion';
import { loadBank } from '../schema';

const make = (over: Partial<Question>): Question => ({
  id: 'x',
  type: 'name_concept',
  difficulty: 1,
  concept: 'variables',
  prompt: 'p',
  acceptedAnswers: ['string', 'str'],
  explanation: 'e',
  ...over,
});

describe('editDistance', () => {
  it('counts insert, delete, substitute and adjacent swap as one edit', () => {
    expect(editDistance('string', 'string')).toBe(0);
    expect(editDistance('strig', 'string')).toBe(1);
    expect(editDistance('strinng', 'string')).toBe(1);
    expect(editDistance('strang', 'string')).toBe(1);
    expect(editDistance('stirng', 'string')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
  });
});

describe('suggestAnswer', () => {
  const q = make({});

  it('suggests the intended answer for the example typo', () => {
    expect(suggestAnswer(q, 'strig')).toBe('string');
    expect(checkAnswer(q, 'strig')).toEqual({ status: 'suggest', suggestion: 'string' });
  });
  it('handles missing, extra, wrong and swapped letters, any case, extra spaces', () => {
    for (const typo of ['sting', 'strinng', 'strang', 'stirng', 'STRIG', '  strig ']) {
      expect(suggestAnswer(q, typo), typo).toBe('string');
    }
  });
  it('returns the original accepted text, not the normalized one', () => {
    expect(
      suggestAnswer(make({ acceptedAnswers: ['Atomicity'], options: undefined }), 'atomicty'),
    ).toBe('Atomicity');
  });
  it('does not suggest for correct answers', () => {
    expect(suggestAnswer(q, 'string')).toBeNull();
    expect(checkAnswer(q, 'STR')).toEqual({ status: 'correct' });
  });
  it('does not suggest for unrelated, empty or oversized input', () => {
    for (const s of ['banana', 'queue', '', '   ', 'x'.repeat(600)])
      expect(suggestAnswer(q, s), s).toBeNull();
    expect(checkAnswer(q, 'banana')).toEqual({ status: 'wrong' });
  });
  it('forgives more edits for longer answers', () => {
    const long = make({ acceptedAnswers: ['structured query language'] });
    expect(suggestAnswer(long, 'structured querry langauge')).toBe('structured query language');
    const mid = make({ acceptedAnswers: ['immutable'] });
    expect(suggestAnswer(mid, 'imutible')).toBe('immutable'); // 2 edits on a 9-letter word
    const short = make({ acceptedAnswers: ['break'] });
    expect(suggestAnswer(short, 'brk')).toBeNull(); // 2 edits on a 5-letter word is too far
  });
  it('only forgives a swap on 3-letter answers', () => {
    const q3 = make({ acceptedAnswers: ['int'] });
    expect(suggestAnswer(q3, 'itn')).toBe('int');
    expect(suggestAnswer(q3, 'ibt')).toBeNull();
    expect(suggestAnswer(q3, 'in')).toBeNull();
  });
  it('picks the closest of several accepted answers', () => {
    const q2 = make({ acceptedAnswers: ['index', 'indexes', 'indices'] });
    expect(suggestAnswer(q2, 'indexs')).toBe('index');
    expect(suggestAnswer(q2, 'indicez')).toBe('indices');
  });
  it('never suggests for numbers, symbols, options or spot_the_bug', () => {
    expect(
      suggestAnswer(make({ type: 'output_prediction', code: 'x', acceptedAnswers: ['12'] }), '13'),
    ).toBeNull();
    expect(
      suggestAnswer(make({ type: 'fill_blank', code: '___', acceptedAnswers: ['=='] }), '='),
    ).toBeNull();
    expect(
      suggestAnswer(make({ options: ['string', 'number'], acceptedAnswers: ['string'] }), 'strig'),
    ).toBeNull();
    expect(
      suggestAnswer(make({ type: 'spot_the_bug', code: 'a\nb', acceptedAnswers: ['2'] }), 'line 3'),
    ).toBeNull();
  });
  it('treats a case slip as a typo for case-sensitive output questions', () => {
    const out = make({ type: 'output_prediction', code: 'print(f())', acceptedAnswers: ['None'] });
    expect(checkAnswer(out, 'none')).toEqual({ status: 'suggest', suggestion: 'None' });
  });
});

describe('suggestions over the real bank', () => {
  const typosOf = (word: string): string[] => {
    const mid = Math.floor(word.length / 2);
    const out = [
      word.slice(0, mid) + word.slice(mid + 1), // missing letter
      word.slice(0, mid) + 'q' + word.slice(mid), // extra letter
      word.slice(0, mid) + (word[mid] === 'z' ? 'y' : 'z') + word.slice(mid + 1), // wrong letter
    ];
    if (word[mid] !== word[mid + 1]) {
      out.push(word.slice(0, mid) + word[mid + 1] + word[mid] + word.slice(mid + 2)); // swapped letters
    }
    return out;
  };

  it('a suggestion, when given, is always a correct answer', () => {
    for (const question of loadBank()) {
      for (const answer of question.acceptedAnswers) {
        for (const typo of typosOf(answer)) {
          const s = suggestAnswer(question, typo);
          if (s !== null)
            expect(isCorrect(question, s), `${question.id} ${typo} -> ${s}`).toBe(true);
        }
      }
    }
  });

  it('every one-letter slip on a word answer of 4+ letters gets a suggestion', () => {
    let checked = 0;
    for (const question of loadBank()) {
      if (question.options || question.type === 'spot_the_bug') continue;
      for (const answer of question.acceptedAnswers) {
        const word = question.type === 'output_prediction' ? answer : answer.toLowerCase();
        if (!/^[a-zA-Z ]{4,}$/.test(word)) continue;
        for (const typo of typosOf(word)) {
          if (isCorrect(question, typo)) continue;
          checked++;
          const s = suggestAnswer(question, typo);
          expect(s, `${question.id}: "${typo}" for "${answer}"`).not.toBeNull();
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('never suggests anything for obvious nonsense', () => {
    for (const question of loadBank()) {
      for (const junk of ['banana', 'zzzzzz', 'asdf qwer', '999']) {
        expect(suggestAnswer(question, junk), `${question.id} ${junk}`).toBeNull();
      }
    }
  });
});

// OWNER C: "Did you mean ...?" typo suggestions.
// Responsible for: spotting a near-miss answer ("strig" for "string") and returning the intended answer
//   WITHOUT scoring it. The player confirms by submitting the suggestion (Enter) or retypes something else.
// Others expect:
//   - OWNER A: call checkAnswer(question, submitted) instead of isCorrect on answer:submit.
//       'correct' -> score it.  'wrong' -> wrong answer.
//       'suggest' -> do NOT penalise (no lockout, no combo reset, no damage), send the suggestion to that
//       player only, and keep the round open. Stop suggesting after MAX_SUGGESTIONS_PER_QUESTION.
//   - OWNER B: show "Did you mean: <suggestion>", put it in the input, and submit it on Enter.
//   The suggestion always comes from acceptedAnswers, so submitting it is guaranteed to be correct.
//   NOTE: this needs a new server->client socket event, which is a shared/ contract change (all 3 owners).
import type { Question } from '@beatcode/shared';
import { isCorrect, normalizeLoose, normalizeOutput } from './answerMatching';
import { editDistance } from './editDistance';

export { editDistance };

/** After this many suggestions for one question, judge normally (stops answer-probing). */
export const MAX_SUGGESTIONS_PER_QUESTION = 3;

export type AnswerCheck =
  { status: 'correct' } | { status: 'suggest'; suggestion: string } | { status: 'wrong' };

/** How many edits we forgive, by the length of the correct answer. */
function allowedEdits(len: number): number {
  if (len >= 16) return 3;
  if (len >= 8) return 2;
  if (len >= 4) return 1;
  return 0; // 3-letter answers only forgive a swap (see below)
}

/** Only word-like answers get suggestions: not numbers, symbols or code like "O(n^2)". */
function isWordLike(s: string): boolean {
  const letters = (s.match(/[a-z]/gi) ?? []).length;
  return s.length >= 3 && letters >= 3 && letters / s.length >= 0.7;
}

/**
 * If `submitted` is a near-miss of an accepted answer, return that accepted answer; otherwise null.
 * Never suggests for correct answers, option (click) questions, spot_the_bug or rewrite_code
 * (rewrite_code forgives small spelling slips when grading instead; see answerMatching).
 */
export function suggestAnswer(question: Question, submitted: string): string | null {
  if (typeof submitted !== 'string' || submitted.trim() === '' || submitted.length > 500)
    return null;
  if (question.options || question.type === 'spot_the_bug' || question.type === 'rewrite_code')
    return null;
  if (isCorrect(question, submitted)) return null;

  // output_prediction is case-sensitive, so "none" vs "None" counts as a typo there.
  const norm = question.type === 'output_prediction' ? normalizeOutput : normalizeLoose;
  const typed = norm(submitted);
  if (typed.includes('\n')) return null;

  let best: { answer: string; dist: number } | null = null;
  for (const answer of question.acceptedAnswers) {
    const target = norm(answer);
    if (!isWordLike(target)) continue;
    const dist = editDistance(typed, target);
    // 3-letter answers: only accept a single swap of neighbouring letters ("itn" -> "int")
    const ok =
      target.length === 3
        ? dist === 1 &&
          typed.length === 3 &&
          [...typed].sort().join('') === [...target].sort().join('')
        : dist <= allowedEdits(target.length);
    if (ok && (best === null || dist < best.dist)) best = { answer, dist };
  }
  return best ? best.answer : null;
}

/** correct / suggest / wrong, in one call. */
export function checkAnswer(question: Question, submitted: string): AnswerCheck {
  if (isCorrect(question, submitted)) return { status: 'correct' };
  const suggestion = suggestAnswer(question, submitted);
  return suggestion === null ? { status: 'wrong' } : { status: 'suggest', suggestion };
}

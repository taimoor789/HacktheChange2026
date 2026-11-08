// OWNER C: "Did you mean ...?" typo suggestions.
// Responsible for: spotting a near-miss answer ("strig" for "string") and returning the intended answer.
//   A suggestion is a HINT ONLY. It never makes an answer count as correct: isCorrect("strig") is false.
//   The player confirms by submitting the full suggestion (Enter), which isCorrect then judges as normal.
// Agreed with OWNER A (the engine):
//   - Call checkAnswer(question, submitted, hintsUsed) on submit. 'correct' -> score it (exactly when isCorrect is
//     true). 'wrong' -> normal wrong answer. 'suggest' -> NOT a submission: no lockout, no combo reset, no damage,
//     the timer keeps running, answerMs is measured at the confirmed submission.
//   - Send the suggestion to that player only, via the socket event answer:hint { matchId, round, suggestion}.
//     (A proposes that event in a shared/ PR; B must agree. It is NOT added to shared/ by this module.)
//   - 1 hint per player per question (MAX_SUGGESTIONS_PER_QUESTION). Pass hintsUsed; at the cap you get 'wrong'.
//   - Typed single-line question types only: never 'suggest' for rewrite_code, spot_the_bug or option questions.
//   - OWNER B: show "Did you mean: <suggestion>", put it in the input, and submit it on Enter.
//   The suggestion always comes from acceptedAnswers, so submitting it is guaranteed to be correct.
import type { Question } from '@beatcode/shared';
import { isCorrect, normalizeLoose, normalizeOutput } from './answerMatching';
import { editDistance } from './editDistance';

export { editDistance };

/**
 * Hints per player per question. A hint reveals the answer, so one is the cap: after that, a near-miss is an
 * ordinary wrong answer (stops answer-probing). The caller counts hints and passes `hintsUsed` to checkAnswer.
 */
export const MAX_SUGGESTIONS_PER_QUESTION = 1;

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

/**
 * correct / suggest / wrong, in one call.
 * 'correct' exactly when isCorrect is true. `hintsUsed` = hints already given to THIS player for THIS question;
 * once it reaches MAX_SUGGESTIONS_PER_QUESTION a near-miss is plain 'wrong'. Never 'suggest' for rewrite_code.
 */
export function checkAnswer(question: Question, submitted: string, hintsUsed = 0): AnswerCheck {
  if (isCorrect(question, submitted)) return { status: 'correct' };
  if (hintsUsed >= MAX_SUGGESTIONS_PER_QUESTION) return { status: 'wrong' };
  const suggestion = suggestAnswer(question, submitted);
  return suggestion === null ? { status: 'wrong' } : { status: 'suggest', suggestion };
}

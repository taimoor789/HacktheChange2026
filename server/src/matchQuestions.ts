// OWNER A: the only file that imports server/src/questions/.
// Working tree calls:
//   getNextQuestion({ tier, usedIds }, rng), toPublicQuestion(q),
//   isCorrect(q, submitted), getTimerSeconds(tier) in seconds.
// Owner C's branch (not merged here) adds optional recentIds, getQuestionSeconds(question),
// and completeQuestion. Switch those on in this file only, when they land.
import type { PublicQuestion, Question } from '@beatcode/shared';
import { isCorrect } from './questions/answerMatching';
import { getTimerSeconds } from './questions/ladder';
import { loadBank } from './questions/schema';
import { getNextQuestion, toPublicQuestion } from './questions/selector';

let bankCache: Question[] | undefined;

function bank(): Question[] {
  bankCache ??= loadBank();
  return bankCache;
}

/** One shared question for the round, chosen at the match tier. */
export function nextQuestion(tier: number, usedIds: string[], rng: () => number = Math.random): Question {
  return getNextQuestion({ tier, usedIds }, rng);
}

/** What a player is allowed to see. No accepted answers, no explanation. */
export function publicQuestion(question: Question): PublicQuestion {
  return toPublicQuestion(question);
}

export function answerIsCorrect(question: Question, submitted: string): boolean {
  return isCorrect(question, submitted);
}

/** Round length in milliseconds, from the tier timer table. */
export function roundDurationMs(matchTier: number): number {
  return getTimerSeconds(matchTier) * 1000;
}

/**
 * A known-good answer for scripted players and tests.
 * The match never sends this to a player; callers look it up themselves by id.
 */
export function correctAnswerFor(questionId: string): string | null {
  const question = bank().find((item) => item.id === questionId);
  return question?.acceptedAnswers[0] ?? null;
}

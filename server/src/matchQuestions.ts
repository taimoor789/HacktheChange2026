// OWNER A: the only file that imports server/src/questions/.
// Uses getNextQuestion, toPublicQuestion, isCorrect, and getQuestionSeconds.
// isCorrect is the only judge and returns a boolean. checkAnswer suggestions are not scored.
// Tier progression stays in the engine (ROUNDS_PER_TIER). Do not call completeQuestion.
import type { PublicQuestion, Question, QuestionType } from '@beatcode/shared';
import { isCorrect } from './questions/answerMatching';
import { getQuestionSeconds } from './questions/ladder';
import { loadBank } from './questions/schema';
import { getNextQuestion, toPublicQuestion } from './questions/selector';

let bankCache: Question[] | undefined;

function bank(): Question[] {
  bankCache ??= loadBank();
  return bankCache;
}

/** One shared question for the round, chosen at the match tier. */
export function nextQuestion(
  tier: number,
  usedIds: string[],
  rng: () => number = Math.random,
  recentIds: string[] = [],
  preferredType?: QuestionType,
): Question {
  return getNextQuestion({ tier, usedIds, recentIds, preferredType }, rng);
}

/** What a player is allowed to see. No accepted answers, no explanation. */
export function publicQuestion(question: Question): PublicQuestion {
  return toPublicQuestion(question);
}

export function answerIsCorrect(question: Question, submitted: string): boolean {
  return isCorrect(question, submitted);
}

/** Round length in milliseconds. Long questions keep their own `seconds` floor. */
export function roundDurationMs(question: Question): number {
  return getQuestionSeconds(question) * 1000;
}

/**
 * A known-good answer for scripted players and tests.
 * The match never sends this to a player; callers look it up themselves by id.
 */
export function correctAnswerFor(questionId: string): string | null {
  const question = bank().find((item) => item.id === questionId);
  return question?.acceptedAnswers[0] ?? null;
}

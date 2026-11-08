// OWNER C: question selector.
// Responsible for: picking the next question by tier/type without repeats, and the public view.
// Others expect: A calls getNextQuestion({tier, usedIds}) and sends toPublicQuestion(q) to clients.
import type { PublicQuestion, Question, QuestionType } from '@beatcode/shared';
import tier1 from './bank/tier1.json';

export interface NextQuestionArgs {
  tier: number;
  usedIds: string[];
  preferredType?: QuestionType;
}

export function getNextQuestion(_args: NextQuestionArgs): Question {
  // TODO(OWNER C): load full bank, random unused pick at tier, fall back to nearest tier.
  return (tier1 as Question[])[0];
}

/** Strip acceptedAnswers and explanation. The ONLY thing sent to clients during a round. */
export function toPublicQuestion(q: Question): PublicQuestion {
  const { acceptedAnswers: _a, explanation: _e, ...pub } = q;
  return pub;
}

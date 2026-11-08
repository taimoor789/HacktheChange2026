// OWNER C: answer matching per question type.
// Responsible for: deciding whether a submitted answer is correct.
// Others expect: A calls isCorrect(question, submitted) server-side only.
import type { Question } from '@beatcode/shared';

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function isCorrect(question: Question, submitted: string): boolean {
  // TODO(OWNER C): per-type rules (output_prediction line handling, option index, spot_the_bug line number).
  const s = normalize(submitted);
  return question.acceptedAnswers.some((a) => normalize(a) === s);
}

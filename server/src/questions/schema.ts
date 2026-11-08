// OWNER C: runtime validation of the Question type + bank loading.
// Responsible for: catching malformed questions before they reach a match.
// Others expect: nothing directly; A only calls the selector.
import type { Question, QuestionType } from '@beatcode/shared';

const TYPES: QuestionType[] = ['fill_blank', 'name_concept', 'output_prediction', 'spot_the_bug'];

export function validateQuestion(obj: unknown): { ok: true; value: Question } | { ok: false; errors: string[] } {
  // TODO(OWNER C): full validation (tier range, concept in ladder, options, non-empty answers).
  const q = obj as Partial<Question>;
  const errors: string[] = [];
  if (!q || typeof q.id !== 'string') errors.push('id must be a string');
  if (!q || !TYPES.includes(q.type as QuestionType)) errors.push('invalid type');
  return errors.length ? { ok: false, errors } : { ok: true, value: q as Question };
}

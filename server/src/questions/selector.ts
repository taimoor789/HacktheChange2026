// OWNER C: question selector.
// Responsible for: picking the next question by tier/type without repeats, and the public view.
// Others expect: A calls getNextQuestion({tier, usedIds}) and sends toPublicQuestion(q) to clients.
//   Both players get the SAME question each round, so A calls this once per round, not once per player.
import type { PublicQuestion, Question, QuestionType } from '@beatcode/shared';
import { clampTier, MAX_TIER } from './ladder';
import { loadBank } from './schema';

export interface NextQuestionArgs {
  tier: number;
  usedIds: string[];
  preferredType?: QuestionType;
}

/** Tiers to try, nearest first, preferring lower tiers on a tie: t, t-1, t+1, t-2, t+2, ... */
export function tierSearchOrder(tier: number): number[] {
  const t = clampTier(tier);
  const order = [t];
  for (let d = 1; d < MAX_TIER; d++) {
    if (t - d >= 1) order.push(t - d);
    if (t + d <= MAX_TIER) order.push(t + d);
  }
  return order;
}

function pick(pool: Question[], preferredType: QuestionType | undefined, rng: () => number): Question {
  const preferred = preferredType ? pool.filter((q) => q.type === preferredType) : [];
  const from = preferred.length ? preferred : pool;
  return from[Math.floor(rng() * from.length)];
}

/**
 * Random unused question at `tier` (restricted to `preferredType` if any such question is left).
 * If the tier has no unused questions, falls back to the nearest tier (lower first).
 * If the whole bank is used up, repeats a question rather than failing mid-match.
 * `rng` and `bank` are injectable for tests.
 */
export function getNextQuestion(
  { tier, usedIds, preferredType }: NextQuestionArgs,
  rng: () => number = Math.random,
  bank: Question[] = loadBank(),
): Question {
  if (bank.length === 0) throw new Error('Question bank is empty');
  const used = new Set(usedIds);
  const order = tierSearchOrder(tier);

  for (const t of order) {
    const pool = bank.filter((q) => q.difficulty === t && !used.has(q.id));
    if (pool.length) return pick(pool, preferredType, rng);
  }
  // Bank exhausted: allow repeats, nearest tier first.
  for (const t of order) {
    const pool = bank.filter((q) => q.difficulty === t);
    if (pool.length) return pick(pool, preferredType, rng);
  }
  return bank[Math.floor(rng() * bank.length)];
}

/** Strip acceptedAnswers and explanation. The ONLY thing sent to clients during a round. */
export function toPublicQuestion(q: Question): PublicQuestion {
  const { acceptedAnswers: _a, explanation: _e, ...pub } = q;
  return pub;
}

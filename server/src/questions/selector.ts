// OWNER C: question selector.
// Responsible for: picking the next question by tier/type without repeats, and the public view.
// Others expect: A calls getNextQuestion({tier, usedIds}) and sends toPublicQuestion(q) to clients.
//   Both players get the SAME question each round, so A calls this once per round, not once per player.
import type { PublicQuestion, Question, QuestionType } from '@beatcode/shared';
import { clampTier, MAX_TIER } from './ladder';
import { loadBank } from './schema';

export interface NextQuestionArgs {
  tier: number;
  /** Questions already asked in this match. Never asked again (unless the whole bank is used up). */
  usedIds: string[];
  /** Only pick this type if one is available. */
  preferredType?: QuestionType;
  /**
   * Questions the players saw recently (e.g. their previous match). Avoided when other questions are
   * available, otherwise ignored. Keeps back-to-back matches from feeling repetitive.
   */
  recentIds?: string[];
}

/**
 * Relative odds of each question TYPE within a tier. TUNABLE.
 * We pick the type first and then a random question of that type, so a type with many questions
 * (e.g. output_prediction) does not crowd out one with few (e.g. rewrite_code).
 * Types missing from a tier are skipped automatically.
 */
export const TYPE_WEIGHTS: Record<QuestionType, number> = {
  fill_blank: 1,
  name_concept: 1,
  output_prediction: 1,
  spot_the_bug: 1,
  rewrite_code: 1.5, // long and rare in the bank, so give it a little extra weight
};

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

interface PickOptions {
  preferredType?: QuestionType;
  lastType?: QuestionType;
  recent: Set<string>;
  rng: () => number;
}

/** Narrow `pool` to `keep` only if that leaves something. */
function narrow(pool: Question[], keep: (q: Question) => boolean): Question[] {
  const kept = pool.filter(keep);
  return kept.length ? kept : pool;
}

function pick(pool: Question[], { preferredType, lastType, recent, rng }: PickOptions): Question {
  let from = pool;
  if (preferredType) from = narrow(from, (q) => q.type === preferredType);
  from = narrow(from, (q) => !recent.has(q.id));

  // group by type, skip the type we just asked if anything else is available
  const groups = new Map<QuestionType, Question[]>();
  for (const q of from) groups.set(q.type, [...(groups.get(q.type) ?? []), q]);
  if (groups.size > 1 && lastType) groups.delete(lastType);

  // weighted random type, then uniform random question of that type
  const entries = [...groups.entries()];
  const weightOf = (type: QuestionType) => TYPE_WEIGHTS[type] ?? 1;
  const total = entries.reduce((sum, [type]) => sum + weightOf(type), 0);
  let r = rng() * total;
  let chosen = entries[entries.length - 1][1];
  for (const [type, questions] of entries) {
    r -= weightOf(type);
    if (r < 0) {
      chosen = questions;
      break;
    }
  }
  return chosen[Math.floor(rng() * chosen.length)];
}

/**
 * Random unused question at `tier`, with type-balanced odds (see TYPE_WEIGHTS), preferring questions not in
 * `recentIds` and a different type from the previous question.
 * If the tier has no unused questions, falls back to the nearest tier (lower first).
 * If the whole bank is used up, repeats a question rather than failing mid-match.
 * `rng` and `bank` are injectable for tests.
 */
export function getNextQuestion(
  { tier, usedIds, preferredType, recentIds = [] }: NextQuestionArgs,
  rng: () => number = Math.random,
  bank: Question[] = loadBank(),
): Question {
  if (bank.length === 0) throw new Error('Question bank is empty');
  const used = new Set(usedIds);
  const lastId = usedIds[usedIds.length - 1];
  const lastType = lastId === undefined ? undefined : bank.find((q) => q.id === lastId)?.type;
  const opts: PickOptions = { preferredType, lastType, recent: new Set(recentIds), rng };
  const order = tierSearchOrder(tier);

  for (const t of order) {
    const pool = bank.filter((q) => q.difficulty === t && !used.has(q.id));
    if (pool.length) return pick(pool, opts);
  }
  // Bank exhausted: allow repeats, nearest tier first.
  for (const t of order) {
    const pool = bank.filter((q) => q.difficulty === t);
    if (pool.length) return pick(pool, opts);
  }
  return bank[Math.floor(rng() * bank.length)];
}

/** Strip acceptedAnswers and explanation. The ONLY thing sent to clients during a round. */
export function toPublicQuestion(q: Question): PublicQuestion {
  const pub: Partial<Question> = { ...q };
  delete pub.acceptedAnswers;
  delete pub.explanation;
  return pub as PublicQuestion;
}

import { describe, expect, it } from 'vitest';
import { MAX_TIER, QUESTIONS_PER_TIER } from '@beatcode/shared';
import { getNextQuestion, toPublicQuestion } from '../selector';
import { isCorrect } from '../answerMatching';
import { completeQuestion, getQuestionSeconds, getTimerSeconds } from '../ladder';
import { loadBank } from '../schema';

/** Plays a full ladder the way Owner A's server will: one question at a time, shared by both players. */
function playMatch(questions: number, rng: () => number, recentIds: string[] = []) {
  const usedIds: string[] = [];
  let progress = { tier: 1, askedInTier: 0 };
  const log: { id: string; tier: number; timer: number }[] = [];
  for (let n = 1; n <= questions; n++) {
    const q = getNextQuestion({ tier: progress.tier, usedIds, recentIds }, rng);
    const pub = toPublicQuestion(q);
    // what travels over the socket must survive JSON and carry no answers
    const wire = JSON.parse(JSON.stringify(pub));
    expect(wire).not.toHaveProperty('acceptedAnswers');
    expect(wire).not.toHaveProperty('explanation');
    // a correct answer is accepted, a junk answer is not
    expect(isCorrect(q, q.acceptedAnswers[0])).toBe(true);
    expect(isCorrect(q, '???')).toBe(false);
    usedIds.push(q.id);
    log.push({ id: q.id, tier: progress.tier, timer: getQuestionSeconds(q) });
    const next = completeQuestion(progress);
    progress = { tier: next.tier, askedInTier: next.askedInTier };
  }
  return { usedIds, log };
}

const FULL_LADDER = QUESTIONS_PER_TIER * MAX_TIER;

describe('simulated matches', () => {
  it('asks exactly 2 questions per tier, in order, from tier 1 to tier 6', () => {
    for (let i = 0; i < 50; i++) {
      const { log } = playMatch(FULL_LADDER, Math.random);
      expect(log.map((l) => l.tier)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    }
  });

  it('shrinks the normal timer as tiers climb and never repeats a question', () => {
    const { usedIds, log } = playMatch(FULL_LADDER, Math.random);
    expect(new Set(usedIds).size).toBe(usedIds.length);
    expect(getTimerSeconds(1)).toBeGreaterThan(getTimerSeconds(6));
    expect(log[0].timer).toBeGreaterThanOrEqual(getTimerSeconds(1));
  });

  it('survives 500 random matches without throwing or repeating a question', () => {
    for (let i = 0; i < 500; i++) {
      const { usedIds } = playMatch(FULL_LADDER, Math.random);
      expect(new Set(usedIds).size).toBe(usedIds.length);
    }
  });

  it('keeps going past the top tier (sudden death) without crashing or repeating', () => {
    const { usedIds, log } = playMatch(FULL_LADDER + 6, Math.random);
    expect(new Set(usedIds).size).toBe(usedIds.length);
    expect(log.slice(FULL_LADDER).every((l) => l.tier === MAX_TIER)).toBe(true);
  });

  it('survives going past the size of the whole bank (repeats allowed, no crash)', () => {
    const total = loadBank().length;
    expect(() => playMatch(total + 15, Math.random)).not.toThrow();
  });
});

describe('completeQuestion (tier progression)', () => {
  it('moves up after QUESTIONS_PER_TIER questions, counted per tier', () => {
    let p = { tier: 1, askedInTier: 0 };
    const seen: number[] = [];
    for (let i = 0; i < FULL_LADDER; i++) {
      seen.push(p.tier);
      const next = completeQuestion(p);
      expect(next.finished).toBe(i === FULL_LADDER - 1);
      p = { tier: next.tier, askedInTier: next.askedInTier };
    }
    expect(seen).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
  it('works when starting mid-ladder and stays at the top tier when finished', () => {
    expect(completeQuestion({ tier: 4, askedInTier: 0 })).toEqual({
      tier: 4,
      askedInTier: 1,
      finished: false,
    });
    expect(completeQuestion({ tier: 4, askedInTier: 1 })).toEqual({
      tier: 5,
      askedInTier: 0,
      finished: false,
    });
    expect(completeQuestion({ tier: 6, askedInTier: 1 }).finished).toBe(true);
    expect(completeQuestion({ tier: 6, askedInTier: 1 }).tier).toBe(6);
  });
});

describe('odds across many runs', () => {
  const N = 1500;
  const bank = loadBank();
  const byId = new Map(bank.map((q) => [q.id, q]));
  const runs: string[][] = [];
  let recent: string[] = [];
  for (let i = 0; i < N; i++) {
    const { usedIds } = playMatch(FULL_LADDER, Math.random, recent);
    runs.push(usedIds);
    recent = usedIds;
  }

  it('shows a long (rewrite_code) question in most runs, and every type is well represented', () => {
    const withHeavy = runs.filter((r) =>
      r.some((id) => byId.get(id)!.type === 'rewrite_code'),
    ).length;
    expect(withHeavy / N).toBeGreaterThan(0.85);
    const share: Record<string, number> = {};
    for (const r of runs)
      for (const id of r) share[byId.get(id)!.type] = (share[byId.get(id)!.type] ?? 0) + 1;
    for (const type of ['fill_blank', 'name_concept', 'output_prediction', 'spot_the_bug']) {
      expect(share[type] / (N * FULL_LADDER), type).toBeGreaterThan(0.12);
    }
    expect(share['output_prediction'] / (N * FULL_LADDER)).toBeLessThan(0.3);
  });

  it('almost never repeats a question from the previous run, and rarely repeats a type back-to-back', () => {
    let repeats = 0;
    let backToBack = 0;
    for (let i = 1; i < runs.length; i++) {
      repeats += runs[i].filter((id) => runs[i - 1].includes(id)).length;
      for (let j = 1; j < runs[i].length; j++) {
        if (byId.get(runs[i][j])!.type === byId.get(runs[i][j - 1])!.type) backToBack++;
      }
    }
    expect(repeats / N).toBeLessThan(0.05);
    expect(backToBack / N).toBeLessThan(0.5);
  });

  it('every question in the bank can come up', () => {
    const seen = new Set(runs.flat());
    expect(seen.size).toBe(bank.length);
  });
});

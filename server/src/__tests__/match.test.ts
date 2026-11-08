import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS } from '@beatcode/shared';
import { Match, type Clock, type MatchOutcome, type MatchPlayer, type PlayerTurn } from '../match';
import { correctAnswerFor } from '../matchQuestions';

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scripted(id: string, accuracy: number, fast: number, slow: number, rng: () => number): MatchPlayer {
  return {
    id,
    respond(question, durationMs) {
      const correct = rng() < accuracy;
      const span = slow - fast;
      const answerMs = Math.floor(durationMs * (fast + rng() * span));
      const answer = correct ? correctAnswerFor(question.id) : '___wrong___';
      return { answer, answerMs };
    },
  };
}

function fixed(id: string, answerMs: number, correct: boolean): MatchPlayer {
  return {
    id,
    respond(question) {
      return { answer: correct ? correctAnswerFor(question.id) : '___wrong___', answerMs };
    },
  };
}

function fingerprint(outcome: MatchOutcome) {
  return {
    winnerId: outcome.winnerId,
    reason: outcome.reason,
    rounds: outcome.history.map((round) => ({
      id: round.question.id,
      tier: round.matchTier,
      hp: round.result.players.map((player) => player.hp),
      hitter: round.result.hitterId,
      answers: round.answers.map((answer) => answer.status),
    })),
  };
}

describe('Match', () => {
  it('always ends, either when HP hits 0 or at MAX_ROUNDS', async () => {
    const knockedOut = await new Match({
      rng: () => 0,
      players: [fixed('a', 200, true), fixed('b', 800, true)],
    }).play();
    expect(knockedOut.reason).toBe('hp_zero');
    expect(knockedOut.roundCount).toBeLessThanOrEqual(MAX_ROUNDS);
    expect(knockedOut.players.some((player) => player.hp === 0)).toBe(true);

    const stalled = await new Match({
      rng: () => 0,
      players: [fixed('a', 1000, false), fixed('b', 2000, false)],
    }).play();
    expect(stalled.reason).toBe('max_rounds');
    expect(stalled.roundCount).toBe(MAX_ROUNDS);
    expect(stalled.players.every((player) => player.hp > 0)).toBe(true);
  });

  it('raises the tier as rounds with a correct answer add up', async () => {
    const outcome = await new Match({
      rng: () => 0,
      players: [fixed('a', 500, true), fixed('b', 1500, false)],
    }).play();

    expect(outcome.history[0]?.matchTier).toBe(1);
    expect(outcome.history[0]?.result.nextTier).toBe(1);
    expect(outcome.history[1]?.result.roundsWithCorrect).toBe(2);
    expect(outcome.history[1]?.result.nextTier).toBe(2);
    expect(outcome.history[2]?.matchTier).toBe(2);
  });

  it('plays the same match from the same seed', async () => {
    const play = () => {
      const rng = mulberry32(2026);
      return new Match({
        rng,
        players: [scripted('p1', 0.7, 0.08, 0.35, rng), scripted('p2', 0.5, 0.45, 0.9, rng)],
      }).play();
    };
    const first = fingerprint(await play());
    const second = fingerprint(await play());
    expect(second).toEqual(first);
    expect(first.rounds.length).toBeGreaterThan(0);
  });

  it('never gives a player acceptedAnswers or explanation', async () => {
    const seen: unknown[] = [];
    const watch = (id: string): MatchPlayer => ({
      id,
      respond(question, durationMs): PlayerTurn {
        seen.push(question);
        expect(question).not.toHaveProperty('acceptedAnswers');
        expect(question).not.toHaveProperty('explanation');
        expect(durationMs).toBeGreaterThan(0);
        return { answer: '___wrong___', answerMs: 1000 };
      },
    });

    const outcome = await new Match({ rng: () => 0, players: [watch('a'), watch('b')] }).play();
    expect(seen.length).toBe(outcome.roundCount * 2);
    for (const round of outcome.history) {
      expect(round.shown).not.toHaveProperty('acceptedAnswers');
      expect(round.shown).not.toHaveProperty('explanation');
      expect(round.question.acceptedAnswers.length).toBeGreaterThan(0);
    }
  });

  it('keeps one history entry per round', async () => {
    const clock: Clock = { now: () => 0 };
    const outcome = await new Match({
      rng: () => 0,
      clock,
      players: [fixed('a', 1000, false), fixed('b', 2000, false)],
    }).play();

    expect(outcome.history).toHaveLength(outcome.roundCount);
    expect(outcome.history.map((round) => round.roundNumber)).toEqual(
      outcome.history.map((_, index) => index + 1),
    );
    expect(outcome.history.every((round) => round.startedAtMs === 0)).toBe(true);
    expect(new Set(outcome.history.map((round) => round.question.id)).size).toBe(outcome.history.length);
  });
});

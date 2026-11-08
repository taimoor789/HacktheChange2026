import { describe, expect, it } from 'vitest';
import { MAX_ROUNDS, MAX_TIER, MISS_DAMAGE, ROUNDS_PER_TIER } from '@beatcode/shared';
import { calculateHitDamage, chargeFromStreak, ultimateDamage } from '../battleRules';
import {
  resolveRound,
  type AnswerStatus,
  type ResolveRoundInput,
  type RoundPlayerInput,
} from '../resolveRound';

const DURATION = 10_000;

function player(
  id: string,
  hp: number,
  combo: number,
  status: AnswerStatus,
  answerMs: number | null,
): RoundPlayerInput {
  return { id, hp, combo, answer: { status, answerMs } };
}

function round(partial: Partial<ResolveRoundInput> & Pick<ResolveRoundInput, 'players'>): ResolveRoundInput {
  return {
    questionType: 'spot_the_bug',
    questionTier: 1,
    roundNumber: 1,
    roundDurationMs: DURATION,
    matchTier: 1,
    roundsWithCorrect: 0,
    ...partial,
  };
}

describe('resolveRound', () => {
  it('gives the hit to the only correct player', () => {
    const result = resolveRound(
      round({
        players: [player('a', 100, 0, 'correct', 0), player('b', 100, 2, 'timeout', null)],
      }),
    );

    expect(result.hitterId).toBe('a');
    expect(result.damage).toEqual([{ to: 'b', amount: 12, attackSize: 'heavy', attacker: 'a' }]);
    expect(result.players[0]).toEqual({ id: 'a', hp: 100, combo: 1, ultimateCharge: chargeFromStreak(1) });
    expect(result.players[1]).toEqual({ id: 'b', hp: 88, combo: 0, ultimateCharge: 0 });
    expect(result.ultimateFired).toBe(false);
    expect(result.matchEnd).toBeNull();
  });

  it('lets the faster correct answer hit when both are correct', () => {
    const timeLeft = DURATION - 1000;
    const result = resolveRound(
      round({
        players: [player('a', 100, 0, 'correct', 1000), player('b', 100, 0, 'correct', 4000)],
      }),
    );

    expect(result.hitterId).toBe('a');
    expect(result.damage).toEqual([
      {
        to: 'b',
        amount: calculateHitDamage(1, timeLeft, DURATION),
        attackSize: 'heavy',
        attacker: 'a',
      },
    ]);
    expect(result.damage[0]?.amount).toBe(12);
    expect(result.players[0].combo).toBe(1);
    expect(result.players[1].combo).toBe(1);
    expect(result.players[1].hp).toBe(88);
  });

  it('deals no damage on an exact answerMs tie and raises both streaks', () => {
    const result = resolveRound(
      round({
        players: [player('a', 100, 1, 'correct', 2500), player('b', 80, 4, 'correct', 2500)],
      }),
    );

    expect(result.hitterId).toBeNull();
    expect(result.damage).toEqual([]);
    expect(result.players[0]).toMatchObject({ hp: 100, combo: 2, ultimateCharge: chargeFromStreak(2) });
    expect(result.players[1]).toMatchObject({ hp: 80, combo: 5, ultimateCharge: chargeFromStreak(5) });
    expect(result.ultimateFired).toBe(false);
  });

  it('chips both players on a double miss before the safety cap', () => {
    const result = resolveRound(
      round({
        roundNumber: 4,
        roundsWithCorrect: 1,
        players: [player('a', 100, 3, 'wrong', 2000), player('b', 50, 2, 'timeout', null)],
      }),
    );

    expect(MISS_DAMAGE).toBe(4);
    expect(result.hitterId).toBeNull();
    expect(result.damage).toEqual([
      { to: 'a', amount: 4, attackSize: 'light', attacker: null },
      { to: 'b', amount: 4, attackSize: 'light', attacker: null },
    ]);
    expect(result.players[0]).toMatchObject({ hp: 96, combo: 0, ultimateCharge: 0 });
    expect(result.players[1]).toMatchObject({ hp: 46, combo: 0, ultimateCharge: 0 });
    expect(result.roundsWithCorrect).toBe(1);
    expect(result.nextTier).toBe(1);
    expect(result.matchEnd).toBeNull();
  });

  it('deals no miss damage only on the safety-cap round', () => {
    const result = resolveRound(
      round({
        roundNumber: MAX_ROUNDS,
        players: [player('a', 100, 2, 'timeout', null), player('b', 90, 2, 'wrong', 1000)],
      }),
    );

    expect(result.damage).toEqual([]);
    expect(result.players[0].hp).toBe(100);
    expect(result.players[1].hp).toBe(90);
    expect(result.players[0].combo).toBe(0);
    expect(result.players[1].combo).toBe(0);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'max_rounds' });
  });

  it('freezes the slower streak when a race closes on the first correct answer', () => {
    const result = resolveRound(
      round({
        questionType: 'fill_blank',
        players: [player('a', 100, 1, 'correct', 1000), player('b', 100, 5, 'correct', 4000)],
      }),
    );

    expect(result.hitterId).toBe('a');
    expect(result.players[0].combo).toBe(2);
    expect(result.players[1].combo).toBe(5);
    expect(result.players[1].ultimateCharge).toBe(chargeFromStreak(5));
  });

  it('resets a race player who was already wrong when the round closed early', () => {
    const result = resolveRound(
      round({
        questionType: 'name_concept',
        players: [player('a', 100, 0, 'correct', 500), player('b', 100, 5, 'wrong', 200)],
      }),
    );

    expect(result.hitterId).toBe('a');
    expect(result.players[0].combo).toBe(1);
    expect(result.players[1].combo).toBe(0);
    expect(result.players[1].ultimateCharge).toBe(0);
  });

  it('fires the ultimate for the winner and then resets their combo', () => {
    const result = resolveRound(
      round({
        players: [player('a', 100, 2, 'correct', 0), player('b', 100, 1, 'wrong', 3000)],
      }),
    );

    expect(result.ultimateFired).toBe(true);
    expect(result.hitterId).toBe('a');
    expect(result.damage).toEqual([
      { to: 'b', amount: ultimateDamage(12), attackSize: 'ultimate', attacker: 'a' },
    ]);
    expect(result.damage[0]?.amount).toBe(30);
    expect(result.players[0]).toEqual({ id: 'a', hp: 100, combo: 0, ultimateCharge: 0 });
    expect(result.players[1]).toMatchObject({ hp: 70, combo: 0 });
  });

  it('keeps a streak of 3 after losing a speed contest, then fires on the next win', () => {
    const lost = resolveRound(
      round({
        players: [player('a', 100, 2, 'correct', 3000), player('b', 100, 0, 'correct', 1000)],
      }),
    );

    expect(lost.hitterId).toBe('b');
    expect(lost.ultimateFired).toBe(false);
    expect(lost.players[0].combo).toBe(3);
    expect(lost.players[0].ultimateCharge).toBe(100);
    expect(lost.players[1].combo).toBe(1);

    const won = resolveRound(
      round({
        players: [
          player('a', lost.players[0].hp, lost.players[0].combo, 'correct', 0),
          player('b', lost.players[1].hp, lost.players[1].combo, 'wrong', null),
        ],
      }),
    );

    expect(won.hitterId).toBe('a');
    expect(won.ultimateFired).toBe(true);
    expect(won.damage[0]?.attackSize).toBe('ultimate');
    expect(won.damage[0]?.amount).toBe(30);
    expect(won.players[0].combo).toBe(0);
    expect(won.players[0].ultimateCharge).toBe(0);
  });

  it('raises the tier after two correct rounds and not after a miss', () => {
    expect(ROUNDS_PER_TIER).toBe(2);
    const first = resolveRound(
      round({
        matchTier: 1,
        roundsWithCorrect: 0,
        players: [player('a', 100, 0, 'correct', 0), player('b', 100, 0, 'wrong', null)],
      }),
    );
    expect(first.roundsWithCorrect).toBe(1);
    expect(first.nextTier).toBe(1);

    const miss = resolveRound(
      round({
        roundNumber: 2,
        matchTier: first.nextTier,
        roundsWithCorrect: first.roundsWithCorrect,
        players: [player('a', 100, 0, 'timeout', null), player('b', 100, 0, 'wrong', null)],
      }),
    );
    expect(miss.roundsWithCorrect).toBe(1);
    expect(miss.nextTier).toBe(1);

    const second = resolveRound(
      round({
        roundNumber: 3,
        matchTier: miss.nextTier,
        roundsWithCorrect: miss.roundsWithCorrect,
        players: [player('a', 100, 0, 'wrong', null), player('b', 100, 0, 'correct', 0)],
      }),
    );
    expect(second.roundsWithCorrect).toBe(2);
    expect(second.nextTier).toBe(2);
    expect(second.nextTier).toBeLessThanOrEqual(MAX_TIER);
  });

  it('ends the match when a hit reduces HP to 0', () => {
    const result = resolveRound(
      round({
        roundNumber: 3,
        players: [player('a', 40, 0, 'correct', 0), player('b', 10, 0, 'timeout', null)],
      }),
    );

    expect(result.players[1].hp).toBe(0);
    expect(result.damage).toEqual([{ to: 'b', amount: 10, attackSize: 'heavy', attacker: 'a' }]);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'hp_zero' });
  });

  it('the safety cap awards the win to the higher HP', () => {
    const result = resolveRound(
      round({
        roundNumber: MAX_ROUNDS,
        players: [player('a', 50, 0, 'correct', 0), player('b', 40, 0, 'wrong', null)],
      }),
    );

    expect(result.players[0].hp).toBe(50);
    expect(result.players[1].hp).toBe(28);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'max_rounds' });
  });

  it('the safety cap is a draw when HP is equal', () => {
    const result = resolveRound(
      round({
        roundNumber: MAX_ROUNDS,
        players: [player('a', 55, 0, 'correct', 2000), player('b', 55, 0, 'correct', 2000)],
      }),
    );

    expect(result.hitterId).toBeNull();
    expect(result.damage).toEqual([]);
    expect(result.players[0].hp).toBe(55);
    expect(result.players[1].hp).toBe(55);
    expect(result.matchEnd).toEqual({ winnerId: null, reason: 'max_rounds' });
  });

  it('ends the ladder with the higher HP winning', () => {
    const target = MAX_TIER * ROUNDS_PER_TIER;
    const result = resolveRound(
      round({
        roundNumber: 4,
        roundsWithCorrect: target - 1,
        matchTier: MAX_TIER,
        players: [player('a', 40, 0, 'correct', 0), player('b', 30, 0, 'wrong', null)],
      }),
    );

    expect(result.roundsWithCorrect).toBe(target);
    expect(result.players[1].hp).toBeGreaterThan(0);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'tiers_complete' });
  });

  it('ends the ladder as a draw when HP is equal', () => {
    const target = MAX_TIER * ROUNDS_PER_TIER;
    const result = resolveRound(
      round({
        roundNumber: 4,
        roundsWithCorrect: target - 1,
        players: [player('a', 50, 0, 'correct', 2000), player('b', 50, 0, 'correct', 2000)],
      }),
    );

    expect(result.damage).toEqual([]);
    expect(result.players[0].hp).toBe(50);
    expect(result.players[1].hp).toBe(50);
    expect(result.matchEnd).toEqual({ winnerId: null, reason: 'tiers_complete' });
  });

  it('lets a KO beat tier completion in the same round', () => {
    const target = MAX_TIER * ROUNDS_PER_TIER;
    const result = resolveRound(
      round({
        roundNumber: 4,
        roundsWithCorrect: target - 1,
        players: [player('a', 40, 0, 'correct', 0), player('b', 5, 0, 'wrong', null)],
      }),
    );

    expect(result.roundsWithCorrect).toBe(target);
    expect(result.players[1].hp).toBe(0);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'hp_zero' });
  });

  it('still ends the match at the safety cap', () => {
    const result = resolveRound(
      round({
        roundNumber: MAX_ROUNDS,
        roundsWithCorrect: 1,
        players: [player('a', 20, 0, 'wrong', null), player('b', 10, 0, 'timeout', null)],
      }),
    );

    expect(result.roundsWithCorrect).toBe(1);
    expect(result.matchEnd).toEqual({ winnerId: 'a', reason: 'max_rounds' });
  });

  it('still chips both players on a miss before the safety cap', () => {
    expect(MAX_ROUNDS).toBeGreaterThan(12);
    const result = resolveRound(
      round({
        roundNumber: MAX_ROUNDS - 1,
        players: [player('a', 100, 0, 'wrong', null), player('b', 80, 0, 'timeout', null)],
      }),
    );

    expect(result.damage).toEqual([
      { to: 'a', amount: MISS_DAMAGE, attackSize: 'light', attacker: null },
      { to: 'b', amount: MISS_DAMAGE, attackSize: 'light', attacker: null },
    ]);
    expect(result.matchEnd).toBeNull();
  });

  it('treats rewrite_code as a race', () => {
    const result = resolveRound(
      round({
        questionType: 'rewrite_code',
        players: [player('a', 100, 1, 'correct', 1000), player('b', 100, 4, 'correct', 5000)],
      }),
    );

    expect(result.hitterId).toBe('a');
    expect(result.players[0].combo).toBe(2);
    expect(result.players[1].combo).toBe(4);
  });
});

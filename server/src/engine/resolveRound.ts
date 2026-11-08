// OWNER A: resolve one round. Pure. No sockets, no timers, no I/O.
// The caller has already judged each answer. This file does not read the question bank.
import type { AttackSize, QuestionType } from '@beatcode/shared';
import { MAX_ROUNDS, MAX_TIER, RACE_MODE_TYPES, ROUNDS_PER_TIER } from '@beatcode/shared';
import {
  applyDamage,
  applyMissDamage,
  attackSizeFor,
  calculateHitDamage,
  chargeFromStreak,
  shouldFireUltimate,
  speedBonusRatio,
  ultimateDamage,
  updateStreak,
  type StreakOutcome,
} from './battleRules';

export type AnswerStatus = 'correct' | 'wrong' | 'timeout';

export interface JudgedAnswer {
  status: AnswerStatus;
  /** Milliseconds from the round start. Null when the player did not answer. */
  answerMs: number | null;
}

export interface RoundPlayerInput {
  id: string;
  hp: number;
  combo: number;
  answer: JudgedAnswer;
}

export interface ResolveRoundInput {
  questionType: QuestionType;
  /** Tier of the question. Hit damage uses this. */
  questionTier: number;
  roundNumber: number;
  roundDurationMs: number;
  /** Match ladder tier at the start of this round. */
  matchTier: number;
  /** How many earlier rounds had at least one correct answer. */
  roundsWithCorrect: number;
  players: readonly [RoundPlayerInput, RoundPlayerInput];
}

export interface ResolvedPlayer {
  id: string;
  hp: number;
  combo: number;
  ultimateCharge: number;
}

/** Local damage list. The socket step maps this onto the shared payload later. */
export interface RoundDamage {
  to: string;
  amount: number;
  attackSize: AttackSize;
  attacker: string | null;
}

export interface MatchEnd {
  winnerId: string | null;
  reason: 'hp_zero' | 'max_rounds';
}

export interface ResolveRoundResult {
  players: [ResolvedPlayer, ResolvedPlayer];
  hitterId: string | null;
  damage: RoundDamage[];
  ultimateFired: boolean;
  nextTier: number;
  roundsWithCorrect: number;
  matchEnd: MatchEnd | null;
}

type Side = 0 | 1;

function isRace(questionType: QuestionType): boolean {
  return (RACE_MODE_TYPES as readonly QuestionType[]).includes(questionType);
}

/** 'tie' when both times are missing or equal. A missing time loses to a real time. */
function fasterSide(a: JudgedAnswer, b: JudgedAnswer): Side | 'tie' {
  if (a.answerMs === null && b.answerMs === null) return 'tie';
  if (a.answerMs === null) return 1;
  if (b.answerMs === null) return 0;
  if (a.answerMs === b.answerMs) return 'tie';
  return a.answerMs < b.answerMs ? 0 : 1;
}

function otherSide(side: Side): Side {
  return side === 0 ? 1 : 0;
}

function finishPlayer(player: RoundPlayerInput, hp: number, combo: number): ResolvedPlayer {
  return { id: player.id, hp, combo, ultimateCharge: chargeFromStreak(combo) };
}

function matchEndFor(players: readonly [ResolvedPlayer, ResolvedPlayer], roundNumber: number): MatchEnd | null {
  const [a, b] = players;
  const aDown = a.hp <= 0;
  const bDown = b.hp <= 0;
  if (aDown || bDown) {
    const winnerId = aDown === bDown ? null : aDown ? b.id : a.id;
    return { winnerId, reason: 'hp_zero' };
  }
  if (roundNumber >= MAX_ROUNDS) {
    const winnerId = a.hp === b.hp ? null : a.hp > b.hp ? a.id : b.id;
    return { winnerId, reason: 'max_rounds' };
  }
  return null;
}

export function resolveRound(input: ResolveRoundInput): ResolveRoundResult {
  const [p0, p1] = input.players;
  const correctSides = ([0, 1] as const).filter((side) => input.players[side].answer.status === 'correct');

  let hitterSide: Side | null = null;
  let tie = false;
  if (correctSides.length === 1) {
    hitterSide = correctSides[0];
  } else if (correctSides.length === 2) {
    const faster = fasterSide(p0.answer, p1.answer);
    if (faster === 'tie') tie = true;
    else hitterSide = faster;
  }

  const race = isRace(input.questionType);
  const outcomeFor = (side: Side): StreakOutcome => {
    const status = input.players[side].answer.status;
    if (tie || side === hitterSide) return 'correct';
    if (hitterSide !== null && race && status === 'correct') return 'closed_early';
    return status;
  };

  const combos: [number, number] = [
    updateStreak(p0.combo, outcomeFor(0)),
    updateStreak(p1.combo, outcomeFor(1)),
  ];
  const hps: [number, number] = [p0.hp, p1.hp];
  let damage: RoundDamage[] = [];
  let ultimateFired = false;

  if (hitterSide !== null) {
    const hitter = input.players[hitterSide];
    const defenderSide = otherSide(hitterSide);
    const defender = input.players[defenderSide];
    const answerMs = hitter.answer.answerMs ?? input.roundDurationMs;
    const timeLeftMs = input.roundDurationMs - answerMs;
    let amount = calculateHitDamage(input.questionTier, timeLeftMs, input.roundDurationMs);
    let attackSize: AttackSize = attackSizeFor(speedBonusRatio(timeLeftMs, input.roundDurationMs));
    if (shouldFireUltimate(combos[hitterSide], true)) {
      ultimateFired = true;
      amount = ultimateDamage(amount);
      attackSize = 'ultimate';
      combos[hitterSide] = 0;
    }
    const hit = applyDamage(defender.hp, amount);
    hps[defenderSide] = hit.hp;
    damage = [{ to: defender.id, amount: hit.lost, attackSize, attacker: hitter.id }];
  } else if (!tie && input.roundNumber < MAX_ROUNDS) {
    damage = input.players.map((player, index) => {
      const chip = applyMissDamage(player.hp);
      hps[index as Side] = chip.hp;
      return { to: player.id, amount: chip.lost, attackSize: 'light' as const, attacker: null };
    });
  }

  const players: [ResolvedPlayer, ResolvedPlayer] = [
    finishPlayer(p0, hps[0], combos[0]),
    finishPlayer(p1, hps[1], combos[1]),
  ];

  const someoneCorrect = correctSides.length > 0;
  const roundsWithCorrect = input.roundsWithCorrect + (someoneCorrect ? 1 : 0);
  const tierUp = someoneCorrect && roundsWithCorrect % ROUNDS_PER_TIER === 0;
  const nextTier = tierUp ? Math.min(MAX_TIER, input.matchTier + 1) : input.matchTier;

  return {
    players,
    hitterId: hitterSide === null ? null : input.players[hitterSide].id,
    damage,
    ultimateFired,
    nextTier,
    roundsWithCorrect,
    matchEnd: matchEndFor(players, input.roundNumber),
  };
}

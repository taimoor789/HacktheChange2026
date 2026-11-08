// OWNER A: pure battle-rule functions (no sockets, no timers: easy to unit test).
// Responsible for: damage, combo, ultimate charge, comeback.
// Others expect: B only renders the resulting PlayerState; numbers come from shared/constants.ts.
import type { PlayerState } from '@beatcode/shared';

/**
 * Attacker answered correctly. Returns the updated attacker (combo+1, ultimate charge)
 * and the damage dealt to the defender (tier base damage x combo multiplier, x ultimate if ready).
 */
export function applyCorrectAnswer(
  attacker: PlayerState,
  defender: PlayerState,
  _tier: number,
): { attacker: PlayerState; defender: PlayerState; damage: number } {
  // TODO(OWNER A): implement using DAMAGE_BY_TIER, COMBO_MULTIPLIERS, ULTIMATE_*.
  return { attacker, defender, damage: 0 };
}

/** Player answered wrong / timed out: reset their combo. The opponent's hit is handled by the caller. */
export function applyWrongAnswer(player: PlayerState): PlayerState {
  // TODO(OWNER A): reset combo to 0.
  return player;
}

/** Add ultimate charge for a correct answer at this tier. Clamped to ULTIMATE_CHARGE_NEEDED. */
export function chargeUltimate(player: PlayerState, _tier: number): PlayerState {
  // TODO(OWNER A): add ULTIMATE_CHARGE_BY_TIER[tier-1], clamp.
  return player;
}

/** If HP is below COMEBACK_HP_THRESHOLD, return boosted multipliers for charge and damage. */
export function applyComeback(player: PlayerState): { chargeMult: number; damageMult: number } {
  // TODO(OWNER A): use COMEBACK_* constants.
  void player;
  return { chargeMult: 1, damageMult: 1 };
}

// TODO(OWNER A): unit tests in server/src/engine/__tests__/battleRules.test.ts

// OWNER A: a single match room.
// Responsible for: round loop, timers, authoritative state, resolving rounds, emitting events.
// Others expect:
//   - OWNER C's getNextQuestion / toPublicQuestion / isCorrect / getTimerSeconds are used here.
//   - OWNER B receives round:start, round:result, ultimate:ready, match:end exactly as typed in shared/.
import type { MatchState } from '@beatcode/shared';

export interface Match {
  state: MatchState;
  usedQuestionIds: string[];
  start(): void;
  submitAnswer(playerId: string, answer: string): void;
}

// TODO(OWNER A): implement the round loop:
//   pick question (C) -> emit round:start -> wait for answers or deadline -> resolve
//   (race mode vs scored mode) -> apply battleRules -> emit round:result -> repeat -> match:end.
export function createMatch(_matchId: string): Match {
  throw new Error('TODO(OWNER A): createMatch not implemented');
}

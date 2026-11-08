# CODEL agent notes

CODEL (Compete Online: Debug, Execute, LARP) is a real-time 1v1 coding-quiz battle. Both players get the same question. A correct answer hits the opponent. Wrong or missing answers cost you. Questions climb a concept ladder, the timer shrinks as the tier rises, and a bot exists so someone can play solo.

## Ownership

| Zone | Owner | Rule |
|---|---|---|
| `server/` except `server/src/questions/` | A (multiplayer + game engine) | sockets, rooms, timers, battle rules, bot |
| `client/` | B (interface) | screens, animation, sound, profile, post-match UI |
| `server/src/questions/` | C (questions + ladder) | bank, selector, answer matching, timer lookup |
| `shared/` | A, B, and C | types, socket events, constants. All three must agree before a change. |

Agents stay in their owner's zone.

## Rules for agents

- Never edit `shared/` without telling the user first and showing the diff. Wait for approval.
- Never send `acceptedAnswers` or `explanation` to the client during a round. Those belong in the post-match review only.
- Mark unfinished work with `TODO(OWNER A)`, `TODO(OWNER B)`, or `TODO(OWNER C)`.

## Working agreement

- One step at a time, then stop.
- After each step, list the files changed, the exact test commands, and the output to expect.
- Prefer pure functions and unit tests for game logic.
- Do not add features that were not asked for.

## Game rules

Round result:

- The server clock decides. An answer received at or before `deadline` counts. A later one is missing.
- A correct answer beats a wrong or missing one. If both are correct, the faster one hits (smaller `answerMs`).
- An exact `answerMs` tie: nobody hits, no damage, and both streaks increment.
- Race types (`fill_blank`, `name_concept`, `output_prediction`, `rewrite_code`) end on the first correct answer. The slower player's streak freezes: no reset and no increment. A wrong answer or a true timeout still resets it.
- `rewrite_code` is a race. `isCorrect` returns a plain boolean. A typo suggestion from `checkAnswer` is a hint only and is not a correct answer.
- `spot_the_bug` waits until both have answered or the deadline hits, then the same correctness-then-speed rule applies.
- Round length is `getQuestionSeconds(question)` (the question's own `seconds` floor, otherwise the tier timer).
- One submission per player per round.
- Hit damage is the tier base from `DAMAGE_BY_TIER`, plus a linear speed bonus up to `SPEED_BONUS_MAX` (50% at the instant the round starts, 0 at the deadline). Round to the nearest integer. Only the round winner deals this damage.
- If neither is correct, both take flat `MISS_DAMAGE`, capped so HP cannot fall below 1. That chip is skipped only on the safety-cap round (`roundNumber === MAX_ROUNDS`), not when the ladder finishes.
- A normal hit can reduce HP to 0. HP never goes negative. `amount` is the HP actually lost.
- `attackSize` for a non-ultimate hit: `light` below 15% of the speed-bonus range, `medium` below 35%, `heavy` at or above 35%. Miss ticks are `light`. An ultimate hit is `ultimate`.

Match end. `match:end` carries `reason`. Owner B: a kill animation on `hp_zero`, and a "time's up" screen otherwise, is a guess, not confirmed.

- `hp_zero`: either HP is 0. The player still above 0 wins. Both at 0 is a draw. This wins over the other two reasons in the same round.
- `tiers_complete`: `roundsWithCorrect` reaches `MAX_TIER * ROUNDS_PER_TIER`. Higher HP wins. Equal HP is a draw.
- `max_rounds`: hard safety cap at `MAX_ROUNDS` (16) if the ladder never finishes. Higher HP wins. Equal HP is a draw.

Difficulty:

- Start at tier 1. The engine advances the tier with `ROUNDS_PER_TIER` (2): after every 2 rounds with at least one correct answer, the next round's tier goes up by 1, clamped at `MAX_TIER` (6). Miss rounds do not count. `QUESTIONS_PER_TIER` and `completeQuestion` are not used.

Ultimate:

- The streak lives in `combo`. It increments on a correct answer even when the opponent was faster, and resets to 0 on a wrong or missing answer. A race round that closes early freezes the slower player's `combo`.
- It fires when `combo >= ULT_STREAK` (3) and that player wins the round. Damage is the hit damage times `ULTIMATE_DAMAGE_MULTIPLIER` (2.5), then `combo` resets to 0.
- Emit `ultimate:ready` immediately before `round:result`. The player snapshot in `round:result` is the after-state, so the charge bar is already empty there.
- `ultimateCharge` stays on a 0 to `ULTIMATE_CHARGE_NEEDED` scale and is filled from the streak for the UI: `round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED)`.

## Questions module contract (for Owner C)

The engine reaches the questions module only through `server/src/matchQuestions.ts`. It uses `getNextQuestion`, `toPublicQuestion`, `isCorrect`, and `getQuestionSeconds`. If you change a signature, tell Owner A first.

The engine owns tier progression. Do not build on `QUESTIONS_PER_TIER` or `completeQuestion`. Every tier up to `MAX_TIER` needs enough questions that a match never runs out.

## Planned socket behavior

Not built yet. After a wrong answer, that player is locked out for the rest of the round (no retry). The other player can still answer until the timer ends. The round closes on the first correct answer or when the timer ends.

## Deferred

Leave these constants in `shared/` and do not implement them: comeback (`COMEBACK_*`), combo multipliers (`COMBO_MULTIPLIERS`), per-tier ultimate charge (`ULTIMATE_CHARGE_BY_TIER`), and wrong-answer lockout (`WRONG_ANSWER_LOCKOUT_MS`). Also deferred: items and power-ups, ELO, guilds, and tournaments.

## Contract status

| Change | Status |
|---|---|
| `SPEED_BONUS_MAX` 0.5, `MISS_DAMAGE` 4, `ULT_STREAK` 3 in `shared/src/constants.ts` | Applied |
| `rewrite_code` in `RACE_MODE_TYPES`, `MAX_ROUNDS` = 16 | Applied in their own commit. Needs review from B and C |
| Round time from `getQuestionSeconds(question)` | Adopted |
| `round:result` `damage` becomes `DamageEvent[]` so a double miss can hit both players | Pending. B and C |

Pending diff (do not apply yet). In `shared/src/events.ts`, replace the single `damage` object on `RoundResultPayload` with:

```ts
export interface DamageEvent {
  to: PlayerId;
  amount: number;
  attackSize: AttackSize;
  /** Null when the hit is mutual miss damage. */
  attacker: PlayerId | null;
}

damage: DamageEvent[];
```

One hitter is one element. A double miss is two elements with `attacker: null`. A safety-cap double miss, or an exact time tie, is `damage: []`. No other socket event changes. `shared/src/types.ts` is unchanged until that payload change is approved. Owner B's mock still builds the old single `damage` object, so applying this will break their typecheck until they update it.

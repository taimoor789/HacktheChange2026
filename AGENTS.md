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
- Race types (`fill_blank`, `name_concept`, `output_prediction`) end on the first correct answer. The slower player's streak freezes: no reset and no increment. A wrong answer or a true timeout still resets it.
- `spot_the_bug` waits until both have answered or the deadline hits, then the same correctness-then-speed rule applies.
- One submission per player per round.
- Hit damage is the tier base from `DAMAGE_BY_TIER`, plus a linear speed bonus up to `SPEED_BONUS_MAX` (50% at the instant the round starts, 0 at the deadline). Round to the nearest integer. Only the round winner deals this damage.
- If neither is correct, both take flat `MISS_DAMAGE`, capped so HP cannot fall below 1. On round `MAX_ROUNDS`, a double miss deals no damage.
- A normal hit can reduce HP to 0. HP never goes negative. `amount` is the HP actually lost.
- `attackSize` for a non-ultimate hit: `light` below 15% of the speed-bonus range, `medium` below 35%, `heavy` at or above 35%. Miss ticks are `light`. An ultimate hit is `ultimate`.

Match end:

- After a round, if either HP is 0, the match ends. The player still above 0 wins. `winnerId: null` is a draw.
- If nobody has reached 0, the match ends after `MAX_ROUNDS` (12). Higher HP wins. Equal HP is a draw.

Difficulty:

- Start at tier 1. After every 2 rounds with at least one correct answer, the next round's tier goes up by 1, clamped at `MAX_TIER` (6). Miss rounds do not count.

Ultimate:

- The streak lives in `combo`. It increments on a correct answer even when the opponent was faster, and resets to 0 on a wrong or missing answer. A race round that closes early freezes the slower player's `combo`.
- It fires when `combo >= ULT_STREAK` (3) and that player wins the round. Damage is the hit damage times `ULTIMATE_DAMAGE_MULTIPLIER` (2.5), then `combo` resets to 0.
- Emit `ultimate:ready` immediately before `round:result`. The player snapshot in `round:result` is the after-state, so the charge bar is already empty there.
- `ultimateCharge` stays on a 0 to `ULTIMATE_CHARGE_NEEDED` scale and is filled from the streak for the UI: `round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED)`.

## Deferred

Leave these constants in `shared/` and do not implement them: comeback (`COMEBACK_*`), combo multipliers (`COMBO_MULTIPLIERS`), per-tier ultimate charge (`ULTIMATE_CHARGE_BY_TIER`), and wrong-answer lockout (`WRONG_ANSWER_LOCKOUT_MS`). Also deferred: items and power-ups, ELO, guilds, and tournaments.

## Contract status

| Change | Status |
|---|---|
| `MAX_ROUNDS` 12, `SPEED_BONUS_MAX` 0.5, `MISS_DAMAGE` 4, `ULT_STREAK` 3 in `shared/src/constants.ts` | Applied |
| `round:result` `damage` becomes `DamageEvent[]` so a double miss can hit both players | Pending until A, B, and C approve |

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

One hitter is one element. A double miss is two elements with `attacker: null`. A final-round double miss, or an exact time tie, is `damage: []`. No other socket event changes. `shared/src/types.ts` is unchanged until that payload change is approved. Owner B's mock still builds the old single `damage` object, so applying this will break their typecheck until they update it.

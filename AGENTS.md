# CODEL agent notes

CODEL (Compete Online: Debug, Execute, LARP) is a real-time 1v1 coding-quiz battle. Both players are human. Both get the same question. A correct answer hits the opponent. Wrong or missing answers cost you. Questions climb a concept ladder, and the timer shrinks as the tier rises.

## Ownership

| Zone | Owner | Rule |
|---|---|---|
| `server/` except `server/src/questions/` | A (multiplayer + game engine) | sockets, rooms, timers, battle rules |
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
- Every type is a race (`RACE_MODE_TYPES`: `fill_blank`, `name_concept`, `output_prediction`, `spot_the_bug`, `rewrite_code`). The first correct answer ends the round and hits. A wrong answer locks that player out while the other keeps the rest of the time. The round also ends as soon as both players have answered wrong. The slower player's streak freezes: no reset and no increment. A wrong answer or a true timeout still resets it.
- `isCorrect` returns a plain boolean. A typo suggestion from `checkAnswer` is a hint only and is not a correct answer.
- Round length is `getQuestionSeconds(question)`: the tier timer, raised to the question's own `seconds` when that is longer, and never more than 60 seconds. `round:start` arrives after the pacing delay. The client counts down from that event's `deadline` and `serverNow`.
- One counted submission per player per round. A hint does not count as that submission.
- Hit damage is the tier base from `DAMAGE_BY_TIER`, plus a linear speed bonus up to `SPEED_BONUS_MAX` (50% at the instant the round starts, 0 at the deadline). Round to the nearest integer. Only the round winner deals this damage.
- If neither is correct, both take flat `MISS_DAMAGE`, capped so HP cannot fall below 1. That chip is skipped only on the safety-cap round (`roundNumber === MAX_ROUNDS`), not when the ladder finishes.
- A normal hit can reduce HP to 0. HP never goes negative. `amount` is the HP actually lost.
- `attackSize` for a non-ultimate hit: `light` below 15% of the speed-bonus range, `medium` below 35%, `heavy` at or above 35%. Miss ticks are `light`. An ultimate hit is `ultimate`.

Match end. `match:end` carries `reason`. Owner B: a kill animation on `hp_zero`, and a "time's up" screen for `tiers_complete` or `max_rounds`, is a guess, not confirmed. `forfeit` means the other player left. The remaining player wins.

- `hp_zero`: either HP is 0. The player still above 0 wins. Both at 0 is a draw. This wins over the other two reasons in the same round.
- `tiers_complete`: `roundsWithCorrect` reaches `MAX_TIER * ROUNDS_PER_TIER`. Higher HP wins. Equal HP is a draw.
- `max_rounds`: hard safety cap at `MAX_ROUNDS` (16) if the ladder never finishes. Higher HP wins. Equal HP is a draw.
- `forfeit`: a player disconnected. `winnerId` is the player still connected. `review` is the rounds finished so far, and it is empty when none have finished.

Difficulty:

- Start at tier 1. The engine advances the tier with `ROUNDS_PER_TIER` (2): after every 2 rounds with at least one correct answer, the next round's tier goes up by 1, clamped at `MAX_TIER` (6). Miss rounds do not count. `QUESTIONS_PER_TIER` and `completeQuestion` are not used.

Ultimate:

- The streak lives in `combo`. It increments on a correct answer and resets to 0 on a wrong or missing answer. A round that closes on the opponent's correct answer freezes your `combo` (every type is a race).
- It fires when `combo >= ULT_STREAK` (3) and that player wins the round. Damage is the hit damage times `ULTIMATE_DAMAGE_MULTIPLIER` (2.5), then `combo` resets to 0.
- Emit `ultimate:ready` immediately before `round:result`. The player snapshot in `round:result` is the after-state, so the charge bar is already empty there.
- `ultimateCharge` stays on a 0 to `ULTIMATE_CHARGE_NEEDED` scale and is filled from the streak for the UI: `round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED)`.

## Questions module contract (for Owner C)

The engine reaches the questions module only through `server/src/matchQuestions.ts`. It uses `getNextQuestion`, `toPublicQuestion`, `isCorrect`, `getQuestionSeconds`, and `checkAnswer`. If you change a signature, tell Owner A first. `checkAnswer(question, submitted, hintsUsed)` takes a required `hintsUsed`. The engine passes that player's count for that question, starting at 0. The cap is 1.

The engine owns tier progression. Do not build on `QUESTIONS_PER_TIER` or `completeQuestion`. Every tier up to `MAX_TIER` needs enough questions that a match never runs out.

## Socket behavior

`shared/src/` is the source of truth for events and payloads. Built in Step 5. After a wrong counted answer, that player is locked out for the rest of the round (no retry). The other player can still answer until the timer ends. Every round is a race: it closes on the first correct answer, or once both players have a counted answer, so two wrong answers end it at once. Typed single-line questions may return one hint: the engine passes that player's `hintsUsed` to `checkAnswer`, and a suggestion is not a submission. The cap is 1. `answer:hint` goes only to the player who typed the near-miss. Option questions, `spot_the_bug`, and `rewrite_code` never hint. Owner B: show "Did you mean: <suggestion>", put it in the input, and submit it on Enter.

Step 7. `queue:join` pairs the next two humans. A second join from the same socket, or a join during a match, is ignored. Disconnecting while waiting leaves the queue. The server ignores a submission that is not a string, is longer than 2000 characters, arrives after `deadline`, names another match, round, or question, comes from a socket that is not in the match, or is a second counted submission in that round. A disconnect during a match emits `match:end` with `reason: "forfeit"` and `winnerId` set to the remaining player. A forfeit cancels any pending gap and ends immediately.

Step 10. The question is not sent with `match:found`. The first `round:start` waits `MATCH_START_DELAY_MS`. Later rounds wait `ROUND_GAP_MS` after `round:result`, or `ROUND_GAP_ULTIMATE_MS` when that round fired an ultimate. `match:end` for `hp_zero`, `tiers_complete`, or `max_rounds` waits `MATCH_END_DELAY_MS` after the final `round:result`. Owner B: show the intro on `match:found` and enable controls when `round:start` arrives. The workaround of showing controls early can go.

Step 11. `lobby:create` returns `lobby:created` with a 5-character code from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. The host waits. `lobby:join` trims and uppercases the code. If the lobby is open, unexpired, and the host is a different connected socket, the code is removed and both players get `match:found`. Otherwise `lobby:error`. A socket is in only one of the queue, a lobby, or a match (`busy`). Joining your own lobby is `own_lobby`. A used code is `not_found`. The host gets `lobby:closed` `expired` after `LOBBY_TTL_MS`, or `host_left` on `lobby:leave`. Five failed joins per minute, then `rate_limited`. There is no lobby list. Names are trimmed, control characters stripped, cut at 24 characters, or `Player`. Both lobby events take an optional `characterId` like `queue:join`; a missing or invalid one (not 1 to 32 letters, digits, `_` or `-`) is `player`.

Step 9. LinkedIn Connect: `linkedinUrl` is optional on `queue:join`, `lobby:create` and `lobby:join`, and is kept only as a `https://www.linkedin.com/in/...` link. After `match:end`, `connect:request` `{ matchId, targetPlayerId }` asks to swap links. The server answers with `connect:update` `{ matchId, status, opponentLinkedinUrl? }`: `waiting`, `requested`, `connected` (both asked, the link is sent, or null if none was added), or `unavailable` (the opponent left). `vsBot` is ignored. There is no bot. `isBot` is false.

## Deferred

Leave these constants in `shared/` and do not implement them: comeback (`COMEBACK_*`), combo multipliers (`COMBO_MULTIPLIERS`), per-tier ultimate charge (`ULTIMATE_CHARGE_BY_TIER`), and wrong-answer lockout (`WRONG_ANSWER_LOCKOUT_MS`). Also deferred: items and power-ups, ELO, guilds, tournaments, and the bot.

## Contract status

| Change | Status |
|---|---|
| `SPEED_BONUS_MAX` 0.5, `MISS_DAMAGE` 4, `ULT_STREAK` 3 in `shared/src/constants.ts` | Applied |
| `rewrite_code` in `RACE_MODE_TYPES`, `MAX_ROUNDS` = 16 | Applied in their own commit. Needs review from B and C |
| Round time from `getQuestionSeconds(question)` | Adopted |
| `round:result` `damage` as `DamageEvent[]`, `answer:hint`, and `match:end` `reason` | Applied in one commit. Pending approval from B and C |
| Hint cap is 1. The engine passes `hintsUsed` to `checkAnswer` | Applied |
| `forfeit` on `MatchEndReason` | Applied. Pending approval from B and C |
| Round pacing and lobby events | Applied. Pending approval from B and C |
| Optional `characterId` on `lobby:create` and `lobby:join` | Applied by B. Pending approval from A and C |
| `spot_the_bug` in `RACE_MODE_TYPES` (every type is a race) | Applied by B. Pending approval from A and C |

`DamageEvent` is `{ to, amount, attackSize, attacker }`. `attacker` is null on mutual miss damage. One hitter is one element. A double miss is two. A tie, or a safety-cap double miss, is `damage: []`. `answer:hint` is `{ matchId, round, suggestion }` and goes only to the player who typed the near-miss. `match:end` `reason` is `hp_zero`, `tiers_complete`, `max_rounds`, or `forfeit`.

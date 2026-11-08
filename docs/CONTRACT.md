# BeatCode Contract

Source of truth: `shared/src/`. This file is a plain-language copy. If they disagree, the code wins.
Changing anything here needs **all three owners** (A, B, C) to agree.

## Question (owned by C, read by A and B)

| Field | Meaning |
|---|---|
| `id` | unique string |
| `type` | `fill_blank` \| `name_concept` \| `output_prediction` \| `spot_the_bug` \| `rewrite_code` (multi-line, heavy) |
| `difficulty` | tier number, 1..6 |
| `concept` | e.g. `loops`, `recursion` (must exist in the ladder for that tier) |
| `prompt`, `code?` | what the player sees |
| `seconds?` | optional minimum time limit; round timer = max(tier timer, seconds), capped at 60. The client counts from `deadline` and `serverNow` |
| `options?` | multiple choice; answer may be option text or 0-based index |
| `acceptedAnswers[]` | **never sent to the client** |
| `explanation` | shown in post-match review only |

`PublicQuestion` = Question without `acceptedAnswers` and `explanation`. The server only ever sends
this during a round.

## Socket events (owned by A, consumed by B)

Client to server:
- `queue:join` `{ name, characterId, linkedinUrl?, vsBot? }`
- `answer:submit` `{ matchId, round, questionId, answer }`
- `connect:request` `{ matchId, targetPlayerId }`

Server to client:
- `match:found` `{ matchId, you, opponent }`
- `round:start` `{ matchId, round, tier, question: PublicQuestion, deadline, serverNow }`
- `round:result` `{ matchId, round, questionId, outcomes, damage: DamageEvent[], players, nextTier }`
- `answer:hint` `{ matchId, round, suggestion }` (sent only to the player who typed the near-miss)
- `ultimate:ready` `{ matchId, playerId }`
- `match:end` `{ matchId, winnerId, players, review: ReviewItem[], reason }`

`DamageEvent` is `{ to, amount, attackSize, attacker }`. `attackSize` is `light`, `medium`, `heavy`, or `ultimate`. `attacker` is null on mutual miss damage. One hitter is one element. A double miss is two elements. A tie, or a safety-cap double miss, is `damage: []`.

`reason` is `hp_zero`, `tiers_complete`, `max_rounds`, or `forfeit`. `forfeit` means the other player left. The remaining player wins. `review` is the rounds finished so far.

`shared/src/` is the source of truth. `queue:join` pairs two humans. A second join from the same socket, or a join during a match, is ignored. Disconnecting while waiting leaves the queue. Disconnecting during a match is `forfeit`.

The server ignores an `answer:submit` that is not a string, is longer than 2000 characters, arrives after `deadline`, names another match, round, or question, or is a second counted answer in that round. One `answer:hint` per question, and only to the player who typed the near-miss. Owner B shows "Did you mean: <suggestion>" and can submit that text.

Step 9 (LinkedIn Connect) is postponed. The server ignores `connect:request`, `linkedinUrl`, and `vsBot`. There is no bot. `isBot` is false.

## Game state

`PlayerState`: `id, name, characterId, hp, maxHp, combo, ultimateCharge, tier, isBot`.
`MatchState`: `matchId, round, tier, status, players`. A changes it; B only renders it.
Both players always get the **same question** each round (one shared ladder per match).

## Tunable constants (`shared/src/constants.ts`)

The engine uses `STARTING_HP`, `DAMAGE_BY_TIER`, `ULTIMATE_CHARGE_NEEDED`, `ULTIMATE_DAMAGE_MULTIPLIER`, `TIMER_SECONDS_BY_TIER`, `RACE_MODE_TYPES`, `ROUNDS_PER_TIER`, `MAX_ROUNDS`, `SPEED_BONUS_MAX`, `MISS_DAMAGE`, and `ULT_STREAK`. `ultimateCharge` is filled from the streak: `round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED)`.

Not implemented. Leave them alone: `COMBO_MULTIPLIERS`, `ULTIMATE_CHARGE_BY_TIER`, `COMEBACK_*`, `WRONG_ANSWER_LOCKOUT_MS`, and `QUESTIONS_PER_TIER` (Owner C's module only).

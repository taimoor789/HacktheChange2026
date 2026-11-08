# BeatCode Contract

Source of truth: `shared/src/`. This file is a plain-language copy. If they disagree, the code wins.
Changing anything here needs **all three owners** (A, B, C) to agree.

## Question (owned by C, read by A and B)

| Field | Meaning |
|---|---|
| `id` | unique string |
| `type` | `fill_blank` \| `name_concept` \| `output_prediction` \| `spot_the_bug` |
| `difficulty` | tier number, 1..6 |
| `concept` | e.g. `loops`, `recursion` (must exist in the ladder for that tier) |
| `prompt`, `code?` | what the player sees |
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
- `round:result` `{ matchId, round, questionId, outcomes, damage, players, nextTier }`
- `ultimate:ready` `{ matchId, playerId }`
- `match:end` `{ matchId, winnerId, players, review: ReviewItem[] }`

## Game state

`PlayerState`: `id, name, characterId, hp, maxHp, combo, ultimateCharge, tier, isBot`.
`MatchState`: `matchId, round, tier, status, players`. A changes it; B only renders it.
Both players always get the **same question** each round (one shared ladder per match).

## Tunable constants (`shared/src/constants.ts`)

Starting HP, damage per tier, combo multipliers, ultimate charge, comeback threshold,
timer seconds per tier. All placeholders until playtesting.

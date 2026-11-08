# Questions + Ladder (Owner C)

## What A (server) calls

```ts
import { getNextQuestion, toPublicQuestion } from './questions/selector';
import { isCorrect } from './questions/answerMatching';
import { getTimerSeconds, MAX_TIER } from './questions/ladder';

const q = getNextQuestion({ tier, usedIds }); // one call per round: both players get the same question
send(toPublicQuestion(q)); // never send q itself
const ok = isCorrect(q, submittedAnswer); // server-side only
const seconds = getTimerSeconds(tier);
```

Tier progression: **2 questions per tier, then the next tier, up to tier 6** (`QUESTIONS_PER_TIER` in shared constants).
Counted per tier, not by round number. Call `completeQuestion({ tier, askedInTier })` from `ladder.ts` after each question:
it returns the next `{ tier, askedInTier }` and `finished: true` after the 2nd question of tier 6 (12 questions in total).
What happens after that (match over, or sudden death at tier 6) is A's call; the selector keeps working at tier 6.

How the next question is chosen (`getNextQuestion`): the question TYPE is picked first with balanced odds (`TYPE_WEIGHTS`,
so common types do not crowd out rare ones), then a random question of that type. It never repeats a question from this match
(`usedIds`), avoids the same type twice in a row, and avoids `recentIds` (e.g. the players' previous match) when it can.
If a tier runs out, the selector falls back to the nearest tier, and repeats only if the whole bank is used.

## What B (client) needs to know about answers

- `fill_blank`, `name_concept`, `output_prediction`: free text. For multi-line output, one line with spaces is accepted.
- Questions with `options`: send the option **text** (an index also works).
- `spot_the_bug`: the answer is a **1-based line number of `code`**. Show a line-number gutter next to the code.
  Send `"3"` or `"line 3"`.

## Adding questions

1. Add an object to `bank/tierN.json` (id unique, `difficulty` = N, `concept` from `ladder.ts` for that tier).
2. `npm run validate:bank -w server` checks the format; `npm test -w server` also checks that every
   accepted answer is judged correct.

## "Did you mean ...?" typo suggestions (`suggestion.ts`)

`checkAnswer(question, submitted)` returns `{status: 'correct'}`, `{status: 'wrong'}` or
`{status: 'suggest', suggestion}`. A suggestion is a near-miss of an accepted answer ("strig" -> "string").
It is **not scored**. The player presses Enter to submit the suggestion (always correct) or retypes.

- **A (server):** call `checkAnswer` instead of `isCorrect`. On `suggest`: no lockout, no combo reset, no damage,
  keep the round and timer running, tell only that player, and stop suggesting after
  `MAX_SUGGESTIONS_PER_QUESTION` (3) per question per player. This needs a new server-to-client socket event,
  which is a `shared/` contract change (all three owners must agree).
- **B (client):** show "Did you mean: X?", put X in the input, and submit it on Enter.
- Forgiveness: 3-letter answers forgive only swapped neighbours, 4-7 letters 1 edit, 8-15 letters 2, 16+ letters 3.
  Never for numbers, symbols, option (click) questions or `spot_the_bug`.

## `rewrite_code` (long, multi-line questions) and per-question timers

The player sees buggy `code` and types the corrected code (several lines). It is a **heavy** question: scored mode, not a race.

- **Grading** (`isCorrect`): code is compared as tokens. Indentation, line breaks, spacing, `;` and full-line comments are ignored.
  Up to 3 distinct misspelled names/keywords (4+ letters, e.g. `retrun`) are forgiven. Operators, numbers, missing or extra
  code and wrong-but-real names are wrong. SQL is case-insensitive. Typing only the fixed line is accepted when listed in `acceptedAnswers`.
  There is no code execution, so equivalent-but-different solutions must be listed in `acceptedAnswers`.
- **Timer:** `getQuestionSeconds(question)` = max(tier timer, `question.seconds`). Normal questions get shorter as tiers rise;
  long questions keep their own longer limit (`seconds`, required >= 30 for `rewrite_code`).
- **A:** use `getQuestionSeconds(q)` instead of `getTimerSeconds(tier)`; treat `rewrite_code` as scored mode (it is not in `RACE_MODE_TYPES`).
- **B:** needs a multi-line text box (Enter = new line, Ctrl/Cmd+Enter = submit, Tab = 4 spaces). Show the code with line numbers.
- This adds `rewrite_code` to `QuestionType` and an optional `seconds` to `Question` in `shared/` (all three owners must agree).

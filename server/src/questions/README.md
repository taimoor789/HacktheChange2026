# Questions + Ladder (Owner C)

## What the engine (Owner A) calls

The engine reaches this module **only** through `server/src/matchQuestions.ts`, using exactly these four functions
(do not rename them or change their signatures without telling A first):

```ts
import { getNextQuestion, toPublicQuestion } from './questions/selector';
import { isCorrect } from './questions/answerMatching';
import { getQuestionSeconds } from './questions/ladder';

const q = getNextQuestion({ tier, usedIds }); // one call per round: both players get the same question
send(toPublicQuestion(q)); // never send q itself
const ok = isCorrect(q, submittedAnswer); // plain boolean, server-side only. No partial credit.
const seconds = getQuestionSeconds(q); // the final way to get a round's time
```

**Tier progression is owned by the engine** (tier +1 per `ROUNDS_PER_TIER` = 2 rounds with a correct answer).
`QUESTIONS_PER_TIER` and `completeQuestion` exist in this repo but are **not used by the engine**; they are only
exercised by this module's own tests.

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

## "Did you mean ...?" typo hints (`suggestion.ts`) - agreed with Owner A

`checkAnswer(question, submitted, hintsUsed = 0)` returns `{status: 'correct'}`, `{status: 'wrong'}` or
`{status: 'suggest', suggestion}`. A suggestion is a near-miss of an accepted answer ("strig" -> "string").

**A hint never makes an answer count as correct.** `isCorrect("strig")` is `false`. `checkAnswer` says `'correct'`
exactly when `isCorrect` is true. A player who confirms the hint submits the full answer ("string"), and _that_
submission is judged by `isCorrect` like any other.

- **Cap: 1 hint per player per question** (`MAX_SUGGESTIONS_PER_QUESTION`; a hint reveals the answer). The caller counts
  hints and passes `hintsUsed`; at the cap a near-miss is a plain `'wrong'`.
- **Engine (A):** on `'suggest'` it is not a submission: no lockout, no combo reset, no damage, the timer keeps running and
  `answerMs` is measured at the confirmed submission. The hint goes to that player only via the socket event
  `answer:hint` `{ matchId, round, suggestion }`. That event is a `shared/` change that A proposes in a PR (B must agree);
  this module does not add it.
- **Typed single-line question types only.** Never a hint for `rewrite_code`, `spot_the_bug` or option (click) questions.
- **B (client):** show "Did you mean: X?", put X in the input, and submit it on Enter.
- Forgiveness: 3-letter answers forgive only swapped neighbours, 4-7 letters 1 edit, 8-15 letters 2, 16+ letters 3.
  Never for numbers or symbols.

## `rewrite_code` (long, multi-line questions) and per-question timers

The player sees buggy `code` and types the corrected code (several lines). It is a **heavy** question and a **race** type, like `fill_blank`: the round ends on the first correct answer.

- **Grading** (`isCorrect`): code is compared as tokens. Full-line comments and `;` are ignored. Up to 3 distinct misspelled
  names/keywords (4+ letters, e.g. `retrun`) are forgiven (approved by A; `MAX_CODE_TYPOS`). Operators, numbers, missing or extra
  code and wrong-but-real names are wrong. SQL is case-insensitive. Typing only the fixed line is accepted when listed in
  `acceptedAnswers`. There is no code execution, so equivalent-but-different solutions must be listed in `acceptedAnswers`.
- **Python: indentation and line breaks are significant** (6 of the 11 questions). Any _consistent_ indent works: 2 spaces,
  4 spaces, 8 spaces, tabs, or a uniform extra indent, because we compare nesting levels, not widths. Wrong nesting, a flattened
  one-liner, or a dedent to a level that was never opened is wrong. A trailing `# comment` on a line is ignored.
  JavaScript and SQL ignore indentation and line breaks.
- **Forgiven-typo report** (optional, for the post-match review): `forgivenTypos(question, submitted)` returns the list of
  forgiven misspellings (`[{ typed: 'retrun', expected: 'return' }]`), `[]` for an exact answer, or `null` if the answer is not
  correct. It is separate from `isCorrect`, which stays a plain boolean.
- **Timer:** `getQuestionSeconds(question)` = max(tier timer, `question.seconds`). Normal questions get shorter as tiers rise;
  long questions keep their own longer limit (`seconds`, required >= 30 for `rewrite_code`).
- **Engine (A):** use `getQuestionSeconds(q)` for the round time. `isCorrect` is a plain boolean, judged the moment a player submits.
- **Speed:** grading is pure token comparison: no code execution, no randomness, no clock. It is deterministic and takes about 0.01 ms (worst case 0.15 ms).
- **B:** needs a multi-line text box (Enter = new line, Ctrl/Cmd+Enter = submit, Tab = 4 spaces). Show the code with line numbers.
- This adds `rewrite_code` to `QuestionType` and an optional `seconds` to `Question` in `shared/` (all three owners must agree).

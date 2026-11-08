# Questions + Ladder (Owner C)

## What A (server) calls
```ts
import { getNextQuestion, toPublicQuestion } from './questions/selector';
import { isCorrect } from './questions/answerMatching';
import { getTimerSeconds, MAX_TIER } from './questions/ladder';

const q = getNextQuestion({ tier, usedIds });   // one call per round: both players get the same question
send(toPublicQuestion(q));                      // never send q itself
const ok = isCorrect(q, submittedAnswer);       // server-side only
const seconds = getTimerSeconds(tier);
```
Tier advance / step-back policy is A's call (default in shared constants: `ROUNDS_PER_TIER`).
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

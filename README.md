# BeatCode: 1v1 Coding Battles

Real-time 1v1 coding-quiz battles with anime-style fighters. Correct answers attack, wrong answers
get you hit. Questions climb a concept ladder (easy to hard) and the timer shrinks as the tier rises.
Both players are human. LinkedIn Connect (Step 9) is postponed. Full concept: see the team's `beatcode-idea.md`.

## Run it

```bash
npm install
cp .env.example .env     # optional; defaults work
npm run dev              # server on :3001, client on :5173
```

- Client only, no server: set `VITE_USE_MOCK=true` in `.env` (plays a scripted match).
- Checks: `npm run typecheck`, `npm test`, `npm run validate:bank -w server`.

## Folder ownership

| Folder | Owner | Responsibility |
|---|---|---|
| `server/src/` (except `questions/`) | **A** Multiplayer + Game Engine | sockets, matchmaking, rooms, timers, answer checking, battle rules |
| `client/` | **B** Graphical Interface | screens, HP bars, animations, cutscenes, sound, profile + post-match UI |
| `server/src/questions/` | **C** Questions + Ladder | schema, bank, concept ladder, selector, timer-per-tier, answer matching |
| `shared/` | **Everyone** | the contract: types, socket events, constants |

**`shared/` changes need all three owners to agree.** Open a PR titled `contract: ...` and get a
thumbs-up from A, B and C before merging.

Every stub file starts with a header comment (owner, responsibility, what others expect) and
`TODO(OWNER A|B|C)` markers. Find yours with `grep -rn "TODO(OWNER C)" .`

See [docs/CONTRACT.md](docs/CONTRACT.md) for the contract and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the git workflow.

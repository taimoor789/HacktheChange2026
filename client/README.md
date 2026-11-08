# CODEL client

The CODEL front end, live at **[codel.space](https://codel.space)**. Vite + TypeScript + HTML/CSS, no framework. Owner B.

Flow: Home → PLAY → character select → Quick Match, Join Friend or Create Lobby → battle → cutscene → review.

## Where things are

| Path | What it does |
|---|---|
| `src/router.ts` | Screens and transitions. `/select` and `/game` only open from in-app buttons. |
| `src/pages/` | Home, character select and the battle screen. |
| `src/popup.ts` | Quick Match, Join Friend and Create Lobby popups. |
| `src/net/socket.ts`, `src/net/session.ts` | The server connection and the current match. Closing the socket is how you leave, and mid-match that counts as a forfeit. |
| `src/match/battle.ts` | Question and code panels, the input for each question type, timer, HP, combo, ultimate, and the "Did you mean" hint. |
| `src/match/attacks.ts`, `src/match/battleAudio.ts` | On a hit, the attacker's attack GIF and sound start together. The sound variant follows the hit size. Battle music loops after the intro. |
| `src/match/cutscene.ts` | The winner's finisher, played after a knockout or a win on time. None for a draw, a forfeit or a mirror match. |
| `src/match/endScreen.ts` | Result, post-match review, and LinkedIn Connect. |
| `src/characters.ts` | The fighters. Art is in `public/assets/characters/<id>/`. |

## Assets

| Folder | Contents |
|---|---|
| `public/assets/characters/<id>/` | `idle-{left,right}.gif`, `still-{left,right}.png`, `attack-{left,right}.gif` |
| `public/assets/audio/attacks/` | Four attack sounds per fighter (light, medium, heavy, ultimate) |
| `public/assets/audio/battle/` | Battle music loop (`.ogg`, with an `.m4a` fallback) |
| `public/assets/video/cutscenes/` | `<winner>_vs_<loser>.mp4` finishers |
| `public/assets/video/scenes/` | Stage intro and loop videos |

## Notes

- **Pacing comes from the server:** the stage intro plays during the 4 s start delay, results stay up for the 2.5 s gap (5 s after an ultimate), and the match end follows 3 s after the last result.
- **Phones:** the battle screen switches to a stage band on top with the panels below, in both portrait and landscape.
- **Test codes (local dev builds only):** in Join Friend, `TEST01` plays every question type, `TEST02` is a knockout, and `TEST03` is a forfeit. They play a scripted match (`src/mock/mockServer.ts`) and do not exist on codel.space. Local setup is in [docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md).

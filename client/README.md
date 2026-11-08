# CODEL client (Owner B)

Vite + TypeScript + HTML/CSS. No framework. This replaces the old React placeholders in `client/`.

```bash
npm install          # from the repo root (npm workspaces)
npm run dev          # server on :3001 and client on :5173
npm run dev -w client  # client only
```

Flow: Home → PLAY → Select Character → PLAY opens the options box → game screen.

- Guarded pages (`/select`, `/game`) only open via in-app buttons. Typing the URL goes home (`src/router.ts`).
- Characters: `src/characters.ts`, art in `public/assets/characters/<id>/`.
- Pages are in `src/pages/`. Add new screens in `src/router.ts`.

## Playing a match

- **Quick Match** joins the server queue (`queue:join`). Open two browser windows to play yourself.
- **No server:** set `VITE_USE_MOCK=true` in the root `.env`, and every Quick Match plays the scripted mock (`src/mock/mockServer.ts`).
- **Test codes (dev builds only):** PLAY → JOIN FRIEND, then enter one of these:
  - `TEST01`: every question type. Ends on time's up, or on a knockout.
  - `TEST02`: knockout. Both players start at 30 HP.
  - `TEST03`: forfeit. The opponent leaves after round 2.

  Remove them before launch (`TEST_CODES` in `src/popup.ts`).
- **Private match:** one player presses CREATE LOBBY and shares the 5-character code, the other enters it in JOIN FRIEND. Codes last 10 minutes.
- **Pacing** comes from the server: the stage intro plays during the 4 s start delay, results stay up for the 2.5 s gap (5 s after an ultimate), and `match:end` follows 3 s after the last result.

## Where things are

- `src/net/socket.ts`, `src/net/session.ts`: the connection and the current match. Closing the socket is how you leave. During a match that counts as a forfeit.
- `src/match/battle.ts`: question and code panels, input for each question type, timer, HP, combo, ultimate, and the "Did you mean" hint.
- `src/match/attacks.ts`, `src/match/battleAudio.ts`: on a hit, the attacker's attack GIF (`assets/characters/<id>/attack-{left,right}.gif`) and attack sound (`assets/audio/attacks/`) start together. The sound is picked by hit size: light, medium, heavy, ultimate = variants 1 to 4. Battle music (`assets/audio/battle/`) loops at 25% volume after the intro.
- `src/match/cutscene.ts`: the winner's finisher, `assets/video/cutscenes/<winner>_vs_<loser>.mp4`. It plays once per match: right after the knockout blow, or after the TIME'S UP callout for a win on time. There is none for a draw, a forfeit or a mirror match. SKIP, Esc, Enter or Space skips it.
- `src/match/endScreen.ts`: the result and the post-match review, shown after the cutscene.

## Known gaps

- Lobby matches: the server's lobby events carry no character, so the opponent's character is unknown (shown as Glitch, and no cutscene). Needs `characterId` on `lobby:create` / `lobby:join` (Owner A, `shared/`).

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
- Create Lobby shows a lobby code, but the server has no lobbies yet, so nobody can join it. Join Friend only shows in dev builds.

## Where things are

- `src/net/socket.ts`, `src/net/session.ts`: the connection and the current match. Closing the socket is how you leave. During a match that counts as a forfeit.
- `src/match/battle.ts`: question and code panels, input for each question type, timer, HP, combo, ultimate, and the "Did you mean" hint. The `CUTSCENE` note in `onResult` marks where attack, hit and ultimate cutscenes go.
- `src/match/endScreen.ts`: the result and the post-match review.

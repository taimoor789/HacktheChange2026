# C.O.D.E.L UI prototype

Standalone Vite + TypeScript + HTML/CSS front end (UI and transitions only, no backend).

```bash
cd codel-ui
npm install
npm run dev
```

Flow: Home → PLAY → Select Character → PLAY opens the options box (Quick Match / Join Friend / Create Lobby) → game screen.

- **Test code:** in **Join Friend**, enter `TEST01` to load the game screen without a second player
  (see `TEST_GAME_CODE` in `src/popup.ts`; remove before launch).
- Guarded pages (`/select`, `/game`) only open via in-app buttons; typing the URL returns home (`src/router.ts`).
- Game screen panels are empty slots for the backend: `[data-slot="question"]` and `[data-slot="code"]` (`src/pages/game.ts`).
- Characters: `src/characters.ts`, art in `public/assets/characters/<id>/`.

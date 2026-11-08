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

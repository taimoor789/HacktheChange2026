# Contributing (3 people, no merge conflicts)

## Rules
1. **Stay in your folders** (see README table). That alone prevents almost all conflicts.
2. **Work on your own branch:** A = `owner-a/engine`, B = `owner-b/ui`, C = `owner-c/questions`.
   Make sub-branches (e.g. `owner-b/battle-screen`) if you like.
3. **Merge to `main` often** (small PRs, at least every couple of hours) so integration problems show up early.
4. **Pull `main` into your branch before you start and before you merge:**
   ```bash
   git checkout owner-c/questions
   git pull origin main
   ```
5. **`shared/` and root config changes** go in their own small PR titled `contract: ...`. Tell the
   other two owners in chat first, and wait for their OK.
6. **Dependencies:** install only into your workspace: `npm i some-pkg -w server` or `-w client`.
7. **`package-lock.json` conflicts:** take main's version (`git checkout --theirs package-lock.json`
   or `git checkout origin/main -- package-lock.json`), then run `npm install` and commit.
8. Don't reformat files you don't own. Run `npm run format` only on your own folder.

## First-time setup
```bash
git clone https://github.com/taimoor789/HacktheChange2026
cd HacktheChange2026
npm install
git checkout owner-X/yourbranch
npm run dev
```

## Integration points
- A calls C: `getNextQuestion`, `toPublicQuestion`, `isCorrect`, `getTimerSeconds` (`server/src/questions/`).
- B consumes A's events exactly as typed in `shared/src/events.ts` (use the mock server until A is ready).

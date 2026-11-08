import { defineConfig } from 'vite';

export default defineConfig({
  // Read VITE_SERVER_URL and VITE_USE_MOCK from the repo root .env (see .env.example).
  envDir: '..',
  server: { port: 5173 },
});

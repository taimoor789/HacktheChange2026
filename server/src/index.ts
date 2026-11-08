// OWNER A: server boot (Express + Socket.IO).
// Responsible for: starting the HTTP server and wiring socket events to matchmaking.
// Others expect: the typed event contract from @beatcode/shared; B connects to PORT (default 3001).
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@beatcode/shared';
import { attachGame } from './gameServer';

const PORT = Number(process.env.PORT ?? 3001);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const httpServer = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: CLIENT_ORIGIN },
});

attachGame(io);

httpServer.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));

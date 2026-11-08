// OWNER A: matchmaking queue.
// Responsible for: holding waiting players and pairing the next two (or a bot if vsBot).
// Others expect: B receives `match:found` once paired; no ELO, just first-come pairing.
import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  QueueJoinPayload,
  ServerToClientEvents,
} from '@beatcode/shared';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

// TODO(OWNER A): store waiting players and pair them into a Match (see match.ts).
const queue: { socketId: string; payload: QueueJoinPayload }[] = [];

export function joinQueue(_io: IO, socket: Sock, payload: QueueJoinPayload): void {
  // TODO(OWNER A): if payload.vsBot, create a Match against the bot right away.
  queue.push({ socketId: socket.id, payload });
}

export function leaveQueue(socketId: string): void {
  const i = queue.findIndex((q) => q.socketId === socketId);
  if (i >= 0) queue.splice(i, 1);
}

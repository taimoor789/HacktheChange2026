// OWNER B: typed client socket (real Socket.IO or the mock server).
// Responsible for: one `socket` object the UI uses; VITE_USE_MOCK=true swaps in the scripted mock.
// Expects: event names/payloads from @beatcode/shared only.
import { io } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@beatcode/shared';
import { createMockSocket } from './mock/mockServer';

/** Minimal surface the UI needs; both the real socket and the mock satisfy it. */
export interface GameSocket {
  on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): void;
  off<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): void;
  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): void;
}

const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const socket: GameSocket = useMock
  ? createMockSocket()
  : (io(import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001') as unknown as GameSocket);

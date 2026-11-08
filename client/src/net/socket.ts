/**
 * One connection to the game server per queue attempt.
 *
 * The server has no "leave queue" or "leave match" event: closing the socket is how you
 * leave. Leaving the queue drops you from it; leaving a match is a forfeit.
 *
 * VITE_USE_MOCK=true (repo root .env) swaps in the scripted mock match for every queue.
 */
import { io } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@beatcode/shared';
import type { MockScenario } from '../mock/mockServer';

export interface GameSocket {
  on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): void;
  off<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): void;
  emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>): void;
  disconnect(): void;
}

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

/** Open a socket. Pass a scenario to force the mock match (test codes). */
export async function openSocket(mock?: MockScenario): Promise<GameSocket> {
  if (mock || USE_MOCK) {
    // Separate chunk: the mock holds answers, so it only loads when it is used.
    const { createMockSocket } = await import('../mock/mockServer');
    return createMockSocket(mock ?? 'full');
  }
  return io(SERVER_URL) as unknown as GameSocket;
}

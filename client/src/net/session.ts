/**
 * The current match, shared between the select page (queue) and the game page (battle).
 *
 * The server starts round 1 right after match:found, while the page is still changing,
 * so every server event is kept in order and replayed to the battle screen when it mounts.
 */
import { CLIENT_EVENTS, SERVER_EVENTS, type MatchFoundPayload, type ServerToClientEvents } from '@beatcode/shared';
import type { MockScenario } from '../mock/mockServer';
import { openSocket, type GameSocket } from './socket';

export type ServerEvent = {
  [E in keyof ServerToClientEvents]: { type: E; payload: Parameters<ServerToClientEvents[E]>[0] };
}[keyof ServerToClientEvents];

export interface MatchSession {
  found: MatchFoundPayload;
  /** Replays every event so far, then forwards new ones. Returns an unsubscribe. */
  listen(fn: (e: ServerEvent) => void): () => void;
  submit(round: number, questionId: string, answer: string): void;
  /** Close the connection. During a match the server counts this as a forfeit. */
  leave(): void;
}

let current: MatchSession | null = null;

export function currentMatch() {
  return current;
}

/**
 * Join the queue. `onFound` runs once on match:found. The returned function leaves the
 * queue (it does nothing once a match was found; use the session's `leave` then).
 */
export function joinQueue(
  player: { name: string; characterId: string },
  onFound: (s: MatchSession) => void,
  mock?: MockScenario,
): () => void {
  let socket: GameSocket | null = null;
  let cancelled = false;
  let matched = false;
  const log: ServerEvent[] = [];
  const listeners = new Set<(e: ServerEvent) => void>();

  const push = (e: ServerEvent) => {
    log.push(e);
    listeners.forEach((fn) => fn(e));
  };

  void openSocket(mock).then((s) => {
    if (cancelled) return s.disconnect();
    socket = s;
    for (const type of Object.values(SERVER_EVENTS)) {
      s.on(type, ((payload: never) => {
        if (type === SERVER_EVENTS.MATCH_FOUND && !matched) {
          matched = true;
          const session: MatchSession = {
            found: payload as MatchFoundPayload,
            listen(fn) {
              log.forEach(fn);
              listeners.add(fn);
              return () => listeners.delete(fn);
            },
            submit(round, questionId, answer) {
              s.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { matchId: session.found.matchId, round, questionId, answer });
            },
            leave() {
              listeners.clear();
              s.disconnect();
              if (current === session) current = null;
            },
          };
          current = session;
          onFound(session);
          return;
        }
        if (matched) push({ type, payload } as ServerEvent);
      }) as never);
    }
    s.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: player.name, characterId: player.characterId });
  });

  return () => {
    if (matched) return;
    cancelled = true;
    socket?.disconnect();
  };
}

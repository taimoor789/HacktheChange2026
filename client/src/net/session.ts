/**
 * Finding a match (queue, private lobby, or the dev mock) and the current match itself,
 * shared between the select page and the game page.
 *
 * The game page mounts a moment after match:found, so every server event of the match is
 * kept in order and replayed to the battle screen when it mounts.
 */
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LobbyClosedReason,
  type LobbyErrorReason,
  type MatchFoundPayload,
  type ServerToClientEvents,
} from '@beatcode/shared';
import { CHARACTERS } from '../characters';
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
  /** After the match: ask to swap LinkedIn links with the opponent. */
  connect(targetPlayerId: string): void;
  /** Close the connection. During a match the server counts this as a forfeit. */
  leave(): void;
}

export type MatchRequest =
  | { kind: 'queue' }
  | { kind: 'create' }
  | { kind: 'join' }
  | { kind: 'mock'; scenario: MockScenario };

export interface FindHooks {
  onFound(s: MatchSession): void;
  onLobbyCreated?(code: string): void;
  onLobbyClosed?(reason: LobbyClosedReason): void;
  onLobbyError?(reason: LobbyErrorReason): void;
}

export interface Finder {
  /** Join a lobby by code (kind 'join'). Retries reuse the same connection. */
  join(code: string): void;
  /** Stop looking (leaves the queue or closes the lobby). Does nothing once a match was found. */
  cancel(): void;
}

let current: MatchSession | null = null;

export function currentMatch() {
  return current;
}

const known = (id: string) => CHARACTERS.some((c) => c.id === id);

export function findMatch(
  player: { name: string; characterId: string; linkedin?: string },
  req: MatchRequest,
  hooks: FindHooks,
): Finder {
  let socket: GameSocket | null = null;
  let cancelled = false;
  let matched = false;
  let pendingCode: string | null = null;
  const log: ServerEvent[] = [];
  const linkedinUrl = player.linkedin || undefined;
  const listeners = new Set<(e: ServerEvent) => void>();

  const sendJoin = (s: GameSocket, code: string) =>
    s.emit(CLIENT_EVENTS.LOBBY_JOIN, { code, displayName: player.name, characterId: player.characterId, linkedinUrl });

  void openSocket(req.kind === 'mock' ? req.scenario : undefined).then((s) => {
    if (cancelled) return s.disconnect();
    socket = s;

    s.on(SERVER_EVENTS.LOBBY_CREATED, (p) => hooks.onLobbyCreated?.(p.code));
    s.on(SERVER_EVENTS.LOBBY_CLOSED, (p) => hooks.onLobbyClosed?.(p.reason));
    s.on(SERVER_EVENTS.LOBBY_ERROR, (p) => hooks.onLobbyError?.(p.reason));

    const matchEvents = [
      SERVER_EVENTS.ROUND_START,
      SERVER_EVENTS.ROUND_RESULT,
      SERVER_EVENTS.ANSWER_HINT,
      SERVER_EVENTS.ULTIMATE_READY,
      SERVER_EVENTS.MATCH_END,
      SERVER_EVENTS.CONNECT_UPDATE,
    ] as const;
    for (const type of matchEvents) {
      s.on(type, ((payload: never) => {
        if (!matched) return;
        const e = { type, payload } as ServerEvent;
        log.push(e);
        listeners.forEach((fn) => fn(e));
      }) as never);
    }

    s.on(SERVER_EVENTS.MATCH_FOUND, (found) => {
      if (matched) return;
      matched = true;
      // Lobby events carry characterId now; an older server sends 'player', so fall back to our own pick.
      if (!known(found.you.characterId)) found = { ...found, you: { ...found.you, characterId: player.characterId } };
      const session: MatchSession = {
        found,
        listen(fn) {
          log.forEach(fn);
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        submit(round, questionId, answer) {
          s.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { matchId: found.matchId, round, questionId, answer });
        },
        connect(targetPlayerId) {
          s.emit(CLIENT_EVENTS.CONNECT_REQUEST, { matchId: found.matchId, targetPlayerId });
        },
        leave() {
          listeners.clear();
          s.disconnect();
          if (current === session) current = null;
        },
      };
      current = session;
      hooks.onFound(session);
    });

    if (req.kind === 'queue' || req.kind === 'mock') {
      s.emit(CLIENT_EVENTS.QUEUE_JOIN, { name: player.name, characterId: player.characterId, linkedinUrl });
    } else if (req.kind === 'create') {
      s.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: player.name, characterId: player.characterId, linkedinUrl });
    } else if (pendingCode) {
      sendJoin(s, pendingCode);
    }
  });

  return {
    join(code) {
      if (req.kind !== 'join' || matched || cancelled) return;
      if (socket) sendJoin(socket, code);
      else pendingCode = code;
    },
    cancel() {
      if (matched) return;
      cancelled = true;
      socket?.disconnect(); // the server drops us from the queue / closes our lobby
    },
  };
}

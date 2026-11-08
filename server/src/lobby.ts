import { randomInt } from 'node:crypto';

/** No 0, O, 1, I, or L. */
export const LOBBY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const LOBBY_JOIN_LIMIT = 5;
export const LOBBY_JOIN_WINDOW_MS = 60_000;

export function makeLobbyCode(taken: ReadonlySet<string>, draw: (max: number) => number = (max) => randomInt(max)): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += LOBBY_ALPHABET[draw(LOBBY_ALPHABET.length)] ?? '';
    if (code.length === 5 && !taken.has(code)) return code;
  }
  throw new Error('no free lobby code');
}

export function normalizeLobbyCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase();
}

/** Trim, drop control characters, keep 24 characters, otherwise "Player". */
export function sanitizeDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Player';
}

export function recentFailures(stamps: readonly number[], now: number): number[] {
  return stamps.filter((stamp) => now - stamp < LOBBY_JOIN_WINDOW_MS);
}

export function joinRateLimited(stamps: readonly number[], now: number): boolean {
  return recentFailures(stamps, now).length >= LOBBY_JOIN_LIMIT;
}

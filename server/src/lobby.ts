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
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Player';
}

/** A character id like "glitch" (letters, digits, _ or -, up to 32), otherwise "player". */
export function sanitizeCharacterId(raw: unknown): string {
  if (typeof raw !== 'string') return 'player';
  const id = raw.trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(id) ? id : 'player';
}

/** A canonical https://www.linkedin.com/in/... profile link, or null for anything else. */
export function sanitizeLinkedinUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text === '' || text.length > 200 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return /^\/in\/[^/]+$/.test(path) ? `https://www.linkedin.com${path}` : null;
}

export function recentFailures(stamps: readonly number[], now: number): number[] {
  return stamps.filter((stamp) => now - stamp < LOBBY_JOIN_WINDOW_MS);
}

export function joinRateLimited(stamps: readonly number[], now: number): boolean {
  return recentFailures(stamps, now).length >= LOBBY_JOIN_LIMIT;
}

/**
 * Player choices shared between pages. Saved to localStorage so a refresh
 * keeps them (falls back to memory if storage is blocked).
 */
export interface PlayerState {
  name: string;
  characterId: string;
  /** Optional profile link, shared only after both players press Connect. */
  linkedin: string;
}

const KEY = 'codel.player';
export const NAME_MAX = 12;

let state: PlayerState = { name: '', characterId: '', linkedin: '' };
try {
  const saved = localStorage.getItem(KEY);
  if (saved) state = { ...state, ...JSON.parse(saved) };
} catch {
  /* storage unavailable */
}

export function getPlayer(): PlayerState {
  return { ...state };
}

export function setPlayer(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

/** Uppercase, pixel-font-safe characters only. */
export function cleanName(raw: string) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9_\-. ]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, NAME_MAX);
}

/** A canonical https://www.linkedin.com/in/... profile link, or null for anything else. */
export function cleanLinkedin(raw: string): string | null {
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

/**
 * Player choices shared between pages. Saved to localStorage so a refresh
 * keeps them (falls back to memory if storage is blocked).
 */
export interface PlayerState {
  name: string;
  characterId: string;
}

const KEY = 'codel.player';
export const NAME_MAX = 12;

let state: PlayerState = { name: '', characterId: '' };
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

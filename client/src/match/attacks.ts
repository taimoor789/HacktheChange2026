/**
 * Plays a character's attack GIF once on their fighter, then returns to idle.
 *
 * A GIF only restarts reliably from a fresh URL, so each file is fetched once and every
 * play gets its own blob: URL (no network after the first load).
 */
import type { Character } from '../characters';

/** Length of every attack-right.gif (18 frames). */
export const ATTACK_MS = 1280;
/** Roughly when the blow lands, used to time the health bar drop. */
export const ATTACK_HIT_MS = 640;

const blobs = new Map<string, Promise<Blob | null>>();

const attackSrc = (c: Character) => `/assets/characters/${c.id}/attack-right.gif`;

export function preloadAttack(c: Character) {
  if (!c.attack) return Promise.resolve(null);
  let p = blobs.get(c.id);
  if (!p) {
    p = fetch(attackSrc(c))
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
    blobs.set(c.id, p);
  }
  return p;
}

/**
 * Swap the fighter's idle sprite for the attack for one play.
 * Resolves when it has finished (or at once if the character has no attack art).
 */
export async function playAttack(fighter: HTMLElement, c: Character, opts: { ultimate?: boolean } = {}) {
  const blob = await preloadAttack(c);
  const idle = fighter.querySelector<HTMLImageElement>('.sprite--art:not(.sprite--attack)');
  if (!blob || !idle) return;

  fighter.querySelector('.sprite--attack')?.remove(); // a newer attack replaces an unfinished one
  const url = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.className = `sprite sprite--art sprite--attack ${fighter.classList.contains('fighter--p2') ? 'is-mirrored' : ''}`;
  img.alt = '';
  img.draggable = false;
  img.src = url;
  await img.decode().catch(() => {});

  fighter.append(img);
  fighter.classList.add('is-attacking');
  fighter.classList.toggle('is-ultimate', !!opts.ultimate);
  await new Promise((r) => setTimeout(r, ATTACK_MS));
  if (img.isConnected) {
    img.remove();
    fighter.classList.remove('is-attacking', 'is-ultimate');
  }
  URL.revokeObjectURL(url);
}

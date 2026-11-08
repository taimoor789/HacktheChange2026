/**
 * Finisher cutscenes: /assets/video/cutscenes/<winner>_vs_<loser>.mp4
 * (12 files, 7.5 s, 1280x720, with their own sound). Played once per match, for the winner,
 * after a knockout or a win on time. There is none for a draw, a forfeit, a mirror match,
 * or a character without art.
 */
import { CHARACTERS } from '../characters';

/** Every cutscene file is this long; used as a safety timeout. */
export const CUTSCENE_MS = 7500;

const HAS_CUTSCENES = new Set(['bram', 'glitch', 'null', 'skye']);

export function cutsceneSrc(winnerCharId: string, loserCharId: string): string | null {
  if (winnerCharId === loserCharId) return null;
  if (!HAS_CUTSCENES.has(winnerCharId) || !HAS_CUTSCENES.has(loserCharId)) return null;
  if (!CHARACTERS.some((c) => c.id === winnerCharId)) return null;
  return `/assets/video/cutscenes/${winnerCharId}_vs_${loserCharId}.mp4`;
}

const preloaded = new Map<string, HTMLVideoElement>();

/** Start downloading both possible endings for this pairing so they play at once. */
export function preloadCutscenes(a: string, b: string) {
  for (const src of [cutsceneSrc(a, b), cutsceneSrc(b, a)]) {
    if (!src || preloaded.has(src)) continue;
    const v = document.createElement('video');
    v.preload = 'auto';
    v.src = src;
    v.load();
    preloaded.set(src, v);
  }
}

/**
 * Play a cutscene over `host`. Resolves when it ends or is skipped
 * (SKIP button, Esc, Enter or Space). Never rejects.
 */
export function playCutscene(host: HTMLElement, src: string): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('section');
    root.className = 'cutscene';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Finisher cutscene');

    const video = preloaded.get(src) ?? document.createElement('video');
    preloaded.delete(src);
    video.className = 'cutscene__video';
    video.playsInline = true;
    video.preload = 'auto';
    if (!video.src) video.src = src;
    video.currentTime = 0;

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'cutscene__skip';
    skip.textContent = 'SKIP >';

    root.append(video, skip);
    host.append(root);

    let done = false;
    let safety = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safety);
      window.removeEventListener('keydown', onKey, true);
      video.pause();
      root.classList.add('is-out');
      window.setTimeout(() => {
        root.remove();
        video.removeAttribute('src');
        video.load();
      }, 200);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        finish();
      }
    };
    window.addEventListener('keydown', onKey, true);
    skip.addEventListener('click', finish);
    video.addEventListener('ended', finish);
    video.addEventListener('error', finish);
    // if the file stalls, don't hold the end screen forever
    safety = window.setTimeout(finish, CUTSCENE_MS + 4000);

    video.muted = false;
    void video.play().catch(() => {
      // sound not allowed here: play it muted rather than not at all
      video.muted = true;
      void video.play().catch(finish);
    });
    skip.focus({ preventScroll: true });
  });
}

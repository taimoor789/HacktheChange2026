import { CHARACTERS, characterSprite, findCharacter, preloadCharacter } from '../characters';
import { openPopup } from '../popup';
import { getPlayer } from '../state';
import type { Page } from '../types';
import { html, videoReady, withTimeout } from '../util';

/**
 * In-game screen (1v1 coding duel). UI template only — no game logic.
 *
 *  MAIN (top 3/4): fighting stage — health bars, clock, fighters on the ground line
 *  BOTTOM (1/4):   empty QUESTION | CODE panels for the backend to fill
 *                  (`[data-slot="question"]`, `[data-slot="code"]`)
 *
 * Sequence: the stage's ENTRY video plays once (green code -> environment)
 * with the entry sound; the UI slides in once the code has cleared (~3.6s);
 * when the entry ends we hand off to the stage's LOOP.
 */

const STAGES = ['grassy-mountains', 'pink-forest', 'river-waterfall', 'fire-forest'] as const;
const stageSrc = (s: string, part: 'entry' | 'loop') => `/assets/video/scenes/${s}-${part}.mp4`;
const stagePoster = (s: string) => `/assets/video/scenes/${s}-poster.jpg`;

/** When the code has fully turned into scenery in every entry video. */
const UI_IN_AT = 3.6;

const entrySfx = new Audio('/assets/audio/game-entry.mp3');
entrySfx.preload = 'auto';
entrySfx.volume = 0.6;

export function createPage(): Page {
  const player = getPlayer();
  const me = findCharacter(player.characterId);
  const others = CHARACTERS.filter((c) => c.id !== me.id);
  const opponent = others[Math.floor(Math.random() * others.length)] ?? me;
  const stage = STAGES[Math.floor(Math.random() * STAGES.length)];

  const el = html(`
    <section class="page game" data-stage="${stage}">
      <video class="game__bg game__bg--loop" muted loop playsinline preload="auto"
             poster="${stagePoster(stage)}" aria-hidden="true"></video>
      <video class="game__bg game__bg--entry" muted playsinline preload="auto" aria-hidden="true"></video>
      <div class="game__shade" aria-hidden="true"></div>

      <!-- MAIN: fight stage -->
      <header class="fhud">
        <div class="fhud__side fhud__side--p1">
          <div class="fhud__portrait ${me.art ? 'is-art' : ''}">${characterSprite(me, 'right', 'still')}</div>
          <div class="fhud__meter">
            <div class="fhud__health"><i></i></div>
            <p class="fhud__name"></p>
          </div>
        </div>

        <div class="fhud__timer" aria-label="Time">00:00</div>

        <div class="fhud__side fhud__side--p2">
          <div class="fhud__meter">
            <div class="fhud__health"><i></i></div>
            <p class="fhud__name">OPPONENT</p>
          </div>
          <div class="fhud__portrait ${opponent.art ? 'is-art' : ''}">${characterSprite(opponent, 'left', 'still')}</div>
        </div>
      </header>

      <!-- P1 on the left faces right, P2 on the right faces left -->
      <div class="fighter fighter--p1 ${me.art ? 'is-art' : ''}">${characterSprite(me, 'right')}</div>
      <div class="fighter fighter--p2 ${opponent.art ? 'is-art' : ''}">${characterSprite(opponent, 'left')}</div>

      <button class="btn-back game__quit" type="button" aria-label="Leave match">&lt;</button>

      <!-- BOTTOM 1/4: empty panels, filled by the backend -->
      <div class="desk">
        <section class="pane">
          <p class="pane__label">QUESTION</p>
          <div class="pane__body" data-slot="question"></div>
        </section>
        <section class="pane">
          <p class="pane__label">CODE</p>
          <div class="pane__body" data-slot="code"></div>
        </section>
      </div>
    </section>
  `);

  el.querySelector('.fhud__side--p1 .fhud__name')!.textContent = player.name || 'PLAYER';

  /* ---------- stage: entry once, then loop ---------- */
  const entry = el.querySelector<HTMLVideoElement>('.game__bg--entry')!;
  const loop = el.querySelector<HTMLVideoElement>('.game__bg--loop')!;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  entry.src = stageSrc(stage, 'entry');
  loop.src = stageSrc(stage, 'loop');

  entry.addEventListener('ended', () => {
    loop.currentTime = 0;
    void loop.play().catch(() => {});
    entry.hidden = true;
  });

  /* ---------- UI reveal ---------- */
  const showUI = () => el.classList.add('is-live');
  entry.addEventListener('timeupdate', () => {
    if (entry.currentTime >= UI_IN_AT) showUI();
  });

  /* ---------- quit ---------- */
  let closePopup: (() => void) | null = null;
  el.querySelector('.game__quit')!.addEventListener('click', () => {
    closePopup = openPopup('quit', el, () => (closePopup = null));
  });

  const ready = withTimeout(
    Promise.all([
      videoReady(entry),
      videoReady(loop),
      preloadCharacter(me, ['right']),
      preloadCharacter(opponent, ['left']),
    ]),
    8000,
  );

  let started = false;
  let fallback = 0;
  return {
    el,
    ready,
    onShow() {
      if (started) return;
      started = true;
      if (reduce) {
        entry.hidden = true;
        void loop.play().catch(() => {});
        showUI();
        return;
      }
      void entry.play().catch(() => {});
      entrySfx.currentTime = 0;
      void entrySfx.play().catch(() => {});
      fallback = window.setTimeout(showUI, (UI_IN_AT + 1) * 1000); // if timeupdate stalls
    },
    destroy() {
      clearTimeout(fallback);
      closePopup?.();
      entrySfx.pause();
      for (const v of [entry, loop]) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
  };
}

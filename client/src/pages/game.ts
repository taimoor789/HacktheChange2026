import { CHARACTERS, characterSprite, findCharacter, preloadCharacter } from '../characters';
import { mountBattle } from '../match/battle';
import { renderEndScreen } from '../match/endScreen';
import { currentMatch } from '../net/session';
import { openPopup } from '../popup';
import { navigate } from '../router';
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

/** Time the end callout (K.O. / time's up / opponent left) stays on the stage. */
const END_SCREEN_DELAY_MS = 1800;

const entrySfx = new Audio('/assets/audio/game-entry.mp3');
entrySfx.preload = 'auto';
entrySfx.volume = 0.6;

export function createPage(): Page {
  const session = currentMatch();
  const player = getPlayer();
  const you = session?.found.you;
  const opp = session?.found.opponent;
  const me = findCharacter(you?.characterId ?? player.characterId);
  const others = CHARACTERS.filter((c) => c.id !== me.id);
  // The real opponent from match:found; a random one only when there is no match (old TEST01 path).
  const opponent = opp ? findCharacter(opp.characterId) : (others[Math.floor(Math.random() * others.length)] ?? me);
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
            <div class="fhud__health" role="img"><i></i></div>
            <div class="fhud__ult" role="img"><i></i></div>
            <div class="fhud__row"><p class="fhud__name"></p><p class="fhud__combo"></p></div>
          </div>
        </div>

        <div class="fhud__timer" aria-label="Time">00:00</div>

        <div class="fhud__side fhud__side--p2">
          <div class="fhud__meter">
            <div class="fhud__health" role="img"><i></i></div>
            <div class="fhud__ult" role="img"><i></i></div>
            <div class="fhud__row"><p class="fhud__name"></p><p class="fhud__combo"></p></div>
          </div>
          <div class="fhud__portrait ${opponent.art ? 'is-art' : ''}">${characterSprite(opponent, 'left', 'still')}</div>
        </div>
      </header>

      <!-- P1 on the left faces right, P2 on the right faces left -->
      <div class="fighter fighter--p1 ${me.art ? 'is-art' : ''}">${characterSprite(me, 'right')}</div>
      <div class="fighter fighter--p2 ${opponent.art ? 'is-art' : ''}">${characterSprite(opponent, 'left')}</div>

      <button class="btn-back game__quit" type="button" aria-label="Leave match">&lt;</button>

      <!-- round results and ultimate callouts (text only; cutscenes go in battle.ts) -->
      <div class="game__banner" aria-live="polite"></div>

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

  el.querySelector('.fhud__side--p1 .fhud__name')!.textContent = you?.name || player.name || 'PLAYER';
  el.querySelector('.fhud__side--p2 .fhud__name')!.textContent = opp?.name || 'OPPONENT';

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

  /* ---------- the match ---------- */
  let endTimer = 0;
  const unmountBattle = session
    ? mountBattle(el, session, {
        onEnd: (p) => {
          // CUTSCENE: the KO animation for hp_zero plays here, before the end screen opens.
          endTimer = window.setTimeout(() => {
            closePopup?.();
            const screen = renderEndScreen(p, session.found.you.id, navigate);
            el.append(screen.el);
            el.classList.add('is-over');
            screen.focus();
          }, END_SCREEN_DELAY_MS);
        },
      })
    : null;

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
      // The server starts round 1 right after match:found, so a live match shows the HUD at once.
      if (session) showUI();
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
      clearTimeout(endTimer);
      closePopup?.();
      unmountBattle?.();
      session?.leave(); // leaving the game page closes the connection (a forfeit mid-match)
      entrySfx.pause();
      for (const v of [entry, loop]) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
  };
}

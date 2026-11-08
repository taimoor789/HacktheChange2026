import { CHARACTERS, characterSprite, findCharacter, preloadCharacter } from '../characters';
import { mountBattle } from '../match/battle';
import { ATTACK_MS } from '../match/attacks';
import { battleMusic } from '../match/battleAudio';
import { cutsceneSrc, playCutscene, preloadCutscenes } from '../match/cutscene';
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
 * when the entry ends we hand off to the stage's LOOP. The intro fits in the
 * server's MATCH_START_DELAY_MS, so round 1 arrives as the HUD slides in.
 */

const STAGES = ['grassy-mountains', 'pink-forest', 'river-waterfall', 'fire-forest'] as const;
const stageSrc = (s: string, part: 'entry' | 'loop') => `/assets/video/scenes/${s}-${part}.mp4`;
const stagePoster = (s: string) => `/assets/video/scenes/${s}-poster.jpg`;

/** When the code has fully turned into scenery in every entry video. */
const UI_IN_AT = 3.6;

/** Time the end callout (K.O. / time's up / opponent left) stays on the stage. */
const END_SCREEN_DELAY_MS = 1800;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

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
  let musicOn = false;
  const showUI = () => {
    el.classList.add('is-live');
    // battle music starts once the intro (and its entry sound) has cleared
    if (session && !musicOn && !el.classList.contains('is-over')) {
      musicOn = true;
      battleMusic.play(1500);
    }
  };
  entry.addEventListener('timeupdate', () => {
    if (entry.currentTime >= UI_IN_AT) showUI();
  });

  /* ---------- the match ---------- */
  // The intro plays during the server's start delay (match:found -> round:start).
  // If round 1 arrives before the intro has cleared (slow load), show the HUD then.
  let pageShown = false;
  let roundStarted = false;
  let destroyed = false;

  /* ---------- finisher cutscene: once per match, for the winner ---------- */
  // Knockout: starts when the KO blow's attack GIF ends (match:end arrives 3 s later, during it).
  // Win on time (tiers_complete / max_rounds): after the TIME'S UP callout.
  // None for a draw, a forfeit (the opponent left), a mirror match or an unknown character.
  let cutscene: Promise<void> | null = null;
  const charOf = (id: string) => (id === you?.id ? you.characterId : opp?.characterId ?? '');
  function runCutscene(winnerId: string, delayMs: number) {
    const loserId = winnerId === you?.id ? opp?.id : you?.id;
    const src = loserId ? cutsceneSrc(charOf(winnerId), charOf(loserId)) : null;
    if (!src || cutscene) return;
    cutscene = wait(delayMs).then(() => {
      if (destroyed) return;
      closePopup?.();
      battleMusic.stop(300); // the cutscene has its own sound
      return playCutscene(el, src);
    });
  }
  if (you && opp) preloadCutscenes(you.characterId, opp.characterId);

  const unmountBattle = session
    ? mountBattle(el, session, {
        onRoundStart: () => {
          roundStarted = true;
          if (pageShown) showUI();
        },
        onKnockout: (winnerId) => {
          if (winnerId) runCutscene(winnerId, ATTACK_MS);
        },
        onEnd: (p) => {
          if (p.winnerId && (p.reason === 'tiers_complete' || p.reason === 'max_rounds')) {
            runCutscene(p.winnerId, END_SCREEN_DELAY_MS);
          }
          void (cutscene ?? wait(END_SCREEN_DELAY_MS)).then(() => {
            if (destroyed) return;
            battleMusic.stop(800);
            closePopup?.();
            const screen = renderEndScreen(p, session.found.you.id, navigate, session);
            el.append(screen.el);
            el.classList.add('is-over');
            screen.focus();
          });
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
      pageShown = true;
      if (roundStarted) showUI();
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
      destroyed = true;
      clearTimeout(fallback);
      closePopup?.();
      unmountBattle?.();
      session?.leave(); // leaving the game page closes the connection (a forfeit mid-match)
      battleMusic.stop();
      entrySfx.pause();
      for (const v of [entry, loop]) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
  };
}

import type { Page } from '../types';
import { Music } from '../music';
import { html, imageReady, videoReady, withTimeout } from '../util';

const BG = {
  landscape: {
    video: '/assets/video/bg-loop-desktop.mp4',
    poster: '/assets/img/bg-poster-desktop.jpg',
  },
  portrait: {
    video: '/assets/video/bg-loop-mobile.mp4',
    poster: '/assets/img/bg-poster-mobile.jpg',
  },
};
const LOGO = '/assets/img/logo.png';
const PLAY_BTN = '/assets/img/btn-play.png';

/** Quiet slow-piano loop for the main page. */
// 8 bars at 66 BPM: trims the encoder padding at the end of the file
const homeMusic = new Music('/assets/audio/home-music.m4a', 0.22, { loopSeconds: 8 * 4 * (60 / 66) });

/** Sound for the home page PLAY button. Lives at module level so it keeps
 *  playing through the transition after the home page is torn down. */
const homeButtonSfx = new Audio('/assets/audio/home-button.m4a');
homeButtonSfx.preload = 'auto';

function playHomeButtonSfx() {
  homeMusic.stop(400); // fade the piano out during the flash
  homeButtonSfx.currentTime = 0;
  void homeButtonSfx.play().catch(() => {});
}

/** Max time to sit on the loading screen before showing the page anyway (poster image covers it). */
const MAX_WAIT = 6000;

export function createPage(): Page {
  const el = html(`
    <section class="page home">
      <video class="home__bg" autoplay muted loop playsinline preload="auto" aria-hidden="true"></video>
      <div class="home__shade" aria-hidden="true"></div>

      <div class="home__content">
        <h1 class="home__logo">
          <img src="${LOGO}" alt="C.O.D.E.L — Compete Online: Debug, Execute, LARP" draggable="false" />
        </h1>

        <nav class="home__menu">
          <button class="btn-slot btn-slot--play has-art" data-nav="/select" data-no-music-unlock
                  type="button" aria-label="Play" style="--art: url(${PLAY_BTN})">
            <span class="btn-slot__label">PLAY</span>
          </button>
        </nav>
      </div>
    </section>
  `);

  const video = el.querySelector('video')!;
  el.querySelector('.btn-slot--play')!.addEventListener('click', playHomeButtonSfx);
  const portrait = window.matchMedia('(orientation: portrait)');

  const setSource = () => {
    const bg = portrait.matches ? BG.portrait : BG.landscape;
    if (video.getAttribute('src') === bg.video) return;
    video.poster = bg.poster;
    video.src = bg.video;
    void video.play().catch(() => {});
  };
  setSource();
  portrait.addEventListener('change', setSource);

  // Ready when the logo has loaded and the video can play (or after MAX_WAIT).
  const ready = withTimeout(
    Promise.all([imageReady(LOGO), imageReady(PLAY_BTN), videoReady(video)]),
    MAX_WAIT,
  );
  homeMusic.play();

  return {
    el,
    ready,
    destroy() {
      homeMusic.stop();
      portrait.removeEventListener('change', setSource);
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}

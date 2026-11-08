import { CHARACTERS, characterSprite, findCharacter, preloadCharacter } from '../characters';
import { openPopup, type PopupKind } from '../popup';
import { cleanName, getPlayer, NAME_MAX, setPlayer } from '../state';
import type { Page } from '../types';
import { html, withTimeout } from '../util';

/**
 * Character + name select. Pressing PLAY swaps the button for a red
 * options box (Quick Match / Join Friend / Create Lobby); each option
 * opens a square popup.
 */
export function createPage(): Page {
  const player = getPlayer();
  let index = Math.max(0, CHARACTERS.indexOf(findCharacter(player.characterId)));

  const el = html(`
    <section class="page screen select">
      <picture class="screen__binary" aria-hidden="true">
        <source media="(orientation: portrait)" srcset="/assets/overlays/binary-overlay-mobile.svg" />
        <img src="/assets/overlays/binary-overlay.svg" alt="" />
      </picture>
      <button class="btn-back" data-nav="/" type="button" aria-label="Back">&lt;</button>

      <div class="select__main">
        <h2 class="screen__title">SELECT CHARACTER</h2>

        <div class="select__picker">
          <button class="btn-arrow" data-dir="-1" type="button" aria-label="Previous character">&lt;</button>
          <div class="select__box">
            <div class="select__sprite"></div>
          </div>
          <button class="btn-arrow" data-dir="1" type="button" aria-label="Next character">&gt;</button>
        </div>
        <p class="select__char-name" aria-live="polite"></p>
        <div class="select__dots" aria-hidden="true"></div>

        <form class="select__row" novalidate>
          <label class="name-field">
            <span class="name-field__label">ENTER NAME</span>
            <input class="name-field__input" name="name" maxlength="${NAME_MAX}"
                   autocomplete="off" spellcheck="false" placeholder="PLAYER" />
          </label>

          <div class="play-slot">
            <button class="btn-slot btn-slot--select-play has-art" type="submit"
                    aria-label="Play" style="--art: url(/assets/img/btn-play-red.png)">
              <span class="btn-slot__label">PLAY</span>
            </button>

            <div class="options" hidden role="group" aria-label="Play options">
              <button class="options__close" type="button" aria-label="Close options">X</button>
              <button class="btn-slot btn-slot--quick has-art" data-popup="quick" type="button"
                      aria-label="Quick match" style="--art: url(/assets/img/btn-quick-match.png)">
                <span class="btn-slot__label">QUICK MATCH</span>
              </button>
              <p class="options__heading">PRIVATE</p>
              <button class="btn-slot btn-slot--join has-art" data-popup="join" type="button"
                      aria-label="Join friend" style="--art: url(/assets/img/btn-join-friend.png)">
                <span class="btn-slot__label">JOIN FRIEND</span>
              </button>
              <button class="btn-slot btn-slot--create has-art" data-popup="create" type="button"
                      aria-label="Create lobby" style="--art: url(/assets/img/btn-create-lobby.png)">
                <span class="btn-slot__label">CREATE LOBBY</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  `);

  const spriteEl = el.querySelector<HTMLElement>('.select__sprite')!;
  const nameEl = el.querySelector<HTMLElement>('.select__char-name')!;
  const dotsEl = el.querySelector<HTMLElement>('.select__dots')!;
  const input = el.querySelector<HTMLInputElement>('.name-field__input')!;
  const field = el.querySelector<HTMLElement>('.name-field')!;
  const form = el.querySelector('form')!;
  const playBtn = el.querySelector<HTMLButtonElement>('.btn-slot--select-play')!;
  const options = el.querySelector<HTMLElement>('.options')!;

  let closePopup: (() => void) | null = null;

  input.value = player.name;

  /* ---------- character carousel ---------- */
  function render(dir = 0) {
    const c = CHARACTERS[index];
    spriteEl.innerHTML = characterSprite(c, 'right');
    spriteEl.classList.toggle('is-art', !!c.art);
    spriteEl.classList.remove('slide-l', 'slide-r');
    if (dir) {
      void spriteEl.offsetWidth; // restart animation
      spriteEl.classList.add(dir > 0 ? 'slide-r' : 'slide-l');
    }
    nameEl.textContent = c.name;
    dotsEl.innerHTML = CHARACTERS.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('');
    setPlayer({ characterId: c.id });
  }

  function cycle(dir: number) {
    index = (index + dir + CHARACTERS.length) % CHARACTERS.length;
    render(dir);
  }

  el.querySelectorAll<HTMLButtonElement>('.btn-arrow').forEach((b) =>
    b.addEventListener('click', () => cycle(Number(b.dataset.dir))),
  );

  /* ---------- name ---------- */
  input.addEventListener('input', () => {
    const clean = cleanName(input.value);
    if (clean !== input.value) input.value = clean;
    field.classList.remove('is-error');
  });

  /** Save and return the name, or flag the field and return null. */
  function requireName() {
    const name = cleanName(input.value).trim();
    if (name) {
      setPlayer({ name });
      return name;
    }
    field.classList.remove('is-error');
    void field.offsetWidth;
    field.classList.add('is-error');
    input.focus();
    return null;
  }

  /* ---------- PLAY -> red options box ---------- */
  function showOptions() {
    playBtn.hidden = true;
    options.hidden = false;
    options.querySelector<HTMLElement>('[data-popup]')!.focus({ preventScroll: true });
    options.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function hideOptions() {
    options.hidden = true;
    playBtn.hidden = false;
    playBtn.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (requireName()) showOptions();
  });

  options.querySelector('.options__close')!.addEventListener('click', hideOptions);

  options.querySelectorAll<HTMLButtonElement>('[data-popup]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!requireName()) {
        hideOptions();
        input.focus();
        return;
      }
      closePopup = openPopup(b.dataset.popup as PopupKind, el, () => (closePopup = null));
    }),
  );

  /* ---------- keyboard ---------- */
  const onKey = (e: KeyboardEvent) => {
    if (closePopup) return; // popup handles its own keys
    if (e.key === 'Escape' && !options.hidden) return hideOptions();
    if (document.activeElement === input) return;
    if (e.key === 'ArrowLeft') cycle(-1);
    if (e.key === 'ArrowRight') cycle(1);
  };
  window.addEventListener('keydown', onKey);

  render();

  return {
    el,
    // wait for the first character's art; warm up the rest in the background
    ready: withTimeout(preloadCharacter(CHARACTERS[index], ['right']), 4000).then(() => {
      CHARACTERS.forEach((c) => void preloadCharacter(c, ['right']));
    }),
    destroy() {
      closePopup?.();
      window.removeEventListener('keydown', onKey);
    },
  };
}

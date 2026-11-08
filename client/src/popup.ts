/**
 * Square popups for the play options. The page behind is greyed out
 * and blocked until the popup is closed (button, Esc, or clicking outside).
 *
 * Quick Match joins the server queue and opens the game on match:found.
 * Join Friend and Create Lobby have no server support yet: Create Lobby is hidden and
 * Join Friend only shows in dev builds, for the test codes (see select.ts).
 */

import type { MockScenario } from './mock/mockServer';
import { joinQueue } from './net/session';
import { navigate } from './router';
import { getPlayer } from './state';

export type PopupKind = 'quick' | 'join' | 'create' | 'quit';

/**
 * TEST ONLY (dev builds): these codes in JOIN FRIEND play the scripted mock match alone.
 * TODO(OWNER B): remove before launch.
 */
export const TEST_CODES: Record<string, MockScenario> = {
  TEST01: 'full', // plays every question type; ends on time's up unless someone is knocked out
  TEST02: 'knockout', // both start at 30 HP
  TEST03: 'forfeit', // the opponent leaves after round 2
};

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function smallBtn(label: string, attrs = '') {
  return `<button class="btn-slot btn-slot--small" type="button" ${attrs}><span class="btn-slot__label">${label}</span></button>`;
}

const TEMPLATES: Record<PopupKind, () => string> = {
  quit: () => `
    <p class="popup__title popup__title--danger">LEAVE MATCH?</p>
    <p class="popup__hint">LEAVING COUNTS AS A FORFEIT</p>
    <div class="popup__buttons">
      ${smallBtn('STAY', 'data-close')}
      ${smallBtn('LEAVE', 'data-leave')}
    </div>`,

  quick: () => `
    <img class="popup__matchmaking" src="/assets/overlays/matchmaking.svg"
         alt="Finding match. Searching for an opponent." />
    <p class="popup__time" aria-label="Time elapsed">0:00</p>
    <div class="popup__buttons">${smallBtn('CANCEL', 'data-close')}</div>`,

  join: () => `
    <p class="popup__title">JOIN FRIEND</p>
    <p class="popup__hint">ENTER YOUR FRIEND'S LOBBY CODE</p>
    <form class="popup__form" novalidate>
      <input class="code-input" maxlength="6" placeholder="CODE" autocomplete="off"
             spellcheck="false" aria-label="Lobby code" />
      <p class="popup__msg" aria-live="polite"></p>
      <div class="popup__buttons">
        ${smallBtn('BACK', 'data-close')}
        <button class="btn-slot btn-slot--small" type="submit"><span class="btn-slot__label">JOIN</span></button>
      </div>
    </form>`,

  create: () => {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    return `
    <p class="popup__title">CREATE LOBBY</p>
    <p class="popup__hint">SHARE THIS CODE</p>
    <p class="popup__code">${code}</p>
    <p class="popup__msg">WAITING FOR FRIEND<span class="dots"></span></p>
    <div class="popup__buttons">
      ${smallBtn('CLOSE', 'data-close')}
      ${smallBtn('COPY', 'data-copy')}
    </div>`;
  },
};

/** Open a popup over the whole screen. Returns a function that closes it. */
export function openPopup(kind: PopupKind, host: HTMLElement, onClose?: () => void) {
  const prevFocus = document.activeElement as HTMLElement | null;
  const root = document.createElement('div');
  root.className = 'popup';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="popup__box popup__box--${kind}">${TEMPLATES[kind]()}</div>`;

  // Everything behind the popup: greyed out and unclickable.
  const background = [...host.children].filter((c) => c !== root) as HTMLElement[];
  background.forEach((c) => {
    c.inert = true;
    c.classList.add('is-greyed');
  });
  host.appendChild(root);

  let timer = 0;
  let closed = false;
  let leaveQueue: (() => void) | null = null;

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    leaveQueue?.();
    window.removeEventListener('keydown', onKey);
    root.remove();
    background.forEach((c) => {
      c.inert = false;
      c.classList.remove('is-greyed');
    });
    prevFocus?.focus?.();
    onClose?.();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  window.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => {
    if (e.target === root || (e.target as Element).closest('[data-close]')) close();
  });

  if (kind === 'quick') {
    const t = root.querySelector('.popup__time')!;
    const start = Date.now();
    timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - start) / 1000);
      t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    leaveQueue = joinQueue(getPlayer(), () => {
      clearInterval(timer);
      t.textContent = 'FOUND!';
      navigate('/game');
    });
  }

  if (kind === 'join') {
    const input = root.querySelector<HTMLInputElement>('.code-input')!;
    const msg = root.querySelector<HTMLElement>('.popup__msg')!;
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      msg.textContent = '';
    });
    root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const scenario = import.meta.env.DEV ? TEST_CODES[input.value] : undefined;
      if (scenario) {
        if (leaveQueue) return;
        msg.textContent = 'TEST MATCH...';
        leaveQueue = joinQueue(getPlayer(), () => navigate('/game'), scenario);
        return;
      }
      // TODO(OWNER A): no lobby codes on the server yet.
      msg.textContent = input.value.length < 6 ? 'CODE IS 6 CHARACTERS' : 'LOBBIES ARE NOT READY YET';
    });
  }

  if (kind === 'create') {
    const code = root.querySelector('.popup__code')!.textContent!;
    const label = root.querySelector<HTMLElement>('[data-copy] .btn-slot__label')!;
    root.querySelector('[data-copy]')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(code).then(() => (label.textContent = 'COPIED'));
    });
  }

  if (kind === 'quit') {
    root.querySelector('[data-leave]')!.addEventListener('click', () => navigate('/'));
  }

  root.querySelector<HTMLElement>('input, [data-close]')?.focus();
  return close;
}

/**
 * Square popups for the play options. The page behind is greyed out
 * and blocked until the popup is closed (button, Esc, or clicking outside).
 *
 * Quick Match joins the server queue, Create Lobby asks the server for a code and waits,
 * Join Friend joins a lobby by code. Each opens the game on match:found.
 */

import type { LobbyClosedReason, LobbyErrorReason } from '@beatcode/shared';
import type { MockScenario } from './mock/mockServer';
import { findMatch, type Finder } from './net/session';
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

/** Lobby codes are 5 characters (server: LOBBY_ALPHABET). Test codes are 6, so they never clash. */
const LOBBY_CODE_LENGTH = 5;

const LOBBY_ERROR: Record<LobbyErrorReason, string> = {
  not_found: 'NO LOBBY WITH THAT CODE',
  full: 'THAT LOBBY IS FULL',
  expired: 'THAT LOBBY HAS EXPIRED',
  busy: 'ALREADY IN A MATCH OR LOBBY',
  rate_limited: 'TOO MANY TRIES. WAIT A MINUTE',
  own_lobby: 'THAT IS YOUR OWN LOBBY',
};

const LOBBY_CLOSED: Record<LobbyClosedReason, string> = {
  expired: 'LOBBY EXPIRED. CLOSE AND TRY AGAIN',
  host_left: 'LOBBY CLOSED',
};

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

  create: () => `
    <p class="popup__title">CREATE LOBBY</p>
    <p class="popup__hint">SHARE THIS CODE</p>
    <p class="popup__code" aria-live="polite">-----</p>
    <p class="popup__msg" aria-live="polite">CREATING LOBBY<span class="dots"></span></p>
    <div class="popup__buttons">
      ${smallBtn('CLOSE', 'data-close')}
      ${smallBtn('COPY', 'data-copy disabled')}
    </div>`,
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
  let finder: Finder | null = null;

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    finder?.cancel(); // no-op once a match was found
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
    finder = findMatch(getPlayer(), { kind: 'queue' }, {
      onFound() {
        clearInterval(timer);
        t.textContent = 'FOUND!';
        navigate('/game');
      },
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
      const code = input.value;
      const scenario = import.meta.env.DEV ? TEST_CODES[code] : undefined;
      if (scenario) {
        finder?.cancel();
        msg.textContent = 'TEST MATCH...';
        finder = findMatch(getPlayer(), { kind: 'mock', scenario }, { onFound: () => navigate('/game') });
        return;
      }
      if (code.length !== LOBBY_CODE_LENGTH) {
        msg.textContent = `CODE IS ${LOBBY_CODE_LENGTH} CHARACTERS`;
        return;
      }
      msg.textContent = 'JOINING...';
      finder ??= findMatch(getPlayer(), { kind: 'join' }, {
        onFound: () => {
          msg.textContent = 'FOUND!';
          navigate('/game');
        },
        onLobbyError: (reason) => (msg.textContent = LOBBY_ERROR[reason]),
      });
      finder.join(code);
    });
  }

  if (kind === 'create') {
    const codeEl = root.querySelector<HTMLElement>('.popup__code')!;
    const msg = root.querySelector<HTMLElement>('.popup__msg')!;
    const copy = root.querySelector<HTMLButtonElement>('[data-copy]')!;
    const label = copy.querySelector<HTMLElement>('.btn-slot__label')!;
    let code = '';
    copy.addEventListener('click', () => {
      if (code) void navigator.clipboard?.writeText(code).then(() => (label.textContent = 'COPIED'));
    });
    finder = findMatch(getPlayer(), { kind: 'create' }, {
      onLobbyCreated(c) {
        code = c;
        codeEl.textContent = c;
        copy.disabled = false;
        msg.innerHTML = 'WAITING FOR FRIEND<span class="dots"></span>';
      },
      onLobbyClosed(reason) {
        code = '';
        copy.disabled = true;
        codeEl.classList.add('is-dead');
        msg.textContent = LOBBY_CLOSED[reason];
      },
      onLobbyError: (reason) => (msg.textContent = LOBBY_ERROR[reason]),
      onFound() {
        msg.textContent = 'FRIEND JOINED!';
        navigate('/game');
      },
    });
  }

  if (kind === 'quit') {
    root.querySelector('[data-leave]')!.addEventListener('click', () => navigate('/'));
  }

  root.querySelector<HTMLElement>('input, [data-close]')?.focus();
  return close;
}

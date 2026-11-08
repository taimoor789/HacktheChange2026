/**
 * Battle screen logic: fills the QUESTION and CODE panels, takes the answer, runs the clock
 * and keeps the HUD (health, combo, ultimate) in sync with the server's events.
 *
 * Everything here only renders what the server sends. The server decides correctness,
 * damage and the round's end. The attacker's attack GIF and sound play on a hit
 * (match/attacks.ts, match/battleAudio.ts); the finisher cutscene is run by the game page.
 */
import {
  ULTIMATE_CHARGE_NEEDED,
  type MatchEndPayload,
  type PlayerState,
  type PublicQuestion,
  type QuestionType,
  type RoundResultPayload,
  type RoundStartPayload,
} from '@beatcode/shared';
import { findCharacter, type Character, type Facing } from '../characters';
import type { MatchSession, ServerEvent } from '../net/session';
import { ATTACK_HIT_MS, playAttack, preloadAttack } from './attacks';
import { playAttackSound, preloadAttackSounds } from './battleAudio';
import { endCallout } from './endScreen';

const TYPE_LABEL: Record<QuestionType, string> = {
  fill_blank: 'FILL THE BLANK',
  name_concept: 'NAME IT',
  output_prediction: 'PREDICT THE OUTPUT',
  spot_the_bug: 'SPOT THE BUG',
  rewrite_code: 'REWRITE THE CODE',
};

const LOW_TIME_S = 5;
/** Phones and tablets: tap wording, no keyboard shortcuts in the hints. */
const TOUCH = window.matchMedia('(pointer: coarse)').matches;
const HINT_FADE_MS = 1200;
const BANNER_MS = 2200;

/** Small element helper. Text always goes in as textContent, never as HTML. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface BattleOptions {
  /** Every round:start (controls are only enabled from here). */
  onRoundStart?: (round: number) => void;
  /** A round:result left a player at 0 HP. `winnerId` is null when both fell (a draw). */
  onKnockout?: (winnerId: string | null) => void;
  onEnd: (p: MatchEndPayload) => void;
}

export function mountBattle(root: HTMLElement, session: MatchSession, opts: BattleOptions) {
  const youId = session.found.you.id;
  const oppId = session.found.opponent.id;
  const names: Record<string, string> = {
    [youId]: session.found.you.name,
    [oppId]: session.found.opponent.name,
  };

  const qSlot = root.querySelector<HTMLElement>('[data-slot="question"]')!;
  const codeSlot = root.querySelector<HTMLElement>('[data-slot="code"]')!;
  const timerEl = root.querySelector<HTMLElement>('.fhud__timer')!;
  const banner = root.querySelector<HTMLElement>('.game__banner')!;
  const side = (id: string) => root.querySelector<HTMLElement>(id === youId ? '.fhud__side--p1' : '.fhud__side--p2')!;

  /* ---------- HUD ---------- */
  function renderPlayer(p: PlayerState) {
    const s = side(p.id);
    const hp = Math.max(0, Math.min(1, p.hp / p.maxHp));
    s.querySelector<HTMLElement>('.fhud__health i')!.style.width = `${hp * 100}%`;
    s.querySelector('.fhud__health')!.setAttribute('aria-label', `Health ${p.hp} of ${p.maxHp}`);
    s.classList.toggle('is-low', hp <= 0.25);
    const charge = Math.max(0, Math.min(1, p.ultimateCharge / ULTIMATE_CHARGE_NEEDED));
    const ult = s.querySelector<HTMLElement>('.fhud__ult')!;
    ult.querySelector('i')!.style.width = `${charge * 100}%`;
    ult.classList.toggle('is-full', charge >= 1);
    ult.setAttribute('aria-label', `Ultimate ${Math.round(charge * 100)}%`);
    const combo = s.querySelector<HTMLElement>('.fhud__combo')!;
    combo.textContent = p.combo > 0 ? `COMBO x${p.combo}` : '';
  }
  renderPlayer(session.found.you);
  renderPlayer(session.found.opponent);
  qSlot.replaceChildren(h('p', 'q__status', 'GET READY...'));

  /* ---------- attacks ---------- */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // You are always on the left facing right; the opponent is on the right facing left.
  const fighters: Record<string, { el: HTMLElement; char: Character; facing: Facing }> = {
    [youId]: {
      el: root.querySelector<HTMLElement>('.fighter--p1')!,
      char: findCharacter(session.found.you.characterId),
      facing: 'right',
    },
    [oppId]: {
      el: root.querySelector<HTMLElement>('.fighter--p2')!,
      char: findCharacter(session.found.opponent.characterId),
      facing: 'left',
    },
  };
  Object.values(fighters).forEach((f) => {
    void preloadAttack(f.char, f.facing);
    preloadAttackSounds(f.char.id);
  });
  let hudTimer = 0;

  let bannerTimer = 0;
  function showBanner(lines: string[], tone = '') {
    banner.replaceChildren(...lines.map((l) => h('p', '', l)));
    banner.dataset.tone = tone;
    banner.classList.remove('is-on');
    void banner.offsetWidth; // restart the pop-in
    banner.classList.add('is-on');
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => banner.classList.remove('is-on'), BANNER_MS);
  }

  /* ---------- clock ---------- */
  let round: RoundStartPayload | null = null;
  let skew = 0; // server clock minus local clock
  let tick = 0;
  let roundOpen = false;

  function remainingMs() {
    return round ? round.deadline - (Date.now() + skew) : 0;
  }
  function renderClock() {
    const s = Math.max(0, Math.ceil(remainingMs() / 1000));
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('is-low', roundOpen && s <= LOW_TIME_S);
    if (roundOpen && s <= 0) {
      lock("TIME'S UP");
      stopClock();
    }
  }
  function stopClock() {
    clearInterval(tick);
    tick = 0;
  }

  /* ---------- answering ---------- */
  let sent = false;
  let hintUsed = false;
  let hintTimer = 0;
  let controls: (HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement)[] = [];
  let statusEl: HTMLElement | null = null;
  let hintEl: HTMLElement | null = null;
  let lineInput: HTMLInputElement | null = null;

  function setStatus(text: string, tone = '') {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.tone = tone;
  }
  function lock(text: string, tone = '') {
    roundOpen = false;
    controls.forEach((c) => (c.disabled = true));
    setStatus(text, tone);
  }

  /** One counted answer per round. A hint reopens the input (it was not counted). */
  function send(answer: string) {
    if (!round || !roundOpen || sent) return;
    if (!answer.trim()) return;
    sent = true;
    controls.forEach((c) => (c.disabled = true));
    setStatus('ANSWER SENT');
    session.submit(round.round, round.question.id, answer);
  }

  function singleLine(placeholder: string) {
    const form = h('form', 'q__form');
    form.noValidate = true;
    const input = h('input', 'q__input');
    input.maxLength = 500;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', 'Your answer');
    const btn = h('button', 'q__send', 'SEND');
    btn.type = 'submit';
    form.append(input, btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      send(input.value);
    });
    input.addEventListener('input', () => hintEl?.classList.remove('is-on'));
    controls = [input, btn];
    lineInput = input;
    return form;
  }

  function optionButtons(options: string[]) {
    const wrap = h('div', 'q__options');
    controls = options.map((text, i) => {
      const b = h('button', 'q__opt', `${'ABCD'[i] ?? i + 1}. ${text}`);
      b.type = 'button';
      b.addEventListener('click', () => {
        b.classList.add('is-picked');
        send(text);
      });
      wrap.append(b);
      return b;
    });
    return wrap;
  }

  function codeList(code: string, pickable: boolean, onPick?: (n: number) => void) {
    const ol = h('ol', 'code');
    code.split('\n').forEach((line, i) => {
      const li = h('li', 'code__row');
      const n = h('span', 'code__n', String(i + 1));
      const text = h('code', 'code__text', line || ' ');
      if (pickable) {
        const b = h('button', 'code__line');
        b.type = 'button';
        b.setAttribute('aria-label', `Line ${i + 1}: ${line}`);
        b.append(n, text);
        b.addEventListener('click', () => onPick?.(i + 1));
        li.append(b);
        controls.push(b);
      } else {
        li.append(n, text);
      }
      ol.append(li);
    });
    return ol;
  }

  function renderQuestion(q: PublicQuestion, p: RoundStartPayload) {
    controls = [];
    lineInput = null;
    sent = false;
    hintUsed = false;
    clearTimeout(hintTimer);

    const wrap = h('div', 'q');
    const kind = q.options ? 'PICK ONE' : TYPE_LABEL[q.type];
    wrap.append(h('p', 'q__meta', `ROUND ${p.round} · TIER ${p.tier} · ${kind}`), h('p', 'q__prompt', q.prompt));
    hintEl = h('p', 'q__hint');
    hintEl.setAttribute('aria-live', 'polite');
    statusEl = h('p', 'q__status');
    statusEl.setAttribute('aria-live', 'polite');

    codeSlot.replaceChildren();
    codeSlot.classList.remove('is-edit');
    let focusEl: HTMLElement | null = null;

    if (q.options) {
      wrap.append(optionButtons(q.options));
      if (q.code) codeSlot.append(codeList(q.code, false));
      focusEl = controls[0] ?? null;
    } else if (q.type === 'spot_the_bug') {
      const sendBtn = h('button', 'q__send', 'PICK A LINE');
      sendBtn.type = 'button';
      sendBtn.disabled = true;
      let picked = 0;
      const list = codeList(q.code ?? '', true, (n) => {
        picked = n;
        list.querySelectorAll('.code__line').forEach((b, i) => b.classList.toggle('is-picked', i + 1 === n));
        sendBtn.disabled = false;
        sendBtn.textContent = `SEND LINE ${n}`;
      });
      sendBtn.addEventListener('click', () => picked && send(String(picked)));
      controls.push(sendBtn);
      codeSlot.append(list);
      wrap.append(h('p', 'q__tip', TOUCH ? 'TAP THE LINE WITH THE BUG' : 'CLICK THE LINE WITH THE BUG'), sendBtn);
      focusEl = list.querySelector('.code__line');
    } else if (q.type === 'rewrite_code') {
      const area = h('textarea', 'code-edit');
      area.value = q.code ?? '';
      area.spellcheck = false;
      area.maxLength = 2000;
      area.setAttribute('aria-label', 'Your corrected code');
      area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          send(area.value);
        } else if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          area.setRangeText('    ', area.selectionStart, area.selectionEnd, 'end');
        } else if (e.key === 'Escape') {
          area.blur(); // Tab is taken, so Esc lets keyboard users leave the box
        }
      });
      const sendBtn = h('button', 'q__send', 'SEND');
      sendBtn.type = 'button';
      sendBtn.addEventListener('click', () => send(area.value));
      controls = [area, sendBtn];
      codeSlot.classList.add('is-edit');
      codeSlot.append(area);
      const tip = TOUCH ? 'EDIT THE CODE, THEN TAP SEND' : 'EDIT THE CODE. CTRL/CMD+ENTER SENDS. TAB = 4 SPACES';
      wrap.append(h('p', 'q__tip', tip), sendBtn);
      focusEl = area;
    } else {
      wrap.append(singleLine(q.type === 'output_prediction' ? 'OUTPUT' : 'ANSWER'));
      if (q.code) codeSlot.append(codeList(q.code, false));
      focusEl = lineInput;
    }

    const noCode = !codeSlot.childElementCount;
    if (noCode) codeSlot.append(h('p', 'code__none', 'NO CODE THIS ROUND'));
    codeSlot.closest('.pane')?.classList.toggle('is-empty', noCode); // phones hide it (CSS)
    wrap.append(hintEl, statusEl);
    qSlot.replaceChildren(wrap);
    qSlot.scrollTop = 0;
    codeSlot.scrollTop = 0;
    focusEl?.focus({ preventScroll: true });
  }

  /* ---------- server events ---------- */
  let ended = false;

  function onRoundStart(p: RoundStartPayload) {
    round = p;
    skew = p.serverNow - Date.now();
    roundOpen = remainingMs() > 0;
    renderQuestion(p.question, p);
    stopClock();
    tick = window.setInterval(renderClock, 200);
    renderClock();
    if (roundOpen) showBanner([`ROUND ${p.round}`]);
    opts.onRoundStart?.(p.round);
  }

  function onHint(p: { round: number; suggestion: string }) {
    if (!round || p.round !== round.round || !lineInput || hintUsed) return;
    hintUsed = true;
    sent = false; // a hint is not the counted answer
    if (roundOpen) controls.forEach((c) => (c.disabled = false));
    lineInput.value = p.suggestion;
    setStatus('');
    if (hintEl) {
      hintEl.textContent = `DID YOU MEAN: ${p.suggestion}?`;
      hintEl.classList.add('is-on');
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => hintEl?.classList.remove('is-on'), HINT_FADE_MS);
    }
    lineInput.focus({ preventScroll: true });
    lineInput.select();
  }

  function onResult(p: RoundResultPayload) {
    // p.damage lists each hit: { attacker (null = mutual miss), to, amount, attackSize }.
    // The attacker plays their attack GIF and sound; the bars drop when the blow lands.
    const hits = p.damage.filter((d) => d.attacker !== null && fighters[d.attacker]);
    const updateHud = () => {
      for (const player of Object.values(p.players)) renderPlayer(player);
    };
    clearTimeout(hudTimer);
    for (const d of hits) {
      const f = fighters[d.attacker!];
      // You stand on the left (facing right), the opponent on the right.
      const sound = () => void playAttackSound(f.char.id, d.attackSize, f.facing === 'right' ? 'left' : 'right');
      if (reduceMotion) sound();
      else void playAttack(f.el, f.char, f.facing, { ultimate: d.attackSize === 'ultimate', onStart: sound });
    }
    if (hits.length && !reduceMotion) hudTimer = window.setTimeout(updateHud, ATTACK_HIT_MS);
    else updateHud();

    // Knockout: match:end follows after the server's end delay; the page plays the finisher now.
    const standing = Object.values(p.players).filter((pl) => pl.hp > 0);
    if (standing.length < Object.keys(p.players).length) opts.onKnockout?.(standing[0]?.id ?? null);

    const lines: string[] = [];
    if (p.damage.length === 0) lines.push('NO DAMAGE');
    for (const d of p.damage) {
      if (d.attacker === null) lines.push(`${d.to === youId ? 'YOU' : names[d.to]} MISSED  -${d.amount}`);
      else if (d.attacker === youId)
        lines.push(`${d.attackSize === 'ultimate' ? 'ULTIMATE! ' : ''}YOU HIT  -${d.amount}`);
      else lines.push(`${d.attackSize === 'ultimate' ? 'ULTIMATE! ' : ''}${names[d.attacker]} HITS YOU  -${d.amount}`);
    }
    const mine = p.outcomes[youId];
    const tone = p.damage.some((d) => d.attacker === youId) ? 'good' : p.damage.some((d) => d.to === youId) ? 'bad' : '';
    showBanner(lines, tone);

    if (round && p.round === round.round) {
      stopClock();
      lock(mine?.correct ? 'CORRECT' : mine?.answered ? 'WRONG' : 'NO ANSWER', mine?.correct ? 'good' : 'bad');
    }
  }

  function onUltimate(playerId: string) {
    showBanner([`${playerId === youId ? 'YOUR' : `${names[playerId]}'S`} ULTIMATE!`], 'ult');
  }

  function onEnd(p: MatchEndPayload) {
    if (ended) return;
    ended = true;
    stopClock();
    roundOpen = false;
    controls.forEach((c) => (c.disabled = true));
    // let a knockout blow land before the final bars show
    const final = () => {
      for (const player of Object.values(p.players)) renderPlayer(player);
    };
    if (hudTimer) window.setTimeout(final, ATTACK_HIT_MS);
    else final();
    setStatus('MATCH OVER');
    showBanner([endCallout(p)], p.winnerId === youId ? 'good' : p.winnerId === null ? '' : 'bad');
    opts.onEnd(p);
  }

  const off = session.listen((e: ServerEvent) => {
    if (ended) return;
    switch (e.type) {
      case 'round:start':
        return onRoundStart(e.payload);
      case 'answer:hint':
        return onHint(e.payload);
      case 'ultimate:ready':
        return onUltimate(e.payload.playerId);
      case 'round:result':
        return onResult(e.payload);
      case 'match:end':
        return onEnd(e.payload);
    }
  });

  return () => {
    off();
    stopClock();
    clearTimeout(bannerTimer);
    clearTimeout(hintTimer);
    clearTimeout(hudTimer);
  };
}

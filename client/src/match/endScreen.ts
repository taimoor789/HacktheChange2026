/**
 * Match end: who won, why, and a review of every finished round
 * (correct answer and explanation come only now, from match:end).
 */
import type { ConnectUpdatePayload, MatchEndPayload, MatchEndReason, ReviewItem } from '@beatcode/shared';
import type { MatchSession } from '../net/session';
import { cleanLinkedin } from '../state';

const REASON: Record<MatchEndReason, string> = {
  hp_zero: 'KNOCKOUT',
  tiers_complete: "TIME'S UP",
  max_rounds: "TIME'S UP",
  forfeit: 'OPPONENT LEFT',
};

/** Short callout shown on the stage before the end screen opens. */
export function endCallout(p: MatchEndPayload) {
  return p.reason === 'hp_zero' ? 'K.O.!' : REASON[p.reason];
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function answerText(item: ReviewItem, a: { submitted: string | null } | undefined) {
  const s = a?.submitted;
  if (s === null || s === undefined || s === '') return 'NO ANSWER';
  return item.type === 'spot_the_bug' && /^\d+$/.test(s.trim()) ? `LINE ${s.trim()}` : s;
}

function reviewCard(item: ReviewItem, n: number, youId: string, oppId: string, oppName: string) {
  const card = h('li', 'review__item');
  const mine = item.answers[youId];
  card.dataset.result = mine?.correct ? 'good' : 'bad';
  card.append(
    h('p', 'review__meta', `Q${n} · ${item.concept.toUpperCase()} · ${item.type.replace(/_/g, ' ').toUpperCase()}`),
    h('p', 'review__prompt', item.prompt),
  );
  if (item.code) card.append(h('pre', 'review__code', item.code));
  if (item.options) card.append(h('p', 'review__opts', item.options.join('  ·  ')));

  const rows: [string, string, string][] = [
    ['YOU', answerText(item, mine), mine?.correct ? 'good' : 'bad'],
    [oppName, answerText(item, item.answers[oppId]), item.answers[oppId]?.correct ? 'good' : 'bad'],
    ['ANSWER', item.type === 'spot_the_bug' ? `LINE ${item.correctAnswer}` : item.correctAnswer, 'key'],
  ];
  const dl = h('dl', 'review__answers');
  for (const [label, value, tone] of rows) {
    const dd = h('dd', '', value);
    dd.dataset.tone = tone;
    dl.append(h('dt', '', label), dd);
  }
  card.append(dl, h('p', 'review__why', item.explanation));
  return card;
}

/** "Connect with your opponent": links are swapped only once both players have pressed it. */
function connectPanel(session: Pick<MatchSession, 'connect' | 'listen'>, oppId: string, oppName: string) {
  const panel = h('div', 'connect');
  const button = h('button', 'connect__btn', 'CONNECT WITH YOUR OPPONENT');
  button.type = 'button';
  const status = h('p', 'connect__status');
  status.setAttribute('aria-live', 'polite');
  panel.append(button, status);

  let finished = false;
  const setLoading = (loading: boolean) => panel.classList.toggle('is-waiting', loading);

  const finish = (update: ConnectUpdatePayload) => {
    finished = true;
    setLoading(false);
    button.remove();
    status.textContent = '';
    if (update.status === 'unavailable') {
      status.textContent = `${oppName} HAS LEFT`;
      return;
    }
    const link = update.opponentLinkedinUrl ? cleanLinkedin(update.opponentLinkedinUrl) : null;
    if (!link) {
      status.textContent = `CONNECTED! ${oppName} DID NOT ADD A LINKEDIN`;
      return;
    }
    status.textContent = `CONNECTED! ${oppName}'S LINKEDIN:`;
    const a = h('a', 'connect__link', link.replace(/^https:\/\/www\./, ''));
    a.href = link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    panel.append(a);
  };

  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'CONNECTING...';
    status.textContent = `WAITING FOR ${oppName}...`;
    setLoading(true);
    session.connect(oppId);
  });

  session.listen((e) => {
    if (e.type !== 'connect:update' || finished) return;
    if (e.payload.status === 'connected' || e.payload.status === 'unavailable') finish(e.payload);
    else if (e.payload.status === 'requested') status.textContent = `${oppName} WANTS TO CONNECT`;
  });
  return panel;
}

export function renderEndScreen(
  p: MatchEndPayload,
  youId: string,
  onNav: (path: string) => void,
  session?: Pick<MatchSession, 'connect' | 'listen'>,
) {
  const oppId = Object.keys(p.players).find((id) => id !== youId) ?? '';
  const you = p.players[youId];
  const opp = p.players[oppId];
  const oppName = opp?.name || 'OPPONENT';

  const outcome = p.winnerId === null ? 'DRAW' : p.winnerId === youId ? 'YOU WIN' : 'YOU LOSE';
  const tone = p.winnerId === null ? '' : p.winnerId === youId ? 'good' : 'bad';
  const reason = p.reason === 'forfeit' ? `${oppName} LEFT THE MATCH` : REASON[p.reason];

  const root = h('section', 'result');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Match result');
  const box = h('div', 'result__box');
  const title = h('h2', 'result__title', outcome);
  title.dataset.tone = tone;
  title.tabIndex = -1;
  box.append(
    title,
    h('p', 'result__reason', reason),
    h('p', 'result__hp', `${you?.name ?? 'YOU'} ${you?.hp ?? 0} HP   ·   ${oppName} ${opp?.hp ?? 0} HP`),
  );

  // A forfeit means the opponent has already gone, so there is nobody to connect with.
  if (session && oppId && p.reason !== 'forfeit') box.append(connectPanel(session, oppId, oppName));

  const buttons = h('div', 'result__buttons');
  for (const [label, path] of [
    ['PLAY AGAIN', '/select'],
    ['HOME', '/'],
  ] as const) {
    const b = h('button', 'btn-slot btn-slot--small');
    b.type = 'button';
    b.append(h('span', 'btn-slot__label', label));
    b.addEventListener('click', () => onNav(path));
    buttons.append(b);
  }
  box.append(buttons);

  box.append(h('h3', 'review__title', `REVIEW (${p.review.length})`));
  if (p.review.length === 0) {
    box.append(h('p', 'review__empty', 'NO ROUNDS WERE FINISHED.'));
  } else {
    const list = h('ol', 'review');
    p.review.forEach((item, i) => list.append(reviewCard(item, i + 1, youId, oppId, oppName)));
    box.append(list);
  }

  root.append(box);
  return { el: root, focus: () => title.focus({ preventScroll: true }) };
}

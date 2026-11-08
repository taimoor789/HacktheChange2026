// OWNER B: scripted mock match, so the whole battle screen can be built and played without the server.
// It plays the round rules from AGENTS.md against a scripted opponent and emits the real payloads
// from @beatcode/shared. Grading here is a rough stand-in for Owner C's matcher, not the real one.
//
// Used when VITE_USE_MOCK=true (every Quick Match) or for the test codes in Join Friend (dev only).
// Scenarios cover the end reasons: 'full' ends on tiers_complete (time's up), 'knockout' starts both
// players low so hp_zero happens, 'forfeit' has the opponent leave after round 2.
import {
  CLIENT_EVENTS,
  DAMAGE_BY_TIER,
  MAX_ROUNDS,
  MISS_DAMAGE,
  RACE_MODE_TYPES,
  SERVER_EVENTS,
  SPEED_BONUS_MAX,
  STARTING_HP,
  TIMER_SECONDS_BY_TIER,
  ULTIMATE_CHARGE_NEEDED,
  ULTIMATE_DAMAGE_MULTIPLIER,
  ULT_STREAK,
  type AnswerSubmitPayload,
  type AttackSize,
  type ClientToServerEvents,
  type DamageEvent,
  type MatchEndReason,
  type PlayerRoundOutcome,
  type PlayerState,
  type PublicQuestion,
  type Question,
  type QueueJoinPayload,
  type ReviewItem,
  type ServerToClientEvents,
} from '@beatcode/shared';
import type { GameSocket } from '../net/socket';

export type MockScenario = 'full' | 'knockout' | 'forfeit';

/** The real server starts the next round right after round:result. Kept the same here. */
const ROUND_GAP_MS = 0;
const FOUND_DELAY_MS = 1200;
const KNOCKOUT_START_HP = 30;
const FORFEIT_AFTER_ROUND = 2;

/** Opponent's scripted answer: `at` is the fraction of the round when it answers. null = never answers. */
type OppMove = { answer: string; at: number } | null;

// Copied from server/src/questions/bank on main.
const SCRIPT: { q: Question; opp: OppMove }[] = [
  {
    q: {
      id: 't1-var-2',
      type: 'name_concept',
      difficulty: 1,
      concept: 'variables',
      prompt: 'What is the name for a named location in memory that stores a value?',
      acceptedAnswers: ['variable'],
      explanation: 'A variable is a named storage location whose value can change.',
    },
    opp: { answer: 'variable', at: 0.75 },
  },
  {
    q: {
      id: 't1-var-3',
      type: 'output_prediction',
      difficulty: 1,
      concept: 'variables',
      prompt: 'What does this print?',
      code: 'x = 3\nx = x + 4\nprint(x)',
      acceptedAnswers: ['7'],
      explanation: 'x starts at 3, then x + 4 = 7 is assigned back to x, so 7 is printed.',
    },
    opp: { answer: '34', at: 0.4 },
  },
  {
    q: {
      id: 't2-loop-1',
      type: 'fill_blank',
      difficulty: 2,
      concept: 'loops',
      prompt: 'Complete the loop so it runs 5 times.',
      code: 'for i ___ range(5):\n    print(i)',
      acceptedAnswers: ['in'],
      explanation: "A for loop iterates over a sequence with 'for x in sequence'.",
    },
    opp: { answer: 'in', at: 0.5 },
  },
  {
    q: {
      id: 't2-cond-5',
      type: 'spot_the_bug',
      difficulty: 2,
      concept: 'conditionals',
      prompt: 'This code has a syntax error. Which line number is wrong?',
      code: 'age = 18\nif age >= 18\n    print("adult")',
      acceptedAnswers: ['2'],
      explanation: "The if statement on line 2 is missing its colon: it should be 'if age >= 18:'.",
    },
    opp: { answer: '2', at: 0.6 },
  },
  {
    q: {
      id: 't3-func-3',
      type: 'name_concept',
      difficulty: 3,
      concept: 'functions',
      prompt: 'What is the actual value you pass into a function when you call it, such as the 5 in square(5)?',
      options: ['parameter', 'argument', 'return value', 'variable'],
      acceptedAnswers: ['argument'],
      explanation: 'The name in the definition is a parameter; the value passed in a call is an argument.',
    },
    opp: { answer: 'parameter', at: 0.3 },
  },
  {
    q: {
      id: 't3-rw-1',
      type: 'rewrite_code',
      difficulty: 3,
      concept: 'functions',
      prompt:
        'find_max returns the wrong answer for [-5, -2, -9]. Rewrite the corrected function (typing just the fixed line also counts).',
      code: 'def find_max(nums):\n    best = 0\n    for n in nums:\n        if n > best:\n            best = n\n    return best',
      seconds: 45,
      acceptedAnswers: [
        'def find_max(nums):\n    best = nums[0]\n    for n in nums:\n        if n > best:\n            best = n\n    return best',
        'def find_max(nums):\n    best = float("-inf")\n    for n in nums:\n        if n > best:\n            best = n\n    return best',
        '    best = nums[0]',
        '    best = float("-inf")',
      ],
      explanation:
        'Starting best at 0 breaks lists where every number is negative. Start from the first element (best = nums[0]) instead.',
    },
    opp: null,
  },
];

// ---------- rough grading (stand-in for Owner C's answerMatching) ----------

const loose = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^(['"`])(.*)\1$/, '$2').replace(/;$/, '').replace(/\(\)$/, '');
const codeLines = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, '').replace(/\t/g, '    '))
    .filter((l) => l.trim() !== '');

function isCorrect(q: Question, answer: string): boolean {
  if (q.type === 'spot_the_bug') {
    const m = /^\s*(?:line\s*)?(\d+)\s*$/i.exec(answer);
    return !!m && q.acceptedAnswers.includes(m[1]);
  }
  if (q.type === 'rewrite_code') {
    const typed = codeLines(answer);
    return q.acceptedAnswers.some((a) => {
      const want = codeLines(a);
      if (want.length === 1) return typed.length === 1 && typed[0].trim() === want[0].trim();
      return want.length === typed.length && want.every((l, i) => l === typed[i]);
    });
  }
  if (q.type === 'output_prediction') return q.acceptedAnswers.some((a) => a.trim() === answer.trim());
  return q.acceptedAnswers.some((a) => loose(a) === loose(answer));
}

function editDistance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Near-miss of an accepted answer, for typed single-line questions only. */
function suggest(q: Question, answer: string): string | null {
  if (q.options || q.type === 'spot_the_bug' || q.type === 'rewrite_code') return null;
  const typed = loose(answer);
  for (const a of q.acceptedAnswers) {
    const want = loose(a);
    if (want.length < 4 || !/[a-z]{3}/.test(want)) continue;
    const allowed = want.length >= 16 ? 3 : want.length >= 8 ? 2 : 1;
    if (editDistance(typed, want) <= allowed) return a;
  }
  return null;
}

// ---------- engine ----------

const roundMs = (q: Question) =>
  Math.min(60, Math.max(TIMER_SECONDS_BY_TIER[q.difficulty - 1] ?? 20, q.seconds ?? 0)) * 1000;
const toPublic = ({ acceptedAnswers: _a, explanation: _e, ...rest }: Question): PublicQuestion => rest;
const chargeOf = (combo: number) =>
  Math.min(ULTIMATE_CHARGE_NEEDED, Math.round((combo / ULT_STREAK) * ULTIMATE_CHARGE_NEEDED));

interface Answer {
  submitted: string;
  correct: boolean;
  ms: number;
}

export function createMockSocket(scenario: MockScenario): GameSocket {
  type Handler = (payload: never) => void;
  const handlers = new Map<string, Set<Handler>>();
  const timers = new Set<number>();
  let closed = false;

  const fire = <E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>) => {
    if (closed) return;
    handlers.get(event)?.forEach((h) => (h as (...a: unknown[]) => void)(...args));
  };
  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.delete(t);
      if (!closed) fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t: number) => {
    clearTimeout(t);
    timers.delete(t);
  };

  const matchId = 'mock-match';
  const YOU = 'mock-you';
  const OPP = 'mock-opp';
  let players: Record<string, PlayerState> = {};
  const review: ReviewItem[] = [];
  let index = -1;
  let tier = 1;
  let live: {
    round: number;
    q: Question;
    startedAt: number;
    ms: number;
    answers: Partial<Record<string, Answer>>;
    hintsUsed: number;
    timers: number[];
  } | null = null;

  const snapshot = () => ({ [YOU]: { ...players[YOU] }, [OPP]: { ...players[OPP] } });

  function start(join: QueueJoinPayload) {
    const hp = scenario === 'knockout' ? KNOCKOUT_START_HP : STARTING_HP;
    const make = (id: string, name: string, characterId: string): PlayerState => ({
      id,
      name,
      characterId,
      hp,
      maxHp: STARTING_HP,
      combo: 0,
      ultimateCharge: 0,
      tier: 1,
      isBot: false,
    });
    const others = ['glitch', 'null', 'bram', 'skye'].filter((c) => c !== join.characterId);
    players = {
      [YOU]: make(YOU, join.name, join.characterId),
      [OPP]: make(OPP, 'MOCKBOT', others[Math.floor(Math.random() * others.length)]),
    };
    later(() => {
      fire(SERVER_EVENTS.MATCH_FOUND, { matchId, you: { ...players[YOU] }, opponent: { ...players[OPP] } });
      nextRound();
    }, FOUND_DELAY_MS);
  }

  function nextRound() {
    index++;
    const step = SCRIPT[index];
    if (!step) return end('tiers_complete');
    if (index + 1 > MAX_ROUNDS) return end('max_rounds');
    const q = step.q;
    tier = q.difficulty;
    const now = Date.now();
    const ms = roundMs(q);
    live = { round: index + 1, q, startedAt: now, ms, answers: {}, hintsUsed: 0, timers: [] };
    fire(SERVER_EVENTS.ROUND_START, {
      matchId,
      round: live.round,
      tier,
      question: toPublic(q),
      deadline: now + ms,
      serverNow: now,
    });
    live.timers.push(later(resolve, ms));
    if (step.opp) {
      const move = step.opp;
      live.timers.push(later(() => record(OPP, move.answer), move.at * ms));
    }
  }

  function record(id: string, submitted: string) {
    if (!live || live.answers[id]) return;
    const ms = Date.now() - live.startedAt;
    const correct = isCorrect(live.q, submitted);
    live.answers[id] = { submitted, correct, ms };
    const race = RACE_MODE_TYPES.includes(live.q.type);
    const both = !!live.answers[YOU] && !!live.answers[OPP];
    if ((race && correct) || both) resolve();
  }

  function resolve() {
    if (!live) return;
    const { q, round, answers, ms: total } = live;
    live.timers.forEach(cancel);
    live = null;

    const race = RACE_MODE_TYPES.includes(q.type);
    const closedEarly = race && Object.values(answers).some((a) => a?.correct);
    const ids = [YOU, OPP];
    const correctIds = ids.filter((id) => answers[id]?.correct);

    let winner: string | null = null;
    if (correctIds.length === 1) winner = correctIds[0];
    if (correctIds.length === 2) {
      const [a, b] = correctIds.map((id) => answers[id]!.ms);
      winner = a === b ? null : a < b ? YOU : OPP;
    }

    // streaks: correct +1, wrong or timed-out resets, slower player in a race that closed early freezes
    for (const id of ids) {
      const a = answers[id];
      const p = players[id];
      if (a?.correct) p.combo += 1;
      else if (!a && closedEarly) continue;
      else p.combo = 0;
    }

    const damage: DamageEvent[] = [];
    let ultimateBy: string | null = null;
    if (winner) {
      const loser = winner === YOU ? OPP : YOU;
      const bonus = SPEED_BONUS_MAX * Math.max(0, 1 - answers[winner]!.ms / total);
      let amount = Math.round(DAMAGE_BY_TIER[tier - 1] * (1 + bonus));
      const frac = bonus / SPEED_BONUS_MAX;
      let attackSize: AttackSize = frac < 0.15 ? 'light' : frac < 0.35 ? 'medium' : 'heavy';
      if (players[winner].combo >= ULT_STREAK) {
        amount = Math.round(amount * ULTIMATE_DAMAGE_MULTIPLIER);
        attackSize = 'ultimate';
        players[winner].combo = 0;
        ultimateBy = winner;
      }
      amount = Math.min(amount, players[loser].hp);
      players[loser].hp -= amount;
      damage.push({ to: loser, amount, attackSize, attacker: winner });
    } else if (correctIds.length === 0 && round !== MAX_ROUNDS) {
      for (const id of ids) {
        const amount = Math.min(MISS_DAMAGE, Math.max(0, players[id].hp - 1));
        players[id].hp -= amount;
        if (amount > 0) damage.push({ to: id, amount, attackSize: 'light', attacker: null });
      }
    }

    const nextQ = SCRIPT[index + 1]?.q;
    const nextTier = nextQ?.difficulty ?? tier;
    for (const id of ids) {
      players[id].ultimateCharge = chargeOf(players[id].combo);
      players[id].tier = nextTier;
    }

    const outcomes: Record<string, PlayerRoundOutcome> = {};
    for (const id of ids) {
      const a = answers[id];
      outcomes[id] = a ? { answered: true, correct: a.correct, answerMs: a.ms } : { answered: false, correct: false };
    }
    const item: ReviewItem = {
      questionId: q.id,
      type: q.type,
      concept: q.concept,
      prompt: q.prompt,
      correctAnswer: q.acceptedAnswers[0],
      explanation: q.explanation,
      answers: {
        [YOU]: { submitted: answers[YOU]?.submitted ?? null, correct: !!answers[YOU]?.correct },
        [OPP]: { submitted: answers[OPP]?.submitted ?? null, correct: !!answers[OPP]?.correct },
      },
    };
    if (q.code) item.code = q.code;
    if (q.options) item.options = q.options;
    review.push(item);

    if (ultimateBy) fire(SERVER_EVENTS.ULTIMATE_READY, { matchId, playerId: ultimateBy });
    fire(SERVER_EVENTS.ROUND_RESULT, {
      matchId,
      round,
      questionId: q.id,
      outcomes,
      damage,
      players: snapshot(),
      nextTier,
    });

    if (players[YOU].hp <= 0 || players[OPP].hp <= 0) return end('hp_zero');
    if (scenario === 'forfeit' && round === FORFEIT_AFTER_ROUND) {
      later(() => end('forfeit'), 1500); // the opponent disconnects between rounds
      return;
    }
    later(nextRound, ROUND_GAP_MS);
  }

  function end(reason: MatchEndReason) {
    if (live) {
      live.timers.forEach(cancel);
      live = null;
    }
    const you = players[YOU].hp;
    const opp = players[OPP].hp;
    let winnerId: string | null = null;
    if (reason === 'forfeit') winnerId = YOU;
    else if (you !== opp) winnerId = you > opp ? YOU : OPP;
    fire(SERVER_EVENTS.MATCH_END, { matchId, winnerId, players: snapshot(), review: [...review], reason });
  }

  function submit(p: AnswerSubmitPayload) {
    if (!live || !p || typeof p.answer !== 'string' || p.answer.length > 2000) return;
    if (p.matchId !== matchId || p.round !== live.round || p.questionId !== live.q.id) return;
    if (Date.now() > live.startedAt + live.ms || live.answers[YOU]) return;
    if (!isCorrect(live.q, p.answer) && live.hintsUsed < 1) {
      const suggestion = suggest(live.q, p.answer);
      if (suggestion) {
        live.hintsUsed++;
        const round = live.round;
        later(() => fire(SERVER_EVENTS.ANSWER_HINT, { matchId, round, suggestion }), 80);
        return;
      }
    }
    record(YOU, p.answer);
  }

  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler as Handler);
    },
    off(event, handler) {
      handlers.get(event)?.delete(handler as Handler);
    },
    emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>) {
      // a short network-like delay, so the UI never relies on a synchronous reply
      later(() => {
        if (event === CLIENT_EVENTS.QUEUE_JOIN && players[YOU] === undefined) start(args[0] as QueueJoinPayload);
        if (event === CLIENT_EVENTS.ANSWER_SUBMIT) submit(args[0] as AnswerSubmitPayload);
      }, 40);
    },
    disconnect() {
      closed = true;
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    },
  };
}

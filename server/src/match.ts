// OWNER A: one match, round by round. No sockets and no waiting.
// Players only receive the public question. answerMs comes from the player, not from a clock sleep.
// play() returns the end reason: hp_zero, tiers_complete, or max_rounds.
import type { PublicQuestion, Question, QuestionType } from '@beatcode/shared';
import { MAX_ROUNDS, RACE_MODE_TYPES, STARTING_HP } from '@beatcode/shared';
import type { AnswerStatus, JudgedAnswer, MatchEnd, ResolvedPlayer, ResolveRoundResult } from './engine/resolveRound';
import { resolveRound } from './engine/resolveRound';
import { answerIsCorrect, gradeSubmission, nextQuestion, publicQuestion, roundDurationMs } from './matchQuestions';

export interface Clock {
  now(): number;
}

export const frozenClock: Clock = { now: () => 0 };

/** What a player sends back. `answer: null` is a timeout. */
export interface PlayerTurn {
  answer: string | null;
  answerMs: number | null;
}

/**
 * Scripted players implement this. Live sockets use submitLive instead.
 * `question` is the public view: no acceptedAnswers, no explanation.
 */
export interface MatchPlayer {
  id: string;
  respond(question: PublicQuestion, roundDurationMs: number): PlayerTurn | Promise<PlayerTurn>;
}

export interface RecordedAnswer {
  playerId: string;
  submitted: string | null;
  answerMs: number | null;
  status: AnswerStatus;
}

export interface RoundRecord {
  roundNumber: number;
  matchTier: number;
  startedAtMs: number;
  durationMs: number;
  /** Full question, kept for a later review. Never handed to a player. */
  question: Question;
  shown: PublicQuestion;
  answers: [RecordedAnswer, RecordedAnswer];
  result: ResolveRoundResult;
}

export interface MatchOutcome {
  winnerId: string | null;
  reason: MatchEnd['reason'];
  roundCount: number;
  history: readonly RoundRecord[];
  players: readonly [ResolvedPlayer, ResolvedPlayer];
}

export interface MatchOptions {
  players: readonly [MatchPlayer, MatchPlayer];
  /** Question picks use this. Defaults to Math.random. */
  rng?: () => number;
  /** Stamps round start. The match never sleeps on it. */
  clock?: Clock;
  /** When set, nextQuestion prefers this type. */
  preferredType?: QuestionType;
  /** Test seam. Production uses nextQuestion. */
  chooseQuestion?: (tier: number, usedIds: readonly string[], rng: () => number) => Question;
}

export interface LiveRoundOpen {
  roundNumber: number;
  tier: number;
  durationMs: number;
  startedAtMs: number;
  shown: PublicQuestion;
  questionId: string;
}

export type LiveSubmit =
  | { kind: 'ignored' }
  | { kind: 'hint'; suggestion: string }
  | { kind: 'accepted' }
  | { kind: 'finished'; result: ResolveRoundResult };

async function ask(player: MatchPlayer, question: PublicQuestion, durationMs: number): Promise<PlayerTurn> {
  return player.respond(question, durationMs);
}

function judge(question: Question, turn: PlayerTurn, durationMs: number): JudgedAnswer {
  const tooLate = turn.answerMs === null || turn.answerMs < 0 || turn.answerMs > durationMs;
  if (turn.answer === null || tooLate) {
    return { status: 'timeout', answerMs: turn.answerMs };
  }
  return {
    status: answerIsCorrect(question, turn.answer) ? 'correct' : 'wrong',
    answerMs: turn.answerMs,
  };
}

export class Match {
  readonly history: RoundRecord[] = [];
  private readonly rng: () => number;
  private readonly clock: Clock;
  private tier = 1;
  private roundsWithCorrect = 0;
  private roundNumber = 1;
  private readonly usedIds: string[] = [];
  private state: [ResolvedPlayer, ResolvedPlayer];
  private live: LiveSlotRound | null = null;
  private liveEnd: MatchEnd | null = null;
  private readonly hintsUsed = new Map<string, number>();

  constructor(private readonly options: MatchOptions) {
    if (options.players[0].id === options.players[1].id) {
      throw new Error('the two players need different ids');
    }
    this.rng = options.rng ?? Math.random;
    this.clock = options.clock ?? frozenClock;
    this.state = options.players.map((player) => ({
      id: player.id,
      hp: STARTING_HP,
      combo: 0,
      ultimateCharge: 0,
    })) as [ResolvedPlayer, ResolvedPlayer];
  }

  get usedQuestionIds(): readonly string[] {
    return this.usedIds;
  }

  get livePlayers(): readonly [ResolvedPlayer, ResolvedPlayer] {
    return this.state;
  }

  async play(): Promise<MatchOutcome> {
    let end: MatchEnd | null = null;
    while (this.roundNumber <= MAX_ROUNDS && end === null) {
      end = await this.playRound();
      if (end === null) this.roundNumber += 1;
    }
    if (end === null || this.history.length === 0) {
      throw new Error('match ended without a result');
    }
    return {
      winnerId: end.winnerId,
      reason: end.reason,
      roundCount: this.history.length,
      history: this.history,
      players: this.state,
    };
  }

  private async playRound(): Promise<MatchEnd | null> {
    const matchTier = this.tier;
    const question = this.pickQuestion(matchTier);
    const shown = publicQuestion(question);
    const durationMs = roundDurationMs(question);
    const startedAtMs = this.clock.now();

    const turns: [PlayerTurn, PlayerTurn] = [
      await ask(this.options.players[0], shown, durationMs),
      await ask(this.options.players[1], shown, durationMs),
    ];
    const judged: [JudgedAnswer, JudgedAnswer] = [
      judge(question, turns[0], durationMs),
      judge(question, turns[1], durationMs),
    ];

    const result = resolveRound({
      questionType: question.type,
      questionTier: question.difficulty,
      roundNumber: this.roundNumber,
      roundDurationMs: durationMs,
      matchTier,
      roundsWithCorrect: this.roundsWithCorrect,
      players: [
        { id: this.state[0].id, hp: this.state[0].hp, combo: this.state[0].combo, answer: judged[0] },
        { id: this.state[1].id, hp: this.state[1].hp, combo: this.state[1].combo, answer: judged[1] },
      ],
    });

    this.state = result.players;
    this.tier = result.nextTier;
    this.roundsWithCorrect = result.roundsWithCorrect;
    this.usedIds.push(question.id);
    this.history.push({
      roundNumber: this.roundNumber,
      matchTier,
      startedAtMs,
      durationMs,
      question,
      shown,
      answers: [
        {
          playerId: this.options.players[0].id,
          submitted: turns[0].answer,
          answerMs: turns[0].answerMs,
          status: judged[0].status,
        },
        {
          playerId: this.options.players[1].id,
          submitted: turns[1].answer,
          answerMs: turns[1].answerMs,
          status: judged[1].status,
        },
      ],
      result,
    });
    return result.matchEnd;
  }

  /** Opens one real-time round. Call settle or submitLive until it finishes, then call again. */
  beginLiveRound(): LiveRoundOpen | null {
    if (this.live || this.liveEnd) return null;
    if (this.roundNumber > MAX_ROUNDS) return null;
    const matchTier = this.tier;
    const question = this.pickQuestion(matchTier);
    const shown = publicQuestion(question);
    const durationMs = roundDurationMs(question);
    const startedAtMs = this.clock.now();
    this.live = {
      question,
      shown,
      matchTier,
      startedAtMs,
      durationMs,
      slots: [
        { counted: false, submitted: null, answerMs: null, status: null },
        { counted: false, submitted: null, answerMs: null, status: null },
      ],
    };
    return {
      roundNumber: this.roundNumber,
      tier: matchTier,
      durationMs,
      startedAtMs,
      shown,
      questionId: question.id,
    };
  }

  submitLive(playerId: string, answer: string, nowMs: number): LiveSubmit {
    const live = this.live;
    if (!live) return { kind: 'ignored' };
    const side = this.side(playerId);
    if (side === null) return { kind: 'ignored' };
    const deadline = live.startedAtMs + live.durationMs;
    if (nowMs > deadline) return { kind: 'ignored' };
    const slot = live.slots[side];
    if (slot.counted) return { kind: 'ignored' };

    const hintsKey = `${playerId}\0${live.question.id}`;
    const hintsUsed = this.hintsUsed.get(hintsKey) ?? 0;
    const grade = gradeSubmission(live.question, answer, hintsUsed);
    if (grade.status === 'suggest') {
      this.hintsUsed.set(hintsKey, hintsUsed + 1);
      return { kind: 'hint', suggestion: grade.suggestion };
    }

    slot.counted = true;
    slot.submitted = answer;
    slot.answerMs = Math.max(0, nowMs - live.startedAtMs);
    slot.status = grade.status;
    if (!this.shouldClose(live)) return { kind: 'accepted' };
    return { kind: 'finished', result: this.settle('early') };
  }

  /** Deadline reached. Unanswered players time out. */
  closeLiveRound(): ResolveRoundResult | null {
    if (!this.live) return null;
    return this.settle('deadline');
  }

  private pickQuestion(matchTier: number): Question {
    if (this.options.chooseQuestion) {
      return this.options.chooseQuestion(matchTier, this.usedIds, this.rng);
    }
    return nextQuestion(
      matchTier,
      this.usedIds,
      this.rng,
      this.usedIds.slice(-5),
      this.options.preferredType,
    );
  }

  private side(playerId: string): 0 | 1 | null {
    if (this.options.players[0].id === playerId) return 0;
    if (this.options.players[1].id === playerId) return 1;
    return null;
  }

  private shouldClose(live: LiveSlotRound): boolean {
    const race = (RACE_MODE_TYPES as readonly QuestionType[]).includes(live.question.type);
    if (race) return live.slots.some((slot) => slot.status === 'correct');
    return live.slots.every((slot) => slot.counted);
  }

  private settle(mode: 'early' | 'deadline'): ResolveRoundResult {
    const live = this.live;
    if (!live) throw new Error('no live round');
    this.live = null;
    const judged = [0, 1].map((index) => this.engineAnswer(live, index as 0 | 1, mode)) as [
      JudgedAnswer,
      JudgedAnswer,
    ];
    const result = resolveRound({
      questionType: live.question.type,
      questionTier: live.question.difficulty,
      roundNumber: this.roundNumber,
      roundDurationMs: live.durationMs,
      matchTier: live.matchTier,
      roundsWithCorrect: this.roundsWithCorrect,
      players: [
        { id: this.options.players[0].id, hp: this.state[0].hp, combo: this.state[0].combo, answer: judged[0] },
        { id: this.options.players[1].id, hp: this.state[1].hp, combo: this.state[1].combo, answer: judged[1] },
      ],
    });
    this.state = result.players;
    this.tier = result.nextTier;
    this.roundsWithCorrect = result.roundsWithCorrect;
    this.usedIds.push(live.question.id);
    this.history.push({
      roundNumber: this.roundNumber,
      matchTier: live.matchTier,
      startedAtMs: live.startedAtMs,
      durationMs: live.durationMs,
      question: live.question,
      shown: live.shown,
      answers: [
        recorded(this.options.players[0].id, live.slots[0]),
        recorded(this.options.players[1].id, live.slots[1]),
      ],
      result,
    });
    if (result.matchEnd) this.liveEnd = result.matchEnd;
    else this.roundNumber += 1;
    return result;
  }

  /**
   * A race that closes on the first correct answer freezes the other player
   * unless they already answered wrong. resolveRound treats that freeze as a
   * slower correct answer.
   */
  private engineAnswer(live: LiveSlotRound, index: 0 | 1, mode: 'early' | 'deadline'): JudgedAnswer {
    const slot = live.slots[index];
    if (slot.status) return { status: slot.status, answerMs: slot.answerMs };
    const race = (RACE_MODE_TYPES as readonly QuestionType[]).includes(live.question.type);
    if (mode === 'early' && race) {
      const winner = live.slots.find((item) => item.status === 'correct');
      if (winner) return { status: 'correct', answerMs: (winner.answerMs ?? 0) + 1 };
    }
    return { status: 'timeout', answerMs: null };
  }
}

interface LiveSlot {
  counted: boolean;
  submitted: string | null;
  answerMs: number | null;
  status: AnswerStatus | null;
}

interface LiveSlotRound {
  question: Question;
  shown: PublicQuestion;
  matchTier: number;
  startedAtMs: number;
  durationMs: number;
  slots: [LiveSlot, LiveSlot];
}

function recorded(playerId: string, slot: LiveSlot): RecordedAnswer {
  return {
    playerId,
    submitted: slot.submitted,
    answerMs: slot.answerMs,
    status: slot.status ?? 'timeout',
  };
}

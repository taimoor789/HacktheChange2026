// OWNER A: one match, round by round. No sockets and no waiting.
// Players only receive the public question. answerMs comes from the player, not from a clock sleep.
import type { PublicQuestion, Question } from '@beatcode/shared';
import { MAX_ROUNDS, STARTING_HP } from '@beatcode/shared';
import type { AnswerStatus, JudgedAnswer, MatchEnd, ResolvedPlayer, ResolveRoundResult } from './engine/resolveRound';
import { resolveRound } from './engine/resolveRound';
import { answerIsCorrect, nextQuestion, publicQuestion, roundDurationMs } from './matchQuestions';

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
 * Bot and terminal players implement this later.
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
}

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
    const recentIds = this.usedIds.slice(-5);
    const question = nextQuestion(matchTier, this.usedIds, this.rng, recentIds);
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
}

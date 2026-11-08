// OWNER A: bot opponent so a judge can play solo.
// Responsible for: "answering" after a random delay with configurable accuracy.
// Others expect: the bot looks like a normal player (PlayerState.isBot = true) to B.
import type { Question } from '@beatcode/shared';

export interface BotConfig {
  /** 0..1 chance of answering correctly. */
  accuracy: number;
  minDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_BOT_CONFIG: BotConfig = { accuracy: 0.65, minDelayMs: 3000, maxDelayMs: 12000 };

/**
 * Schedule the bot's answer for a question. Calls `submit` with a correct or wrong answer.
 * Returns a cancel function. The bot may read question.acceptedAnswers (server-side only).
 */
export function scheduleBotAnswer(
  _question: Question,
  _submit: (answer: string) => void,
  _config: BotConfig = DEFAULT_BOT_CONFIG,
): () => void {
  // TODO(OWNER A): setTimeout with random delay; pick acceptedAnswers[0] or a wrong string.
  return () => {};
}

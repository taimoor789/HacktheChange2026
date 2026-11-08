// OWNER B: mock server that plays a short scripted match so the UI can be built without the server.
// Responsible for: emitting match:found, a few round:start / round:result, then match:end.
// Triggered when the UI emits `queue:join`. Enable with VITE_USE_MOCK=true.
// TODO(OWNER B): extend the script (ultimate:ready, comeback, wrong answers) to exercise every UI state.
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  STARTING_HP,
  type ClientToServerEvents,
  type PlayerState,
  type ServerToClientEvents,
} from '@beatcode/shared';

type Handler = (payload: never) => void;

const player = (id: string, name: string, characterId: string, hp: number): PlayerState => ({
  id,
  name,
  characterId,
  hp,
  maxHp: STARTING_HP,
  combo: 0,
  ultimateCharge: 0,
  tier: 1,
  isBot: id === 'bot',
});

export function createMockSocket() {
  const handlers = new Map<string, Set<Handler>>();

  const fire = <E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ) => handlers.get(event)?.forEach((h) => (h as (...a: unknown[]) => void)(...args));

  function playScript(name: string, characterId: string) {
    const me = player('me', name, characterId, STARTING_HP);
    const bot = player('bot', 'Bot', 'python-snake', STARTING_HP);
    const matchId = 'mock-match';
    const question = {
      id: 'mock-1',
      type: 'fill_blank' as const,
      difficulty: 1,
      concept: 'loops',
      prompt: 'Complete the loop.',
      code: 'for i ___ range(5):',
    };

    setTimeout(() => fire(SERVER_EVENTS.MATCH_FOUND, { matchId, you: me, opponent: bot }), 500);
    [1, 2, 3].forEach((round) => {
      const start = 1500 + (round - 1) * 4000;
      setTimeout(
        () =>
          fire(SERVER_EVENTS.ROUND_START, {
            matchId,
            round,
            tier: 1,
            question,
            deadline: Date.now() + 3000,
            serverNow: Date.now(),
          }),
        start,
      );
      setTimeout(() => {
        const hit = round % 2 === 1;
        me.hp = hit ? me.hp : me.hp - 10;
        bot.hp = hit ? bot.hp - 20 : bot.hp;
        me.combo = hit ? me.combo + 1 : 0;
        me.ultimateCharge = Math.min(100, me.ultimateCharge + 15);
        fire(SERVER_EVENTS.ROUND_RESULT, {
          matchId,
          round,
          questionId: question.id,
          outcomes: {
            me: { answered: hit, correct: hit, answerMs: 1200 },
            bot: { answered: !hit, correct: !hit, answerMs: 1800 },
          },
          damage: {
            to: hit ? 'bot' : 'me',
            amount: hit ? 20 : 10,
            attackSize: 'light',
            attacker: hit ? 'me' : 'bot',
          },
          players: { me: { ...me }, bot: { ...bot } },
          nextTier: 1,
        });
      }, start + 3200);
    });
    setTimeout(
      () =>
        fire(SERVER_EVENTS.MATCH_END, {
          matchId,
          winnerId: 'me',
          players: { me: { ...me }, bot: { ...bot } },
          review: [
            {
              questionId: question.id,
              type: question.type,
              concept: question.concept,
              prompt: question.prompt,
              code: question.code,
              correctAnswer: 'in',
              explanation: 'A for loop iterates with "for x in sequence".',
              answers: { me: { submitted: 'in', correct: true }, bot: { submitted: null, correct: false } },
            },
          ],
        }),
      14000,
    );
  }

  return {
    on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler as Handler);
    },
    off<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
      handlers.get(event)?.delete(handler as Handler);
    },
    emit<E extends keyof ClientToServerEvents>(
      event: E,
      ...args: Parameters<ClientToServerEvents[E]>
    ) {
      if (event === CLIENT_EVENTS.QUEUE_JOIN) {
        const p = args[0] as { name: string; characterId: string };
        playScript(p.name, p.characterId);
      }
    },
  };
}

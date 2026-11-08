// Type answers in a real human-vs-human match.
// Terminal 1: npm run terminal-client -w server -- Ada
// Terminal 2: npm run terminal-client -w server -- Bea
// The server must already be running (npm run dev -w server).
import readline from 'node:readline';
import { io } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AnswerHintPayload,
  type MatchEndPayload,
  type MatchFoundPayload,
  type RoundResultPayload,
  type RoundStartPayload,
  type UltimateReadyPayload,
} from '@beatcode/shared';

const name = process.argv[2] ?? 'Player';
const url = process.argv[3] ?? process.env.SERVER_URL ?? 'http://localhost:3001';

const socket = io(url, { transports: ['websocket'] });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let myId = '';
let matchId = '';
let round = 0;
let questionId = '';
let hint: string | null = null;
let open = false;

function showQuestion(payload: RoundStartPayload) {
  matchId = payload.matchId;
  round = payload.round;
  questionId = payload.question.id;
  hint = null;
  open = true;
  const seconds = Math.max(0, Math.round((payload.deadline - payload.serverNow) / 1000));
  console.log(`\nRound ${payload.round}  tier ${payload.tier}  ${payload.question.type}  ${seconds}s`);
  console.log(payload.question.prompt);
  if (payload.question.code) console.log(payload.question.code);
  if (payload.question.options) console.log(payload.question.options.map((option, i) => `${i}. ${option}`).join('\n'));
  console.log('Type an answer.');
}

rl.on('line', (line) => {
  if (!open || !matchId) return;
  const typed = line.trim();
  const answer = typed === '' && hint ? hint : typed;
  if (!answer) return;
  hint = null;
  socket.emit(CLIENT_EVENTS.ANSWER_SUBMIT, { matchId, round, questionId, answer });
});

socket.on('connect', () => {
  console.log(`Connected as ${name}. Waiting for an opponent at ${url}.`);
  socket.emit(CLIENT_EVENTS.QUEUE_JOIN, { name, characterId: 'player' });
});

socket.on(SERVER_EVENTS.MATCH_FOUND, (payload: MatchFoundPayload) => {
  myId = payload.you.id;
  matchId = payload.matchId;
  console.log(`Matched with ${payload.opponent.name}.`);
});

socket.on(SERVER_EVENTS.ROUND_START, (payload: RoundStartPayload) => showQuestion(payload));

socket.on(SERVER_EVENTS.ANSWER_HINT, (payload: AnswerHintPayload) => {
  hint = payload.suggestion;
  console.log(`Did you mean: ${payload.suggestion}`);
  console.log('Press Enter to submit it, or type a different answer.');
});

socket.on(SERVER_EVENTS.ULTIMATE_READY, (payload: UltimateReadyPayload) => {
  console.log(`Ultimate ready: ${payload.playerId === myId ? 'you' : payload.playerId}`);
});

socket.on(SERVER_EVENTS.ROUND_RESULT, (payload: RoundResultPayload) => {
  open = false;
  const mine = payload.outcomes[myId];
  const hits =
    payload.damage.length === 0
      ? 'no hit'
      : payload.damage
          .map((hit) => `${hit.attacker ?? 'miss'} -> ${hit.to} ${hit.attackSize} ${hit.amount}`)
          .join(', ');
  console.log(
    `Result: you ${mine?.correct ? 'correct' : mine?.answered ? 'wrong' : 'missed'}` +
      `${mine?.answerMs === undefined ? '' : ` ${mine.answerMs}ms`} | ${hits}`,
  );
  for (const player of Object.values(payload.players)) {
    const who = player.id === myId ? 'you' : player.name;
    console.log(`HP ${who} ${player.hp}  combo ${player.combo}`);
  }
});

socket.on(SERVER_EVENTS.MATCH_END, (payload: MatchEndPayload) => {
  open = false;
  const winner =
    payload.winnerId === null ? 'Draw' : payload.winnerId === myId ? 'You win' : 'You lose';
  console.log(`${winner} (${payload.reason})`);
  rl.close();
  socket.close();
});

socket.on('connect_error', (error: Error) => {
  console.error(`Could not connect to ${url}: ${error.message}`);
});

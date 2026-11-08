// Type answers in a real human-vs-human match.
// Queue:    npm run terminal-client -w server -- Ada
//           npm run terminal-client -w server -- Bea
// Lobby:    npm run terminal-client -w server -- Ada --create
//           npm run terminal-client -w server -- Bea --join CODE
// The server must already be running (npm run dev -w server).
import readline from 'node:readline';
import { io } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AnswerHintPayload,
  type LobbyClosedPayload,
  type LobbyCreatedPayload,
  type LobbyErrorPayload,
  type MatchEndPayload,
  type MatchFoundPayload,
  type RoundResultPayload,
  type RoundStartPayload,
  type UltimateReadyPayload,
} from '@beatcode/shared';

const args = process.argv.slice(2);
let name = 'Player';
let url = process.env.SERVER_URL ?? 'http://localhost:3001';
let mode: 'queue' | 'create' | 'join' = 'queue';
let joinCode = '';
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? '';
  if (arg === '--create') mode = 'create';
  else if (arg === '--join') {
    mode = 'join';
    joinCode = args[i + 1] ?? '';
    i += 1;
  } else if (arg.startsWith('http://') || arg.startsWith('https://')) url = arg;
  else if (!arg.startsWith('--')) name = arg;
}

const socket = io(url, { transports: ['websocket'] });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

let myId = '';
let opponentName = 'opponent';
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
  if (mode === 'create') {
    console.log(`Connected as ${name}. Creating a lobby at ${url}.`);
    socket.emit(CLIENT_EVENTS.LOBBY_CREATE, { displayName: name });
    return;
  }
  if (mode === 'join') {
    console.log(`Connected as ${name}. Joining lobby ${joinCode} at ${url}.`);
    socket.emit(CLIENT_EVENTS.LOBBY_JOIN, { code: joinCode, displayName: name });
    return;
  }
  console.log(`Connected as ${name}. Waiting for an opponent at ${url}.`);
  socket.emit(CLIENT_EVENTS.QUEUE_JOIN, { name, characterId: 'player' });
});

socket.on(SERVER_EVENTS.LOBBY_CREATED, (payload: LobbyCreatedPayload) => {
  console.log(`Lobby code: ${payload.code}`);
  console.log('Waiting for an opponent.');
});

socket.on(SERVER_EVENTS.LOBBY_CLOSED, (payload: LobbyClosedPayload) => {
  console.log(payload.reason === 'expired' ? 'Lobby expired.' : 'Lobby closed.');
  rl.close();
  socket.close();
});

socket.on(SERVER_EVENTS.LOBBY_ERROR, (payload: LobbyErrorPayload) => {
  console.log(`Could not use that lobby (${payload.reason}).`);
});

function side(id: string): string {
  return id === myId ? 'you' : opponentName;
}

function endLine(payload: MatchEndPayload): string {
  if (payload.reason === 'forfeit') {
    return payload.winnerId === myId ? 'Your opponent left. You win.' : 'You left the match.';
  }
  const outcome = payload.winnerId === null ? 'Draw' : payload.winnerId === myId ? 'You win' : 'You lose';
  const because =
    payload.reason === 'hp_zero'
      ? 'Knockout.'
      : payload.reason === 'tiers_complete'
        ? 'The ladder is finished.'
        : 'The round limit was reached.';
  return `${outcome}. ${because}`;
}

socket.on(SERVER_EVENTS.MATCH_FOUND, (payload: MatchFoundPayload) => {
  myId = payload.you.id;
  opponentName = payload.opponent.name;
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
  console.log(`Ultimate ready: ${side(payload.playerId)}`);
});

socket.on(SERVER_EVENTS.ROUND_RESULT, (payload: RoundResultPayload) => {
  open = false;
  const mine = payload.outcomes[myId];
  const hits =
    payload.damage.length === 0
      ? 'no hit'
      : payload.damage
          .map((hit) => `${hit.attacker ? side(hit.attacker) : 'miss'} -> ${side(hit.to)} ${hit.attackSize} ${hit.amount}`)
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
  console.log(endLine(payload));
  rl.close();
  socket.close();
});

socket.on('connect_error', (error: Error) => {
  console.error(`Could not connect to ${url}: ${error.message}`);
});

// Plays one match between two scripted players. No sockets, no real waiting.
// The last line prints the end reason: hp_zero, tiers_complete, or max_rounds.
// Run: npm run simulate -w server
import type { ResolveRoundResult } from '../src/engine/resolveRound';
import { Match, type MatchPlayer } from '../src/match';
import { correctAnswerFor } from '../src/matchQuestions';

const SEED = 2026;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let calls = 0;

/** Players trade correct answers near the deadline, so neither builds an ultimate or gets knocked out. */
function scripted(id: string, answersEvenRounds: boolean): MatchPlayer {
  return {
    id,
    respond(question, durationMs) {
      const roundIndex = Math.floor(calls++ / 2);
      const mine = answersEvenRounds ? roundIndex % 2 === 0 : roundIndex % 2 === 1;
      const answerMs = Math.floor(durationMs * 0.9);
      return { answer: mine ? correctAnswerFor(question.id) : '___wrong___', answerMs };
    },
  };
}

function hits(result: ResolveRoundResult): string {
  if (result.damage.length === 0) return 'no hit';
  return result.damage
    .map((hit) => `${hit.attacker ?? 'miss'} -> ${hit.to} ${hit.attackSize} ${hit.amount}`)
    .join(', ');
}

const rng = mulberry32(SEED);
const match = new Match({
  rng,
  players: [scripted('p1', true), scripted('p2', false)],
});

const outcome = await match.play();

console.log('Seed 2026. The players trade correct answers near the deadline, so the ladder can finish.');
for (const round of outcome.history) {
  const [a, b] = round.answers;
  const [pa, pb] = round.result.players;
  const time = (ms: number | null) => (ms === null ? 'timeout' : `${ms}ms`);
  console.log(
    `R${round.roundNumber} tier ${round.matchTier} ${round.question.type} | ` +
      `${a.playerId} ${a.status} ${time(a.answerMs)} | ${b.playerId} ${b.status} ${time(b.answerMs)} | ` +
      `${hits(round.result)} | ult ${round.result.ultimateFired ? 'yes' : 'no'} | ` +
      `HP ${pa.id} ${pa.hp} ${pb.id} ${pb.hp} | combo ${pa.id} ${pa.combo} ${pb.id} ${pb.combo}`,
  );
}

const who = outcome.winnerId === null ? 'Draw' : `Winner ${outcome.winnerId}`;
console.log(`${who} (${outcome.reason}) after ${outcome.roundCount} rounds`);

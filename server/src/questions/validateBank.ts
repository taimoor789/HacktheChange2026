// OWNER C: CLI check for the question bank. Run: npm run validate:bank -w server
// Prints a summary per tier and exits non-zero if anything is invalid.
import { loadBankReport } from './schema';

const { questions, errors } = loadBankReport();

const byTier: Record<number, Record<string, number>> = {};
for (const q of questions) {
  byTier[q.difficulty] ??= {};
  byTier[q.difficulty][q.type] = (byTier[q.difficulty][q.type] ?? 0) + 1;
}
for (const [tier, types] of Object.entries(byTier)) {
  const total = Object.values(types).reduce((a, b) => a + b, 0);
  const detail = Object.entries(types)
    .map(([t, n]) => `${t}:${n}`)
    .join(' ');
  console.log(`tier ${tier}: ${total} questions (${detail})`);
}
console.log(`total: ${questions.length} questions`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  errors.forEach((e) => console.error(` - ${e}`));
  process.exit(1);
}
console.log('bank OK');

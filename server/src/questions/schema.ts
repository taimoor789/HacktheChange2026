// OWNER C: runtime validation of the Question type + bank loading.
// Responsible for: catching malformed questions before they reach a match.
// Others expect: nothing directly; A only calls the selector (which uses loadBank()).
import type { Question, QuestionType } from '@beatcode/shared';
import { LADDER, MAX_TIER } from './ladder';
import { codeTokens } from './answerMatching';
import tier1 from './bank/tier1.json';
import tier2 from './bank/tier2.json';
import tier3 from './bank/tier3.json';
import tier4 from './bank/tier4.json';
import tier5 from './bank/tier5.json';
import tier6 from './bank/tier6.json';
import javascript from './bank/javascript.json';
import sql from './bank/sql.json';
import rewrite from './bank/rewrite.json';

export const QUESTION_TYPES: readonly QuestionType[] = [
  'fill_blank',
  'name_concept',
  'output_prediction',
  'spot_the_bug',
  'rewrite_code',
];

/** Raw bank files keyed by file name. Add a new tier file here. */
export const BANK_FILES: Record<string, unknown> = {
  'tier1.json': tier1,
  'tier2.json': tier2,
  'tier3.json': tier3,
  'tier4.json': tier4,
  'tier5.json': tier5,
  'tier6.json': tier6,
  'javascript.json': javascript,
  'sql.json': sql,
  'rewrite.json': rewrite,
};

export type ValidationResult = { ok: true; value: Question } | { ok: false; errors: string[] };

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

export function validateQuestion(obj: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ok: false, errors: ['question must be an object'] };
  }
  const q = obj as Record<string, unknown>;

  if (!isNonEmptyString(q.id)) errors.push('id must be a non-empty string');
  if (!QUESTION_TYPES.includes(q.type as QuestionType)) {
    errors.push(`type must be one of ${QUESTION_TYPES.join(', ')}`);
  }

  const tier = q.difficulty;
  const tierOk =
    typeof tier === 'number' && Number.isInteger(tier) && tier >= 1 && tier <= MAX_TIER;
  if (!tierOk) errors.push(`difficulty must be an integer 1..${MAX_TIER}`);

  if (!isNonEmptyString(q.concept)) {
    errors.push('concept must be a non-empty string');
  } else if (tierOk && !LADDER[tier as number]?.includes(q.concept)) {
    errors.push(
      `concept "${q.concept}" is not in the ladder for tier ${tier} (${LADDER[tier as number]?.join(', ')})`,
    );
  }

  if (!isNonEmptyString(q.prompt)) errors.push('prompt must be a non-empty string');
  if (q.code !== undefined && !isNonEmptyString(q.code))
    errors.push('code must be a non-empty string if present');
  if (!isNonEmptyString(q.explanation)) errors.push('explanation must be a non-empty string');

  let options: string[] | undefined;
  if (q.options !== undefined) {
    if (!Array.isArray(q.options) || q.options.length < 2 || !q.options.every(isNonEmptyString)) {
      errors.push('options must be an array of at least 2 non-empty strings');
    } else {
      options = q.options as string[];
      if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) {
        errors.push('options must be unique');
      }
    }
  }

  let answers: string[] | undefined;
  if (
    !Array.isArray(q.acceptedAnswers) ||
    q.acceptedAnswers.length === 0 ||
    !q.acceptedAnswers.every(isNonEmptyString)
  ) {
    errors.push('acceptedAnswers must be a non-empty array of non-empty strings');
  } else {
    answers = q.acceptedAnswers as string[];
  }

  // Per-type rules
  const code = typeof q.code === 'string' ? q.code : undefined;
  if (q.type === 'fill_blank' && !code?.includes('___')) {
    errors.push('fill_blank needs code containing the ___ blank');
  }
  if ((q.type === 'output_prediction' || q.type === 'spot_the_bug') && !code) {
    errors.push(`${q.type} needs code`);
  }
  if (q.type === 'spot_the_bug' && answers && code) {
    const lines = code.split('\n').length;
    for (const a of answers) {
      if (!/^\d+$/.test(a.trim()) || Number(a) < 1 || Number(a) > lines) {
        errors.push(`spot_the_bug answers must be line numbers 1..${lines}, got "${a}"`);
      }
    }
  } else if (options && answers) {
    for (const a of answers) {
      if (!options.some((o) => o.trim().toLowerCase() === a.trim().toLowerCase())) {
        errors.push(`accepted answer "${a}" is not one of the options`);
      }
    }
  }

  if (
    q.seconds !== undefined &&
    (typeof q.seconds !== 'number' || !(q.seconds >= 5 && q.seconds <= 300))
  ) {
    errors.push('seconds must be a number between 5 and 300');
  }
  if (q.type === 'rewrite_code') {
    if (!code) errors.push('rewrite_code needs the buggy code in `code`');
    if (typeof q.seconds !== 'number' || q.seconds < 30) {
      errors.push('rewrite_code needs seconds >= 30 (typing code takes time)');
    }
    if (options) errors.push('rewrite_code cannot have options');
    if (answers && code) {
      const ci = typeof q.concept === 'string' && q.concept.startsWith('sql');
      const buggy = codeTokens(code, ci).join(' ');
      for (const a of answers) {
        const t = codeTokens(a, ci).join(' ');
        if (t === '') errors.push('rewrite_code accepted answer has no code');
        if (t === buggy) errors.push('rewrite_code accepted answer is identical to the buggy code');
      }
    }
  }

  // Typing speed matters: free-text answers must not need brackets, braces or quotes.
  if (answers && !options && q.type !== 'spot_the_bug' && q.type !== 'rewrite_code') {
    for (const a of answers) {
      if (/[[\]{}()"'`]/.test(a) || a.includes('\n')) {
        errors.push(
          `free-text answer "${a}" needs brackets/quotes/newlines: use a shorter answer or options`,
        );
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: obj as unknown as Question };
}

export interface BankReport {
  questions: Question[];
  errors: string[];
}

/** Validate every bank file and collect ALL problems (used by loadBank and the CLI). */
export function loadBankReport(files: Record<string, unknown> = BANK_FILES): BankReport {
  const questions: Question[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const [file, content] of Object.entries(files)) {
    if (!Array.isArray(content)) {
      errors.push(`${file}: must contain a JSON array`);
      continue;
    }
    const fileTier = Number(/^tier(\d+)\.json$/.exec(file)?.[1]);
    content.forEach((item, i) => {
      const label = `${file}[${i}]${typeof item?.id === 'string' ? ` (${item.id})` : ''}`;
      const result = validateQuestion(item);
      if (!result.ok) {
        result.errors.forEach((e) => errors.push(`${label}: ${e}`));
        return;
      }
      const q = result.value;
      if (seen.has(q.id)) errors.push(`${label}: duplicate id "${q.id}"`);
      seen.add(q.id);
      if (fileTier && q.difficulty !== fileTier) {
        errors.push(`${label}: difficulty ${q.difficulty} does not match file ${file}`);
      }
      questions.push(q);
    });
  }
  return { questions, errors };
}

let cached: Question[] | undefined;

/** Load and validate the whole bank once. Throws with every problem listed if anything is invalid. */
export function loadBank(): Question[] {
  if (cached) return cached;
  const { questions, errors } = loadBankReport();
  if (errors.length) throw new Error(`Invalid question bank:\n - ${errors.join('\n - ')}`);
  cached = questions;
  return questions;
}

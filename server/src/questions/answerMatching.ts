// OWNER C: answer matching per question type.
// Responsible for: deciding whether a submitted answer is correct.
// Others expect: A calls isCorrect(question, submitted) server-side only (never on the client).
//
// Rules:
//   fill_blank / name_concept : case-insensitive, whitespace collapsed, wrapping quotes, trailing ";" and "()" ignored.
//   output_prediction         : case-sensitive; line endings and per-line whitespace ignored; a multi-line
//                               output may also be typed on one line separated by spaces ("1 2 3").
//   spot_the_bug              : answer is a 1-based line number of `code` ("3" or "line 3").
//   rewrite_code              : multi-line. Compared as code tokens: indentation, line breaks, spacing, ";" and
//                               full-line comments are ignored. Small spelling mistakes in names/keywords are
//                               forgiven (see matchesCode); any other difference (operators, numbers, missing or
//                               extra tokens) is wrong. SQL is case-insensitive, other languages are case-sensitive.
//   options present           : submit the option text (preferred) or its 0-based index. If a submission
//                               equals an option's text it is always read as text, never as an index.
import type { Question } from '@beatcode/shared';
import { editDistance } from './editDistance';

const MAX_ANSWER_LENGTH = 500;
const MAX_CODE_ANSWER_LENGTH = 3000;
/** Max forgiven misspelled names/keywords in one rewrite_code answer. */
const MAX_CODE_TYPOS = 3;

/** Remove `suffix` from the end of `s`, unless that would leave nothing. */
function stripSuffix(s: string, suffix: string): string {
  return s.endsWith(suffix) && s.length > suffix.length ? s.slice(0, -suffix.length).trim() : s;
}

export function normalizeLoose(s: string): string {
  let t = s.trim().toLowerCase().replace(/\s+/g, ' ');
  const unquoted = t.replace(/^(['"`])(.*)\1$/s, '$2').trim();
  if (unquoted) t = unquoted;
  t = stripSuffix(t, ';');
  t = stripSuffix(t, '()');
  return t;
}

export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Map an option index to its text; leave everything else unchanged. */
function resolveOption(question: Question, submitted: string): string {
  if (!question.options) return submitted;
  const t = submitted.trim();
  const byText = question.options.find((o) => normalizeLoose(o) === normalizeLoose(t));
  if (byText !== undefined) return byText;
  if (/^\d+$/.test(t) && Number(t) < question.options.length) return question.options[Number(t)];
  return submitted;
}

function parseLineNumber(s: string): number | null {
  const m = /^\s*(?:line\s*)?(\d+)\s*$/i.exec(s);
  return m ? Number(m[1]) : null;
}

const TOKEN_RE =
  /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|===|!==|==|!=|<=|>=|<>|\/\/|\*\*|\+\+|--|\+=|-=|\*=|\/=|=>|&&|\|\||\S/g;
const IDENT_RE = /^[A-Za-z_]\w*$/;

/** Split code into comparable tokens. Whitespace, ";" and full-line comments are dropped. */
export function codeTokens(src: string, caseInsensitive = false): string[] {
  const text = src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*(#|\/\/|--(\s|$))/.test(l))
    .join('\n');
  return (text.match(TOKEN_RE) ?? [])
    .filter((t) => t !== ';')
    .map((t) => (caseInsensitive ? t.toLowerCase() : t));
}

/**
 * Typed code matches a reference when the token lists are identical, except for up to MAX_CODE_TYPOS
 * distinct names/keywords that are one small spelling slip away from the reference token. A typed name that is
 * itself a different name used in the reference (item vs items) is a real mistake, not a typo.
 */
export function matchesCode(typed: string[], reference: string[]): boolean {
  if (typed.length === 0 || typed.length !== reference.length) return false;
  const vocabulary = new Set(reference.filter((t) => IDENT_RE.test(t)));
  const typos = new Set<string>(); // distinct misspellings: the same slip used twice counts once
  for (let i = 0; i < typed.length; i++) {
    const a = typed[i];
    const b = reference[i];
    if (a === b) continue;
    const near =
      IDENT_RE.test(a) &&
      IDENT_RE.test(b) &&
      Math.min(a.length, b.length) >= 4 &&
      !vocabulary.has(a) &&
      editDistance(a, b) <= (Math.max(a.length, b.length) >= 9 ? 2 : 1);
    if (!near) return false;
    typos.add(`${a}>${b}`);
    if (typos.size > MAX_CODE_TYPOS) return false;
  }
  return true;
}

export function isCorrect(question: Question, submitted: string): boolean {
  if (typeof submitted !== 'string') return false;
  const maxLength = question.type === 'rewrite_code' ? MAX_CODE_ANSWER_LENGTH : MAX_ANSWER_LENGTH;
  if (submitted.trim() === '' || submitted.length > maxLength) return false;

  switch (question.type) {
    case 'fill_blank':
    case 'name_concept': {
      const s = normalizeLoose(resolveOption(question, submitted));
      return question.acceptedAnswers.some((a) => normalizeLoose(a) === s);
    }
    case 'output_prediction': {
      const s = normalizeOutput(resolveOption(question, submitted));
      return question.acceptedAnswers.some(
        (a) => normalizeOutput(a) === s || collapse(normalizeOutput(a)) === collapse(s),
      );
    }
    case 'spot_the_bug': {
      const n = parseLineNumber(submitted);
      if (n === null) return false;
      return question.acceptedAnswers.some((a) => parseLineNumber(a) === n);
    }
    case 'rewrite_code': {
      const ci = question.concept.startsWith('sql');
      const typed = codeTokens(submitted, ci);
      return question.acceptedAnswers.some((a) => matchesCode(typed, codeTokens(a, ci)));
    }
    default:
      return false;
  }
}

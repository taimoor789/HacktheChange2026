// OWNER C: answer matching per question type.
// Responsible for: deciding whether a submitted answer is correct.
// Others expect: A calls isCorrect(question, submitted) server-side only (never on the client).
//
// Rules:
//   fill_blank / name_concept : case-insensitive, whitespace collapsed, wrapping quotes, trailing ";" and "()" ignored.
//   output_prediction         : case-sensitive; line endings and per-line whitespace ignored; a multi-line
//                               output may also be typed on one line separated by spaces ("1 2 3").
//   spot_the_bug              : answer is a 1-based line number of `code` ("3" or "line 3").
//   rewrite_code              : multi-line. Compared as code tokens. Full-line comments and ";" are ignored.
//                               Small spelling mistakes in names/keywords are forgiven (see matchesCode), but never a real
//                               name (any name in the solution or in the question's shown code) and never a singular/plural
//                               flip (item/items); any other
//                               difference (operators, numbers, missing or extra tokens) is wrong.
//                               SQL is case-insensitive; other languages are case-sensitive.
//                               PYTHON: line breaks and indentation LEVELS are significant (they change the meaning).
//                               Any consistent indent width works (2 spaces, 4 spaces, tab, or a uniform extra indent).
//                               JavaScript and SQL ignore indentation and line breaks.
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

const BLOCK_HEADER =
  /^\s*(?:def|class|if|elif|else|for|while|try|except|finally|with)\b[^\n]*:\s*$/m;

/**
 * Does indentation change the meaning of this question's code? True for Python (detected from block headers
 * ending in ":" in the question's code), false for JavaScript and SQL.
 */
export function hasSignificantIndentation(question: Pick<Question, 'concept' | 'code'>): boolean {
  return !question.concept.startsWith('sql') && BLOCK_HEADER.test(question.code ?? '');
}

const BAD_INDENT = '<bad-indent>';
const INDENT = '<indent>';
const DEDENT = '<dedent>';
const NEWLINE = '<newline>';
const isCommentLine = (l: string) => /^\s*(#|\/\/|--(\s|$))/.test(l);
const indentWidth = (l: string) => (/^[ \t]*/.exec(l)?.[0] ?? '').replace(/\t/g, '    ').length;

/**
 * Split code into comparable tokens. Full-line comments and ";" are dropped.
 * Default: whitespace and line breaks are ignored (JavaScript, SQL).
 * `indentSensitive` (Python): each logical line ends with a newline token, and indentation changes become
 * indent/dedent tokens, so only the nesting structure matters, not the exact width. Lines inside brackets
 * continue the previous line. A dedent to a level that was never opened is invalid and matches nothing.
 */
export function codeTokens(
  src: string,
  caseInsensitive = false,
  indentSensitive = false,
): string[] {
  // In Python and JavaScript 'x' and "x" mean the same thing; SQL keeps them apart.
  const fix = (t: string) => (caseInsensitive ? t.toLowerCase() : t === "'" ? '"' : t);
  const lines = src
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !isCommentLine(l));

  if (!indentSensitive) {
    return (lines.join('\n').match(TOKEN_RE) ?? []).filter((t) => t !== ';').map(fix);
  }

  const out: string[] = [];
  const stack: number[] = [];
  let depth = 0; // open brackets carried over from earlier lines
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    // a trailing "# note" comment (only when the line has no quotes, so strings are never cut)
    const line = /['"`]/.test(raw) ? raw : raw.replace(/\s+#.*$/, '');
    const lineTokens = (line.match(TOKEN_RE) ?? []).filter((x) => x !== ';');
    if (lineTokens.length === 0) continue; // e.g. a lone ";"
    if (depth === 0) {
      const width = indentWidth(line);
      if (stack.length === 0) stack.push(width);
      else if (width > stack[stack.length - 1]) {
        stack.push(width);
        out.push(INDENT);
      } else {
        while (stack.length > 0 && width < stack[stack.length - 1]) {
          stack.pop();
          out.push(DEDENT);
        }
        if (stack.length === 0 || stack[stack.length - 1] !== width) return [BAD_INDENT];
      }
    }
    for (const t of lineTokens) {
      if ('([{'.includes(t)) depth++;
      else if (')]}'.includes(t)) depth = Math.max(0, depth - 1);
      out.push(fix(t));
    }
    if (depth === 0) out.push(NEWLINE);
  }
  for (let i = 1; i < stack.length; i++) out.push(DEDENT);
  return out;
}

/**
 * Typed code matches a reference when the token lists are identical, except for up to MAX_CODE_TYPOS
 * distinct names/keywords that are one small spelling slip away from the reference token. A typed name that is
 * itself a different name used in the reference (item vs items) is a real mistake, not a typo.
 */
export function matchesCode(
  typed: string[],
  reference: string[],
  knownNames: ReadonlySet<string> = new Set(),
): boolean {
  return codeMatch(typed, reference, knownNames).ok;
}

/** True for singular/plural flips (item/items, box/boxes, query/queries): a different name, not a typo. */
export function isPluralFlip(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const longer = (short: string, long: string) =>
    long === short + 's' ||
    long === short + 'es' ||
    (long.endsWith('ies') && short === long.slice(0, -3) + 'y');
  return longer(x, y) || longer(y, x);
}

/** Every name (identifier) used in the code the question shows the player. */
function shownNames(
  question: Question,
  caseInsensitive: boolean,
  indentSensitive: boolean,
): Set<string> {
  const names = codeTokens(question.code ?? '', caseInsensitive, indentSensitive).filter((t) =>
    IDENT_RE.test(t),
  );
  return new Set(names);
}

export interface ForgivenTypo {
  /** What the player typed, e.g. "retrun". */
  typed: string;
  /** What it should have been, e.g. "return". */
  expected: string;
}

/** Like matchesCode, but also reports which misspellings were forgiven (distinct, in order of appearance). */
export function codeMatch(
  typed: string[],
  reference: string[],
  knownNames: ReadonlySet<string> = new Set(),
): { ok: boolean; typos: ForgivenTypo[] } {
  const fail = { ok: false, typos: [] as ForgivenTypo[] };
  // A one-line fix like "while (a <= b) {" may be typed without its opening brace.
  if (reference[reference.length - 1] === '{') {
    reference = reference.slice(0, -1);
    if (typed[typed.length - 1] === '{') typed = typed.slice(0, -1);
  }
  if (typed.length === 0 || typed.length !== reference.length) return fail;
  // names that are real in this problem: used in the solution OR shown in the question's code
  const vocabulary = new Set([...reference.filter((t) => IDENT_RE.test(t)), ...knownNames]);
  const typos = new Map<string, ForgivenTypo>(); // distinct misspellings: the same slip used twice counts once
  for (let i = 0; i < typed.length; i++) {
    const a = typed[i];
    const b = reference[i];
    if (a === b) continue;
    const near =
      IDENT_RE.test(a) &&
      IDENT_RE.test(b) &&
      Math.min(a.length, b.length) >= 4 &&
      !vocabulary.has(a) &&
      !isPluralFlip(a, b) &&
      editDistance(a, b) <= (Math.max(a.length, b.length) >= 9 ? 2 : 1);
    if (!near) return fail;
    typos.set(`${a}>${b}`, { typed: a, expected: b });
    if (typos.size > MAX_CODE_TYPOS) return fail;
  }
  return { ok: true, typos: [...typos.values()] };
}

/**
 * For the post-match review: which misspellings did isCorrect forgive in this rewrite_code answer?
 * Returns null if the answer is not a correct rewrite_code answer, [] if it was exact. Separate from
 * isCorrect, which stays a plain boolean. Pure and deterministic.
 */
export function forgivenTypos(question: Question, submitted: string): ForgivenTypo[] | null {
  if (question.type !== 'rewrite_code' || !isCorrect(question, submitted)) return null;
  const ci = question.concept.startsWith('sql');
  const ind = hasSignificantIndentation(question);
  const typed = codeTokens(submitted, ci, ind);
  const known = shownNames(question, ci, ind);
  let best: ForgivenTypo[] | null = null;
  for (const answer of question.acceptedAnswers) {
    const result = codeMatch(typed, codeTokens(answer, ci, ind), known);
    if (result.ok && (best === null || result.typos.length < best.length)) best = result.typos;
  }
  return best;
}

/**
 * The ONLY judge of a submitted answer. Returns a plain boolean: there is no partial credit, and a typo
 * suggestion (see suggestion.ts) never makes this return true.
 * Pure and deterministic: no code execution, no randomness, no clock, no I/O. It runs the moment a player
 * submits in a race, and takes well under a millisecond even for long rewrite_code answers.
 */
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
      const ind = hasSignificantIndentation(question);
      const typed = codeTokens(submitted, ci, ind);
      const known = shownNames(question, ci, ind);
      return question.acceptedAnswers.some((a) =>
        matchesCode(typed, codeTokens(a, ci, ind), known),
      );
    }
    default:
      return false;
  }
}

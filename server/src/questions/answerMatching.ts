// OWNER C: answer matching per question type.
// Responsible for: deciding whether a submitted answer is correct.
// Others expect: A calls isCorrect(question, submitted) server-side only (never on the client).
//
// Rules:
//   fill_blank / name_concept : case-insensitive, whitespace collapsed, wrapping quotes, trailing ";" and "()" ignored.
//   output_prediction         : case-sensitive; line endings and per-line whitespace ignored; a multi-line
//                               output may also be typed on one line separated by spaces ("1 2 3").
//   spot_the_bug              : answer is a 1-based line number of `code` ("3" or "line 3").
//   options present           : submit the option text (preferred) or its 0-based index. If a submission
//                               equals an option's text it is always read as text, never as an index.
import type { Question } from '@beatcode/shared';

const MAX_ANSWER_LENGTH = 500;

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

export function isCorrect(question: Question, submitted: string): boolean {
  if (typeof submitted !== 'string') return false;
  if (submitted.trim() === '' || submitted.length > MAX_ANSWER_LENGTH) return false;

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
    default:
      return false;
  }
}

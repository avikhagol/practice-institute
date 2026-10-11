import { OPTION_KEYS, type Question, type QuestionWarning, type SourceDoc } from '../types';

export const BANK_LIMITS = { bytes: 10 * 1024 * 1024, questions: 5000, sources: 500 };
export interface Bank {
  format: 'pdf-smart-question-bank';
  version: 1;
  sources: SourceDoc[];
  questions: Question[];
}

export function makeBank(sources: SourceDoc[], questions: Question[]): Bank {
  return { format: 'pdf-smart-question-bank', version: 1, sources, questions };
}

const questionCodes = ['option-count', 'empty-option', 'missing-stem', 'numbering-gap', 'bilingual-duplicate', 'mixed-script', 'passage-context', 'diagram-reference', 'long-option', 'spans-pages'];
const docCodes = ['scanned-or-image-only', 'some-pages-low-text', 'page-limit-truncated', 'no-mcq-found', 'headers-footers-removed', 'legacy-font-encoding', 'preamble-skipped'];

/** All-or-nothing import. Whitelist fields; never interpret imported strings as HTML. */
export function parseBank(text: string): Bank {
  if (new TextEncoder().encode(text).length > BANK_LIMITS.bytes) throw new Error('Bank exceeds the 10 MB JSON limit.');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON. Choose an exported PDF Smart question bank.'); }
  const errors: string[] = [];
  const fail = (path: string, reason: string) => { if (errors.length < 20) errors.push(`${path}: ${reason}`); };
  const obj = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(path, 'expected an object'); return {}; }
    return value as Record<string, unknown>;
  };
  const str = (value: unknown, path: string, nonempty = false): string => {
    if (typeof value !== 'string' || value.length > 100_000 || (nonempty && !value.trim())) {
      fail(path, `expected ${nonempty ? 'nonempty ' : ''}text (maximum 100,000 characters)`); return '';
    }
    return value;
  };
  const nullable = (value: unknown, path: string) => value === null ? null : str(value, path);
  const num = (value: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER, integer = true): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
      fail(path, `expected ${integer ? 'integer' : 'number'} between ${min} and ${max}`); return min;
    }
    return value;
  };
  const bool = (value: unknown, path: string): boolean => { if (typeof value !== 'boolean') fail(path, 'expected true or false'); return value === true; };
  const list = (value: unknown, path: string, max: number): unknown[] => {
    if (!Array.isArray(value) || value.length > max) { fail(path, `expected an array of at most ${max} items`); return []; }
    return value;
  };
  const enumeration = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
    if (!values.includes(value as T)) fail(path, `expected ${values.join(', ')}`);
    return values.includes(value as T) ? value as T : values[0]!;
  };
  const root = obj(data, 'bank');
  if (root.format !== 'pdf-smart-question-bank') fail('format', 'expected pdf-smart-question-bank');
  if (root.version !== 1) fail('version', 'only version 1 is supported');
  const ids = new Set<string>();
  const sources = list(root.sources, 'sources', BANK_LIMITS.sources).map((s, i): SourceDoc => {
    const p = `sources[${i}]`, d = obj(s, p);
    const id = str(d.id, `${p}.id`, true);
    if (ids.has(id)) fail(`${p}.id`, 'duplicate source ID');
    ids.add(id);
    const pageCount = num(d.pageCount, `${p}.pageCount`, 1);
    // Accept the compact version-1 sources exported by the original app.
    return {
      id, fileName: str(d.fileName, `${p}.fileName`, true), label: str(d.label, `${p}.label`, true),
      year: nullable(d.year, `${p}.year`), pageCount,
      synthetic: bool(d.synthetic, `${p}.synthetic`),
      sizeBytes: d.sizeBytes === undefined ? 0 : num(d.sizeBytes, `${p}.sizeBytes`),
      pagesProcessed: d.pagesProcessed === undefined ? pageCount : num(d.pagesProcessed, `${p}.pagesProcessed`, 0, pageCount),
      addedAt: d.addedAt === undefined ? 0 : num(d.addedAt, `${p}.addedAt`),
      warnings: d.warnings === undefined ? [] : list(d.warnings, `${p}.warnings`, 50).map((w, j) => {
        const wp = `${p}.warnings[${j}]`, v = obj(w, wp);
        return { code: enumeration(v.code, `${wp}.code`, docCodes) as SourceDoc['warnings'][number]['code'], message: str(v.message, `${wp}.message`, true) };
      }),
    };
  });
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  const questionIds = new Set<string>();
  const questions = list(root.questions, 'questions', BANK_LIMITS.questions).map((item, i): Question => {
    const p = `questions[${i}]`, q = obj(item, p);
    const id = str(q.id, `${p}.id`, true), docId = str(q.docId, `${p}.docId`, true);
    if (questionIds.has(id)) fail(`${p}.id`, 'duplicate question ID');
    questionIds.add(id);
    const source = sourceMap.get(docId);
    if (!source) fail(`${p}.docId`, 'source is missing');
    const page = num(q.page, `${p}.page`, 1, source?.pageCount);
    const keys = new Set<string>();
    const options = list(q.options, `${p}.options`, 5).map((o, j) => {
      const op = `${p}.options[${j}]`, v = obj(o, op);
      const key = enumeration(v.key, `${op}.key`, OPTION_KEYS);
      if (keys.has(key)) fail(`${op}.key`, 'duplicate option key');
      keys.add(key);
      return { key, sourceLabel: str(v.sourceLabel, `${op}.sourceLabel`), text: str(v.text, `${op}.text`) };
    });
    const answerKey = nullable(q.answerKey, `${p}.answerKey`);
    if (answerKey !== null && !keys.has(answerKey)) fail(`${p}.answerKey`, 'answer does not match an option key');
    const answerSource = enumeration(q.answerSource, `${p}.answerSource`, ['none', 'imported', 'manual'] as const);
    if ((answerKey === null) !== (answerSource === 'none')) fail(`${p}.answerSource`, 'must agree with the supplied answer key');
    const result: Question = {
      id, docId, number: num(q.number, `${p}.number`, 1), page,
      pageEnd: num(q.pageEnd, `${p}.pageEnd`, page, source?.pageCount),
      context: nullable(q.context, `${p}.context`), stem: str(q.stem, `${p}.stem`), options,
      status: enumeration(q.status, `${p}.status`, ['ok', 'needs-review', 'excluded'] as const),
      confidence: num(q.confidence, `${p}.confidence`, 0, 1, false),
      warnings: list(q.warnings, `${p}.warnings`, 50).map((w, j) => {
        const wp = `${p}.warnings[${j}]`, v = obj(w, wp);
        return { code: enumeration(v.code, `${wp}.code`, questionCodes) as QuestionWarning['code'], message: str(v.message, `${wp}.message`, true), blocking: bool(v.blocking, `${wp}.blocking`) };
      }),
      answerKey, answerSource, explanation: nullable(q.explanation, `${p}.explanation`),
      rawText: str(q.rawText, `${p}.rawText`), edited: bool(q.edited, `${p}.edited`),
    };
    if (result.status === 'ok' && (structuralWarnings(result).length || result.warnings.some(w => w.blocking))) fail(`${p}.status`, 'ready questions must have a stem, 2–5 nonempty options and no blocking warnings');
    return result;
  });
  if (errors.length) throw new Error(`Bank was not imported.\n${errors.join('\n')}`);
  return makeBank(sources, questions);
}

export function structuralWarnings(q: Pick<Question, 'stem' | 'options'>): QuestionWarning[] {
  const warnings: QuestionWarning[] = [];
  if (!q.stem.trim()) warnings.push({ code: 'missing-stem', message: 'Add question text before accepting.', blocking: true });
  if (q.options.length < 2 || q.options.length > 5) warnings.push({ code: 'option-count', message: 'Supply 2–5 options before accepting.', blocking: true });
  if (q.options.some(o => !o.text.trim())) warnings.push({ code: 'empty-option', message: 'Fill every option before accepting.', blocking: true });
  return warnings;
}

export function acceptQuestion(q: Question): Question {
  const invalid = structuralWarnings(q);
  if (invalid.length) return { ...q, warnings: [...q.warnings.filter(w => !invalid.some(i => i.code === w.code)), ...invalid], status: q.status === 'excluded' ? 'excluded' : 'needs-review' };
  return { ...q, edited: true, status: q.status === 'excluded' ? 'excluded' : 'ok', warnings: q.warnings.map(w => ({ ...w, blocking: false })) };
}

const normalize = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
/** Ordered options AND context must match; diagram questions and excluded copies are never hidden. */
export function findDuplicates(questions: Question[]) {
  const first = new Map<string, Question>();
  const hidden = new Map<string, string>();
  // Prefer a checked copy so an unresolved original cannot hide a usable question.
  const ordered = [...questions].sort((a, b) => Number(b.status === 'ok') - Number(a.status === 'ok'));
  for (const q of ordered) {
    if (q.status === 'excluded' || structuralWarnings(q).length || q.warnings.some(w => w.code === 'diagram-reference')) continue;
    const fingerprint = JSON.stringify([normalize(q.context ?? ''), normalize(q.stem), q.options.map(o => [o.key, normalize(o.text)]), q.answerKey]);
    const original = first.get(fingerprint);
    if (original && original.docId !== q.docId) hidden.set(q.id, original.id);
    else if (!original) first.set(fingerprint, q);
  }
  return hidden;
}

/** The eligible pool for turn 3. Apply source filters BEFORE calling this helper.
 * Hidden copies remain in exports and are never deleted. */
export function eligibleQuestions(questions: Question[]): Question[] {
  const hidden = findDuplicates(questions);
  return questions.filter(q => q.status === 'ok' && !q.warnings.some(w => w.blocking) && !structuralWarnings(q).length && !hidden.has(q.id));
}

// Heuristic numbered-MCQ parser over cleaned page lines.
// It NEVER invents text, options or answers: anything it cannot split confidently is
// returned with blocking warnings so the review screen forces a human decision.
import { OPTION_KEYS, type DocId, type Question, type QuestionOption, type QuestionWarning } from '../types';

export interface ParseLine {
  text: string;
  page: number;
}

const QUESTION_START = /^(?:Q(?:uestion)?\.?\s*(?:No\.?\s*)?|प्रश्न\s*(?:सं\.?\s*)?)?(\d{1,3})\s*[.)।:]\s*(.*)$/u;

const CONTEXT_START =
  /^(?:directions?\b|read the (?:following|given|passage|extract|poem|stanza|text)|passage\b|निर्देश|नीचे दिए गए|निम्नलिखित\s+(?:गद्यांश|पद्यांश|अनुच्छेद|कविता))/iu;

/** Section/part headings, scratch-space notes and the "-o0o-" end-of-paper mark end the current question. */
const SECTION_BREAK =
  /^(?:part|section|खण्ड|खंड|भाग)\s*[-–:]?\s*(?:[IVX]+|\d+|[A-E])\b|^space for rough work|^rough work|^रफ़? कार्य|^[-–—]?\s*o\s*0\s*o\s*[-–—]?$/iu;

/** Directions shorter than this are treated as generic instructions, not a shared passage. */
const MIN_PASSAGE_CHARS = 200;

const QUESTION_RANGE = /(?:Q(?:uestion)?s?\.?\s*(?:Nos?\.?)?\s*)(\d{1,3})\s*(?:to|-|–|से)\s*(\d{1,3})/iu;

/** Ordinary vocabulary ("a bar graph", "picture stories") is not a reference to a missing figure. */
const DIAGRAM_REF =
  /\b(?:figure|diagram|shown (?:below|above)|(?:the|this|following|given|above|below)\s+(?:graph|picture|map))\b|चित्र|आकृति|आरेख/iu;

/** Passage ranges printed without a "Q." prefix, e.g. "answer the questions that follow : (100 to 105)". */
const PAREN_RANGE = /\((\d{1,3})\s*(?:to|-|–|से)\s*(\d{1,3})\)/u;

const DEVANAGARI = /\p{Script=Devanagari}/gu;
const LATIN = /\p{Script=Latin}/gu;

interface Scheme {
  name: string;
  re: RegExp;
  labels: string[];
  /** Normalises a matched label to its index in `labels`. */
  index: (m: string) => number;
}

const SCHEMES: Scheme[] = [
  { name: 'paren-digit', re: /\(([1-5])\)/gu, labels: ['1', '2', '3', '4', '5'], index: (m) => Number(m) - 1 },
  { name: 'paren-upper', re: /\(([A-E])\)/gu, labels: ['A', 'B', 'C', 'D', 'E'], index: (m) => m.charCodeAt(0) - 65 },
  {
    name: 'upper-dot',
    re: /(?:^|\s)([A-E])[.)](?=\s)/gu,
    labels: ['A', 'B', 'C', 'D', 'E'],
    index: (m) => m.charCodeAt(0) - 65,
  },
  { name: 'paren-lower', re: /\(([a-e])\)/gu, labels: ['a', 'b', 'c', 'd', 'e'], index: (m) => m.charCodeAt(0) - 97 },
  { name: 'digit-close', re: /(?:^|\s)([1-5])[.)](?=\s)/gu, labels: ['1', '2', '3', '4', '5'], index: (m) => Number(m) - 1 },
];

interface LabelHit {
  idx: number;
  start: number;
  end: number;
  raw: string;
}

interface Split {
  scheme: Scheme;
  stem: string;
  options: { sourceLabel: string; text: string }[];
  duplicateSet: boolean;
  /** The second set repeats the first verbatim (e.g. the Hindi version with its legacy-font text hidden). */
  identicalDuplicate: boolean;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** True when labels 0..k-1 occur in order in `hits` (other hits may sit in between). */
function hasOrderedRun(hits: readonly LabelHit[], k: number): boolean {
  let want = 0;
  for (const h of hits) if (h.idx === want && ++want === k) return true;
  return false;
}

/** Find labels of one scheme in strict sequence 1,2,3... and detect a restarted (duplicate) set. */
function splitWithScheme(body: string, scheme: Scheme): Split | null {
  const hits: LabelHit[] = [];
  for (const m of body.matchAll(scheme.re)) {
    const label = m[1] ?? '';
    const full = m[0];
    const lead = full.length - full.trimStart().length;
    const start = (m.index ?? 0) + lead;
    hits.push({ idx: scheme.index(label), start, end: (m.index ?? 0) + full.length, raw: full.trim() });
  }
  const seq: LabelHit[] = [];
  let restart: number | null = null;
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    if (h.idx === seq.length) seq.push(h);
    // A label 1 after option 2+ is a second set only if a complete set as long as the first
    // follows; otherwise it is a cross-reference such as "Both (1) and (3)" inside an option.
    else if (seq.length >= 2 && h.idx === 0 && hasOrderedRun(hits.slice(i), seq.length)) {
      restart = i;
      break;
    }
  }
  if (seq.length < 2) return null;
  const restartAt = restart === null ? null : hits[restart]!.start;
  const stem = body.slice(0, seq[0]!.start).trim();
  const options = seq.map((h, i) => {
    const next = seq[i + 1];
    const stop = next ? next.start : (restartAt ?? body.length);
    return { sourceLabel: h.raw, text: body.slice(h.end, stop).trim() };
  });
  let identicalDuplicate = false;
  if (restart !== null) {
    const second = hits.slice(restart);
    identicalDuplicate =
      second.length === seq.length &&
      second.every((h, i) => {
        const stop = second[i + 1]?.start ?? body.length;
        return h.idx === i && norm(body.slice(h.end, stop)) === norm(options[i]!.text);
      });
  }
  return { scheme, stem, options, duplicateSet: restartAt !== null, identicalDuplicate };
}

function chooseSplit(body: string): Split | null {
  let best: Split | null = null;
  for (const scheme of SCHEMES) {
    const s = splitWithScheme(body, scheme);
    if (!s) continue;
    // Prefer more options; ties keep the earlier (more specific) scheme.
    if (!best || s.options.length > best.options.length) best = s;
    if (best.options.length >= 4) break;
  }
  return best;
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

interface Block {
  number: number;
  section: number;
  lines: ParseLine[];
  context: string | null;
  gap: boolean;
}

function warn(code: QuestionWarning['code'], message: string, blocking: boolean): QuestionWarning {
  return { code, message, blocking };
}

/**
 * Parse numbered MCQs from cleaned lines (headers/footers already removed).
 * Question numbers must increase (small gaps tolerated with a warning); numbering may
 * restart at 1 to start a new section.
 */
export interface ParseResult {
  questions: Question[];
  /** Numbered blocks dropped because their section had (almost) no options, e.g. cover instructions. */
  discardedBlocks: number;
  discardedSections: number;
}

export function parseMcqDocument(docId: DocId, lines: readonly ParseLine[]): ParseResult {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let last = 0;
  let section = 1;
  let contextLines: ParseLine[] | null = null;
  let pendingContext: { text: string; from: number | null; to: number | null } | null = null;

  const closeContext = () => {
    if (contextLines && contextLines.length) {
      const text = contextLines.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim();
      const r = QUESTION_RANGE.exec(text) ?? PAREN_RANGE.exec(text.slice(0, 300));
      pendingContext = text.length >= MIN_PASSAGE_CHARS ? { text, from: r ? Number(r[1]) : null, to: r ? Number(r[2]) : null } : null;
    }
    contextLines = null;
  };

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const m = QUESTION_START.exec(text);
    const n = m ? Number(m[1]) : NaN;
    // The first question may start anywhere (partial papers, later sections) but must carry text.
    const isFirst = m !== null && last === 0 && n >= 1 && n <= 200 && (m[2] ?? '').trim().length > 0;
    const isNext = m !== null && (isFirst || (last > 0 && n > last && n <= last + 5));
    const isRestart = m !== null && n === 1 && last >= 5;
    if (isNext || isRestart) {
      closeContext();
      if (isRestart) section += 1;
      const ctx = pendingContext as { text: string; from: number | null; to: number | null } | null;
      let context: string | null = null;
      if (ctx) {
        if (ctx.from !== null && ctx.to !== null) {
          if (n >= ctx.from && n <= ctx.to) context = ctx.text;
          if (n >= ctx.to) pendingContext = null;
        } else {
          context = ctx.text; // unbounded: applies until the next directions block
        }
      }
      cur = { number: n, section, lines: [{ text: m[2] ?? '', page: line.page }], context, gap: !isRestart && n !== last + 1 && last !== 0 };
      blocks.push(cur);
      last = n;
      continue;
    }
    if (SECTION_BREAK.test(text)) {
      closeContext();
      pendingContext = null;
      cur = null;
      continue;
    }
    if (CONTEXT_START.test(text)) {
      closeContext();
      pendingContext = null;
      contextLines = [line];
      cur = null;
      continue;
    }
    if (contextLines) contextLines.push(line);
    else if (cur) cur.lines.push(line);
    // Lines before the first question (cover page, instructions) are ignored by the parser
    // but remain visible in document mode.
  }

  // A numbered "section" in which almost nothing has options (e.g. the numbered
  // instructions on an exam cover page) is preamble, not questions. Drop it but report it.
  const sections = new Map<number, Block[]>();
  for (const b of blocks) sections.set(b.section, [...(sections.get(b.section) ?? []), b]);
  const kept: Block[] = [];
  let discardedBlocks = 0;
  let discardedSections = 0;
  for (const [, bs] of sections) {
    const withOptions = bs.filter((b) => chooseSplit(b.lines.map((l) => l.text).join(' '))).length;
    if (sections.size > 1 && withOptions / bs.length < 0.2) {
      discardedBlocks += bs.length;
      discardedSections += 1;
    } else kept.push(...bs);
  }
  const seenIds = new Map<string, number>();
  return { questions: kept.map((b) => buildQuestion(docId, b, seenIds)), discardedBlocks, discardedSections };
}

export function parseMcqs(docId: DocId, lines: readonly ParseLine[]): Question[] {
  return parseMcqDocument(docId, lines).questions;
}

function buildQuestion(docId: DocId, b: Block, seenIds: Map<string, number>): Question {
  const body = b.lines
    .map((l) => l.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const pages = b.lines.map((l) => l.page);
  const page = Math.min(...pages);
  const pageEnd = Math.max(...pages);
  const warnings: QuestionWarning[] = [];
  const split = chooseSplit(body);

  let stem = body;
  let options: QuestionOption[] = [];
  if (split) {
    stem = split.stem;
    options = split.options.slice(0, OPTION_KEYS.length).map((o, i) => ({
      key: OPTION_KEYS[i] as string,
      sourceLabel: o.sourceLabel,
      text: o.text,
    }));
    if (split.identicalDuplicate) {
      warnings.push(warn('bilingual-duplicate', 'An identical second option set (the other-language copy) was dropped.', false));
    } else if (split.duplicateSet) {
      warnings.push(
        warn('bilingual-duplicate', 'A second option set follows the first (often a bilingual duplicate). Only the first set was kept — check against the page.', true),
      );
    }
  }

  if (options.length < 4) {
    warnings.push(
      warn('option-count', options.length === 0 ? 'No option labels found.' : `Only ${options.length} option(s) detected; expected 4.`, true),
    );
  } else if (options.length > 4) {
    warnings.push(warn('option-count', `${options.length} options detected; most papers use 4.`, false));
  }
  // Stacked fractions/formulae often extract as bare punctuation (", , ,"), which is not readable option text.
  if (options.some((o) => !/[\p{L}\p{N}]/u.test(o.text))) warnings.push(warn('empty-option', 'An option has no readable text (possibly an image/formula).', true));
  if (stem.length < 3) warnings.push(warn('missing-stem', 'Question text is missing or too short.', true));
  if (b.gap) warnings.push(warn('numbering-gap', 'Question numbering skipped ahead; a question may have been missed.', false));
  const dev = countMatches(stem, DEVANAGARI);
  const lat = countMatches(stem, LATIN);
  if (dev >= 15 && lat >= 15) warnings.push(warn('mixed-script', 'Question mixes Hindi and English text; it may contain both language versions.', false));
  if (b.context) warnings.push(warn('passage-context', 'Linked to a passage/directions block — check that the context is complete.', false));
  if (DIAGRAM_REF.test(body)) warnings.push(warn('diagram-reference', 'Refers to a figure/diagram that cannot be extracted as text. View the source page.', false));
  if (options.some((o) => o.text.length > 300)) warnings.push(warn('long-option', 'An option is unusually long; trailing page text may have been absorbed.', false));
  if (pageEnd > page) warnings.push(warn('spans-pages', `Continues from page ${page} to ${pageEnd}.`, false));

  const penalty: Record<QuestionWarning['code'], number> = {
    'option-count': 0.5,
    'empty-option': 0.4,
    'missing-stem': 0.5,
    'numbering-gap': 0.1,
    'bilingual-duplicate': 0.3,
    'mixed-script': 0.1,
    'passage-context': 0.1,
    'diagram-reference': 0.3,
    'long-option': 0.2,
    'spans-pages': 0.05,
  };
  let confidence = 1;
  for (const w of warnings) confidence -= (w.code === 'option-count' || w.code === 'bilingual-duplicate') && !w.blocking ? 0.1 : penalty[w.code];
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
  const blocking = warnings.some((w) => w.blocking);

  const baseId = `${docId}:${b.section > 1 ? `s${b.section}-` : ''}q${b.number}`;
  const dup = seenIds.get(baseId) ?? 0;
  seenIds.set(baseId, dup + 1);
  const id = dup === 0 ? baseId : `${baseId}-${dup + 1}`;

  return {
    id,
    docId,
    number: b.number,
    page,
    pageEnd,
    context: b.context,
    stem,
    options,
    status: blocking || confidence < 0.7 ? 'needs-review' : 'ok',
    confidence,
    warnings,
    answerKey: null,
    answerSource: 'none',
    explanation: null,
    rawText: body,
    edited: false,
  };
}

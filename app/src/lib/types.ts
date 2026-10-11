// Core data model shared by extraction, review, practice and exam features.
// Every PDF-derived string here is UNTRUSTED text: render it only as React text
// children, never via dangerouslySetInnerHTML or as a URL.

export type DocId = string;

/** One positioned line of text reconstructed from PDF.js text items. */
export interface TextLine {
  text: string;
  /** Left edge in PDF user units (origin bottom-left, as reported by PDF.js). */
  x: number;
  /** Baseline y in PDF user units (larger = higher on the page). */
  y: number;
  /** Approximate glyph height (font size) in PDF user units. */
  height: number;
}

export interface PageText {
  docId: DocId;
  /** 1-based page number in the source PDF. */
  pageNumber: number;
  width: number;
  height: number;
  lines: TextLine[];
  /** Non-whitespace characters on the page (before header/footer removal). */
  charCount: number;
  /** True when the page has too little text to be a text-layer page (likely scan/image). */
  lowText: boolean;
}

export type DocWarningCode =
  | 'scanned-or-image-only'
  | 'some-pages-low-text'
  | 'page-limit-truncated'
  | 'no-mcq-found'
  | 'headers-footers-removed'
  | 'legacy-font-encoding'
  | 'preamble-skipped';

export interface DocWarning {
  code: DocWarningCode;
  message: string;
}

export interface SourceDoc {
  id: DocId;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  /** Pages actually processed (may be < pageCount when the page limit truncates). */
  pagesProcessed: number;
  /** User-editable label, e.g. "CTET Dec 2024 Paper I Set H". */
  label: string;
  /** Year guessed from the filename/first page; user-editable, never authoritative. */
  year: string | null;
  addedAt: number;
  warnings: DocWarning[];
  /** True for the bundled original synthetic demo (never a real exam paper). */
  synthetic: boolean;
}

export type QuestionWarningCode =
  | 'option-count'
  | 'empty-option'
  | 'missing-stem'
  | 'numbering-gap'
  | 'bilingual-duplicate'
  | 'mixed-script'
  | 'passage-context'
  | 'diagram-reference'
  | 'long-option'
  | 'spans-pages';

export interface QuestionWarning {
  code: QuestionWarningCode;
  message: string;
  /** Blocking warnings force status 'needs-review' until the user edits/accepts. */
  blocking: boolean;
}

export interface QuestionOption {
  /** Stable canonical key used for answers/keys: 'A' | 'B' | 'C' | 'D' | 'E'. */
  key: string;
  /** Label as printed in the source, e.g. "(1)", "A.", "(b)". */
  sourceLabel: string;
  text: string;
}

export type QuestionStatus = 'ok' | 'needs-review' | 'excluded';

export interface Question {
  /** Stable id: `${docId}:q${number}` (+ suffix when a number repeats). */
  id: string;
  docId: DocId;
  /** Number as printed in the source. */
  number: number;
  /** First and last source page (1-based). */
  page: number;
  pageEnd: number;
  /** Shared context (directions / passage) detected immediately before this question. */
  context: string | null;
  stem: string;
  options: QuestionOption[];
  status: QuestionStatus;
  /** 0..1 heuristic extraction confidence (not a correctness claim). */
  confidence: number;
  warnings: QuestionWarning[];
  /** Correct option key ONLY when supplied by the user or an imported key. Parser never sets it. */
  answerKey: string | null;
  answerSource: 'none' | 'imported' | 'manual';
  explanation: string | null;
  /** Raw extracted block for side-by-side checking. */
  rawText: string;
  edited: boolean;
}

export const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;

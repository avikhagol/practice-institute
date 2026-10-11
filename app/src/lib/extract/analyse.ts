// Pure post-extraction analysis shared by the browser pipeline and Node validation tests:
// scan detection, header/footer removal, legacy-font filtering and MCQ parsing.
import type { DocWarning, PageText, Question } from '../types';
import { detectRepeatedEdgeLines, isLegacyEncoded, stripEdgeLines } from './layout';
import { parseMcqDocument, type ParseLine } from './mcq';

export interface Analysis {
  cleanPages: PageText[];
  questions: Question[];
  warnings: DocWarning[];
  stats: {
    pages: number;
    lowTextPages: number;
    headerFooterLinesRemoved: number;
    legacyLinesHidden: number;
    discardedPreambleBlocks: number;
  };
}

export function analysePages(docId: string, pages: readonly PageText[]): Analysis {
  const warnings: DocWarning[] = [];
  const low = pages.filter((p) => p.lowText).length;
  if (pages.length > 0 && low / pages.length >= 0.5) {
    warnings.push({
      code: 'scanned-or-image-only',
      message: `${low} of ${pages.length} pages have little or no selectable text — this looks like a scanned/image PDF. OCR is not available in this version; use a PDF with a text layer, or add questions manually / import a question-bank JSON.`,
    });
  } else if (low > 0) {
    warnings.push({ code: 'some-pages-low-text', message: `${low} page(s) have little selectable text (images, diagrams or blank pages). Check them in the original view.` });
  }

  const sigs = detectRepeatedEdgeLines(pages);
  let removed = 0;
  let legacy = 0;
  const cleanPages = pages.map((p) => {
    const stripped = stripEdgeLines(p, sigs);
    removed += p.lines.length - stripped.length;
    const lines = stripped.filter((l) => {
      const bad = isLegacyEncoded(l.text);
      if (bad) legacy += 1;
      return !bad;
    });
    return { ...p, lines };
  });
  if (removed > 0) warnings.push({ code: 'headers-footers-removed', message: `${removed} repeated header/footer/page-number lines were hidden.` });
  if (legacy > 0) {
    warnings.push({
      code: 'legacy-font-encoding',
      message: `${legacy} lines use a legacy (non-Unicode) font — commonly Hindi typed in Kruti Dev/Chanakya — and cannot be converted to readable text. They are hidden; use the original-page view for that content.`,
    });
  }

  const parseLines: ParseLine[] = cleanPages.flatMap((p) => p.lines.map((l) => ({ text: l.text, page: p.pageNumber })));
  const parsed = parseMcqDocument(docId, parseLines);
  if (parsed.questions.length === 0) {
    warnings.push({ code: 'no-mcq-found', message: 'No numbered multiple-choice questions were recognised. The document can still be read; questions can be added manually.' });
  }
  if (parsed.discardedBlocks > 0) {
    warnings.push({
      code: 'preamble-skipped',
      message: `${parsed.discardedBlocks} numbered items without options (e.g. cover-page instructions) were not treated as questions.`,
    });
  }
  return {
    cleanPages,
    questions: parsed.questions,
    warnings,
    stats: {
      pages: pages.length,
      lowTextPages: low,
      headerFooterLinesRemoved: removed,
      legacyLinesHidden: legacy,
      discardedPreambleBlocks: parsed.discardedBlocks,
    },
  };
}

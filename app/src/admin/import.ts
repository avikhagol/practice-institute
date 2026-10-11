import type { PageText, Question } from '../lib/types';
import { parseMcqDocument } from '../lib/extract/mcq';
import type { OcrPageItem } from '../lib/ocr/engine';

// Pair original language variants by printed question number and canonical option key.
// Mixed-script strings are preserved and flagged; ambiguous text is never translated.
function language(text: string): 'en' | 'hi' {
  const hindi = (text.match(/\p{Script=Devanagari}/gu) ?? []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  return hindi > latin ? 'hi' : 'en';
}

export function pairQuestions(
  questions: Question[],
  source: { id: number; year: string | null; subject: string | null },
  origin: 'text-layer' | 'ocr' = 'text-layer',
) {
  const grouped = new Map<number, Question[]>();
  for (const q of questions) grouped.set(q.number, [...(grouped.get(q.number) ?? []), q]);

  return [...grouped].map(([number, variants]) => {
    const result = {
      source_id: source.id,
      source_number: number,
      source_page: variants[0]!.page,
      crop_json: null as string | null,
      year: source.year,
      subject: source.subject,
      stem_en: null as string | null,
      stem_hi: null as string | null,
      context_en: null as string | null,
      context_hi: null as string | null,
      options: [] as { key: string; en: string | null; hi: string | null }[],
      origin,
      status: 'needs-review' as const,
      warnings: [] as string[],
    };

    if (origin === 'ocr') {
      result.warnings.push('Extracted via OCR; verify text and option keys against original crop before marking reviewed.');
      result.warnings.push('OCR cannot establish translation pairing for unnumbered Hindi blocks; compare the original page and correct manually.');
      if (variants.some(q => /\b(?:table|figure|diagram|graph)\b|तालिका|आकृति|चित्र/u.test(q.rawText))) {
        result.warnings.push('OCR may omit table values or distort figure/formula layout even at high confidence; verify the complete original page.');
      }
    }

    const keySets = variants.map(q => q.options.map(o => o.key).sort().join(','));
    if (new Set(keySets).size > 1) {
      result.warnings.push('Language variants have different option keys; verify every option pairing against the original.');
    }

    for (const q of variants) {
      const lang = language(q.stem);
      const field = lang === 'hi' ? 'stem_hi' : 'stem_en';
      if (result[field]) result.warnings.push('Repeated question number in the same language; verify pairing.');
      result[field] = [result[field], q.stem].filter(Boolean).join('\n');
      result[lang === 'hi' ? 'context_hi' : 'context_en'] = q.context;
      if ([q.stem, q.context ?? '', ...q.options.map(o => o.text)].some(text => /[\u0900-\u097f]/.test(text) && /[a-zA-Z]{2}/.test(text))) {
        result.warnings.push(`Mixed-script text preserved in ${lang === 'hi' ? 'Hindi' : 'English'} editor; separate original languages manually.`);
      }
      result.warnings.push(...q.warnings.map(w => w.message));
      for (const o of q.options) {
        let option = result.options.find(v => v.key === o.key);
        if (!option) {
          option = { key: o.key, en: null, hi: null };
          result.options.push(option);
        }
        option[lang] = [option[lang], o.text].filter(Boolean).join('\n');
      }
    }
    result.warnings = [...new Set(result.warnings)];
    return result;
  });
}

// Parse separate original-script streams before the local-mode parser can drop a
// repeated bilingual option set. Numeric/formula-only lines remain in both streams.
// Mixed-script lines stay intact in their dominant-script stream and carry a warning.
export function bilingualCandidates(docId: string, pages: PageText[], fallback: Question[]): Question[] {
  const lines = pages.flatMap(p => p.lines.map(line => ({ text: line.text, page: p.pageNumber })));
  if (!lines.some(line => /[\u0900-\u097f]/.test(line.text))) return fallback;
  const en = lines.filter(line => !/[\u0900-\u097f]/.test(line.text) || language(line.text) === 'en');
  const hi = lines.filter(line => !/\p{Script=Latin}/u.test(line.text) || language(line.text) === 'hi');
  const english = parseMcqDocument(docId + '-en', en).questions;
  const hindi = parseMcqDocument(docId + '-hi', hi).questions.filter(q => /[\u0900-\u097f]/.test(q.stem));
  if (hindi.length) return [...english, ...hindi];
  if (!english.length) return fallback;
  // Unnumbered Hindi has no reliable identity. Keep the clean English candidates
  // rather than attaching a Hindi stem to the last English option in fallback.
  return english.map(q => ({ ...q, warnings: [...q.warnings, {
    code: 'mixed-script' as const, blocking: true,
    message: 'Hindi text was detected but no numbered Hindi questions were recovered. English options are kept separately; use original-page crop correction to restore Hindi manually.',
  }] }));
}

// Convert OCR recognized pages into PageText objects for candidate extraction
export function ocrPagesToPageText(docId: string, ocrItems: OcrPageItem[]): PageText[] {
  return ocrItems.map(item => ({
    docId,
    pageNumber: item.pageNumber,
    width: 600,
    height: 800,
    charCount: item.text.length,
    lowText: item.text.length < 50,
    // Some booklet barcodes OCR as repeated Devanagari danda marks. This exact
    // footer shape is noise, not Hindi option text; retain full raw OCR separately.
    lines: item.lines.filter(l => !/^(?:P[-\s]?[I1U]|>[-\s]?1)\s+[\u0964\u0965|\s]+\d{1,3}\s+[A-Z]\s*$/.test(l.text.trim())).map((l, idx) => ({
      text: l.text,
      x: 10,
      y: 10 + idx * 15,
      height: 12,
    })),
  }));
}

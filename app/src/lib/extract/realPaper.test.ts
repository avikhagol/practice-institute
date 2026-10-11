// Validation against REAL official CTET papers kept as local, git-ignored fixtures
// (see ../../../../fixtures/real/PROVENANCE.md). Skipped automatically when absent,
// e.g. in CI or a fresh clone — those papers may not be redistributed.
// Runs the same pure analysis used in the browser on text extracted by PDF.js (Node build).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analysePages } from './analyse';
import { makeBank, parseBank } from '../bank/bank';
import { extractPagesNode as extract } from './nodeExtract';

const FIXTURES = join(__dirname, '../../../../fixtures/real');
const REPORTS = join(__dirname, '../../../../reports');
const PAPERS = [
  { file: 'ctet-dec2024-paper1-setH.pdf', id: 'CTET Dec 2024 Paper I Set H' },
  { file: 'ctet-dec2024-paper1-setI.pdf', id: 'CTET Dec 2024 Paper I Set I' },
  { file: 'ctet-jul2024-paper1-setA.pdf', id: 'CTET Jul 2024 Paper I Set A' },
];

describe.each(PAPERS)('real paper: $id', ({ file, id }) => {
  const path = join(FIXTURES, file);
  it.skipIf(!existsSync(path))(
    'extracts numbered MCQs with provenance and honest warnings',
    async () => {
      const pages = await extract(path);
      const a = analysePages('real', pages);
      const qs = a.questions;
      const ok = qs.filter((q) => q.status === 'ok');
      const numbers = qs.map((q) => q.number);
      const summary = {
        paper: id,
        file,
        ...a.stats,
        candidates: qs.length,
        ok: ok.length,
        needsReview: qs.length - ok.length,
        withFourOptions: qs.filter((q) => q.options.length === 4).length,
        distinctNumbers: new Set(numbers).size,
        minNumber: Math.min(...numbers),
        maxNumber: Math.max(...numbers),
        warningCounts: qs.flatMap((q) => q.warnings.map((w) => w.code)).reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}),
        docWarnings: a.warnings.map((w) => w.code),
        reviewItems: qs.filter(q => q.status === 'needs-review').map(q => ({ number: q.number, page: q.page, pageEnd: q.pageEnd, optionCount: q.options.length, warnings: q.warnings.map(w => w.code) })),
      };
      mkdirSync(REPORTS, { recursive: true });
      writeFileSync(join(REPORTS, `extraction-${file.replace(/\.pdf$/, '')}.json`), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary));
      expect(qs.length).toBeGreaterThan(100);
      const bank = makeBank([{ id: 'real', fileName: file, label: id, year: '2024', pageCount: pages.length, pagesProcessed: pages.length, sizeBytes: 0, addedAt: 0, warnings: a.warnings, synthetic: false }], qs);
      expect(parseBank(JSON.stringify(bank))).toEqual(bank);
      expect(qs.every((q) => q.answerKey === null)).toBe(true);
      expect(qs.every((q) => q.page >= 1 && q.page <= pages.length)).toBe(true);
      if (file === 'ctet-dec2024-paper1-setH.pdf') {
        // Manually verified against page 5 of the original (see PROVENANCE.md excerpt).
        const q13 = qs.find((q) => q.number === 13)!;
        expect(q13.page).toBe(5);
        expect(q13.stem.startsWith('Kinesthetic learners')).toBe(true);
        expect(q13.options.map((o) => o.sourceLabel)).toEqual(['(1)', '(2)', '(3)', '(4)']);
        expect(q13.options[2]!.text).toBe('doing and moving');
        expect(q13.status).toBe('ok');
        // Turn 4 parser review, checked against pages 31-42: option cross-references stay inside
        // the option, "Read the extract" passages are bounded, and back-cover text is not absorbed.
        const byNo = (n: number) => qs.find((q) => q.number === n)!;
        expect(byNo(129).options[3]!.text).toBe('Both (1) and (3)');
        expect(byNo(99).options[3]!.text).toBe('Oxymoron');
        expect(byNo(150).pageEnd).toBe(42);
        expect(qs.filter((q) => q.context?.includes('(100-105)')).map((q) => q.number)).toEqual([100, 101, 102, 103, 104, 105]);
        expect(qs.filter((q) => q.number > 105 && q.number <= 120).every((q) => q.context === null)).toBe(true);
      }
    },
    60_000,
  );
});

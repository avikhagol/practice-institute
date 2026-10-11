// Opt-in local QA. Restricted paper pixels/text are written only under fixtures/real/.
import { test, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWorker } from 'tesseract.js';
import { extractPagesNode } from '../src/lib/extract/nodeExtract';
import { analysePages } from '../src/lib/extract/analyse';
import { bilingualCandidates, pairQuestions, ocrPagesToPageText } from '../src/admin/import';

const papers = [
  { file: 'ctet-dec2024-paper1-setH.pdf', hash: '1dcf1ba4129cdffd343b572a693209f244b9f2af1550aa7173641aa831153005' },
  { file: 'ctet-dec2024-paper1-setI.pdf', hash: '2ffd11d5147a98f9d4b7595cca971444c2d24f6fccc5953785389f6b01649691' },
  { file: 'ctet-jul2024-paper1-setA.pdf', hash: '28a2c8ae91cfc99878ce7ff891df16a7f6d4cb42be1e4e4dd61de69776c8b607' },
];
const real = resolve('../fixtures/real');
const summary = (items: ReturnType<typeof pairQuestions>) => ({
  candidates: items.length, bilingual: items.filter(q => q.stem_en && q.stem_hi).length,
  hindiOnly: items.filter(q => !q.stem_en && q.stem_hi).length,
  englishOnly: items.filter(q => q.stem_en && !q.stem_hi).length,
  englishOptionsContainingDevanagari: items.flatMap(q => q.options).filter(o => /[\u0900-\u097f]/.test(o.en || '')).length,
  unimportableOptionCounts: items.filter(q => q.options.length < 2 || q.options.length > 5).length,
  withFourOptions: items.filter(q => q.options.length === 4).length,
  warningCount: items.reduce((sum, q) => sum + q.warnings.length, 0),
  repeatedNumberWarnings: items.filter(q => q.warnings.some(w => w.startsWith('Repeated question'))).length,
});

test('three official papers: actual OCR plus production bilingual importer diagnostics', async () => {
  for (const paper of papers) expect(existsSync(resolve(real, paper.file)), `Missing local fixture: ${paper.file}`).toBe(true);
  const worker = await createWorker('eng+hin', 1, { langPath: resolve('public/tesseract/lang-data'), cacheMethod: 'none' });
  const reports = [];
  try {
    for (const [index, paper] of papers.entries()) {
      const path = resolve(real, paper.file);
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(paper.hash);
      const pages = await extractPagesNode(path);
      const analysis = analysePages('real-qa', pages);
      const textBank = pairQuestions(bilingualCandidates('real-qa', analysis.cleanPages, analysis.questions), { id: index + 1, year: '2024', subject: null });
      expect(textBank.length).toBeGreaterThan(100);
      expect(textBank.every(q => q.status === 'needs-review' && !('answer_key' in q))).toBe(true);
      const ocr = [];
      // First subject page and a later subject page, rather than only the cover.
      for (const page of [4, 10]) {
        const prefix = resolve(real, `qa-${index}-page${page}`);
        execFileSync('pdftoppm', ['-f', String(page), '-l', String(page), '-scale-to', '1800', '-png', '-singlefile', path, prefix]);
        const started = performance.now();
        const { data } = await worker.recognize(prefix + '.png');
        const elapsedMs = Math.round(performance.now() - started);
        writeFileSync(prefix + '.txt', data.text);
        const ocrPages = ocrPagesToPageText('ocr-qa', [{ pageNumber: page, text: data.text, confidence: data.confidence, lines: data.text.split('\n').filter(Boolean).map(text => ({ text, pageNumber: page })) }]);
        const a = analysePages('ocr-qa', ocrPages);
        const bank = pairQuestions(bilingualCandidates('ocr-qa', a.cleanPages, a.questions), { id: index + 1, year: '2024', subject: null }, 'ocr');
        expect((data.text.match(/[\u0900-\u097f]/g) || []).length).toBeGreaterThan(50);
        expect(bank.length).toBeGreaterThan(0);
        expect(bank.every(q => q.origin === 'ocr' && q.status === 'needs-review' && !('answer_key' in q))).toBe(true);
        expect(bank.every(q => q.warnings.some(w => w.includes('unnumbered Hindi')))).toBe(true);
        ocr.push({ page, elapsedMs, confidence: data.confidence, characters: data.text.length, devanagariCharacters: (data.text.match(/[\u0900-\u097f]/g) || []).length, ...summary(bank), accuracy: 'Not measured; no audited full-page ground truth', privateOutput: `fixtures/real/qa-${index}-page${page}.txt` });
      }
      reports.push({ file: paper.file, sha256: paper.hash, pages: pages.length, legacyLinesHidden: analysis.stats.legacyLinesHidden, textLayer: summary(textBank), ocr });
    }
  } finally { await worker.terminate(); }
  writeFileSync('../reports/turn6-real-ocr-qa.json', JSON.stringify({ generatedAt: new Date().toISOString(), language: 'eng+hin', resolution: '1800px longest edge', provenance: 'fixtures/real/PROVENANCE.md', reports }, null, 2) + '\n');
}, 180000);

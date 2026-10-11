// End-to-end extraction of the bundled ORIGINAL synthetic demo PDF through PDF.js
// (regenerate with `npm run fixtures:synthetic`).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analysePages } from './analyse';
import { extractPagesNode } from './nodeExtract';

describe('synthetic demo PDF', () => {
  it('extracts all 12 questions with correct flags and provenance', async () => {
    const pages = await extractPagesNode(join(__dirname, '../../../public/demo/pdf-smart-synthetic-demo.pdf'));
    const a = analysePages('demo', pages);
    const byNum = new Map(a.questions.map((q) => [q.number, q]));
    expect(a.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(a.stats.discardedPreambleBlocks).toBe(6);
    expect(a.stats.headerFooterLinesRemoved).toBeGreaterThanOrEqual(8);

    const q1 = byNum.get(1)!;
    expect(q1.stem).toBe('A learner who remembers best after building a model is most likely showing which preference?');
    expect(q1.options.map((o) => o.text)).toEqual(['Listening', 'Reading', 'Hands-on activity', 'Copying notes']);
    expect(q1.page).toBe(2);
    expect(q1.status).toBe('ok');
    expect(q1.context).toBeNull();

    expect(byNum.get(4)!.options.map((o) => o.sourceLabel)).toEqual(['A.', 'B.', 'C.', 'D.']);
    expect(byNum.get(5)!.options[2]!.text).toBe('Both (a) and (b) are correct');
    expect(byNum.get(6)!.warnings.map((w) => w.code)).toContain('diagram-reference');
    expect(byNum.get(6)!.options[3]!.text).toBe('Hexagon');
    for (const n of [7, 8, 9]) expect(byNum.get(n)!.context).toContain('village library');
    expect(byNum.get(10)!.context).toBeNull();
    expect(byNum.get(12)!.status).toBe('needs-review');
    expect(byNum.get(12)!.warnings.some((w) => w.code === 'option-count' && w.blocking)).toBe(true);
    expect(a.questions.every((q) => q.answerKey === null)).toBe(true);
  });
});

import { expect, it } from 'vitest';
import { provenanceLine } from './provenance';

it('omits a label that only repeats the filename and collapses single pages', () => {
  expect(provenanceLine(3, { page: 2, pageEnd: 2 }, { label: 'paper-h', fileName: 'paper-h.pdf', year: '2024' })).toBe('Source Q3 · paper-h.pdf · 2024 · p. 2');
  expect(provenanceLine(9, { page: 4, pageEnd: 5 }, { label: 'CTET Dec 2024', fileName: 'paper-h.pdf', year: null })).toBe(
    'Source Q9 · CTET Dec 2024 · paper-h.pdf · Year not set · pp. 4–5',
  );
});

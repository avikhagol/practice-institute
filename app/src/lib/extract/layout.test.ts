import { describe, expect, it } from 'vitest';
import { detectRepeatedEdgeLines, isLegacyEncoded, itemsToLines, reflowLines, stripEdgeLines, type RawTextItem } from './layout';
import type { PageText } from '../types';

const item = (str: string, x: number, y: number, w = str.length * 5, h = 10): RawTextItem => ({
  str,
  transform: [h, 0, 0, h, x, y],
  width: w,
  height: h,
});

const page = (n: number, texts: string[]): PageText => ({
  docId: 'd',
  pageNumber: n,
  width: 600,
  height: 800,
  lines: texts.map((text, i) => ({ text, x: 50, y: 780 - i * 14, height: 10 })),
  charCount: texts.join('').length,
  lowText: false,
});

describe('itemsToLines', () => {
  it('groups items on the same baseline and orders top-to-bottom, left-to-right', () => {
    const lines = itemsToLines([item('world', 100, 700), item('Hello', 50, 701), item('Second line', 50, 680)]);
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line']);
  });

  it('keeps Devanagari text intact', () => {
    const lines = itemsToLines([item('प्रश्न', 50, 700), item('उत्तर', 90, 700)]);
    expect(lines[0]!.text).toBe('प्रश्न उत्तर');
  });
});

describe('header/footer removal', () => {
  it('removes lines repeated at page edges but keeps body text', () => {
    const pages = [1, 2, 3, 4].map((n) =>
      page(n, [
        'CTET Paper I Set H',
        `${n * 3}. Body question ${'x'.repeat(n)}`,
        `Middle line ${'y'.repeat(n)}`,
        'Repeated middle',
        `Closing ${'z'.repeat(n)}`,
        '(4) None of these',
        `Page ${n} of 4`,
      ]),
    );
    const sigs = detectRepeatedEdgeLines(pages);
    const kept = stripEdgeLines(pages[1]!, sigs).map((l) => l.text);
    expect(kept).toEqual(['6. Body question xx', 'Middle line yy', 'Repeated middle', 'Closing zz', '(4) None of these']);
  });
});

describe('isLegacyEncoded', () => {
  it('detects legacy-font Hindi mojibake but not Unicode Hindi or English', () => {
    expect(isLegacyEncoded('ªÁÃ‚¥ﬂŒË Á‡ÊˇÊÊÕË¸ __________ ∑§ ◊Êäÿ◊ ‚ ‚ËπŸÊ ¬‚¥Œ ∑§⁄UÃ „Ò¥–')).toBe(true);
    expect(isLegacyEncoded('(1) ŒπŸ (2) ¿ÍUŸ')).toBe(true);
    expect(isLegacyEncoded('बच्चों के सीखने का आकलन')).toBe(false);
    expect(isLegacyEncoded('13. Kinesthetic learners prefer to learn through ____.')).toBe(false);
    expect(isLegacyEncoded('(1) café (2) naïve (3) rôle (4) déjà vu')).toBe(false);
  });
});

describe('reflowLines', () => {
  it('joins wrapped lines and separates numbered items', () => {
    const blocks = reflowLines([
      { text: 'Section A', x: 50, y: 780, height: 16 },
      { text: 'This paragraph wraps across', x: 50, y: 760, height: 10 },
      { text: 'two lines.', x: 50, y: 748, height: 10 },
      { text: '1. First question', x: 50, y: 736, height: 10 },
      { text: '(1) option', x: 60, y: 724, height: 10 },
    ]);
    expect(blocks).toEqual([
      { kind: 'heading', text: 'Section A' },
      { kind: 'paragraph', text: 'This paragraph wraps across two lines.' },
      { kind: 'item', text: '1. First question' },
      { kind: 'item', text: '(1) option' },
    ]);
  });
});

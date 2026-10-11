// Pure layout helpers: PDF.js text items -> lines -> reflowed blocks.
// Kept free of PDF.js imports so they can be unit-tested in Node.
import type { PageText, TextLine } from '../types';

/** Minimal subset of a PDF.js TextItem we rely on. */
export interface RawTextItem {
  str: string;
  /** PDF.js transform matrix [a, b, c, d, e, f]; e = x, f = y. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export const LOW_TEXT_CHAR_THRESHOLD = 40;

/** Normalise Unicode for stable comparison/display without changing script. */
export function nfc(s: string): string {
  return s.normalize('NFC');
}

/**
 * Group text items into lines by baseline proximity, then order lines top-to-bottom
 * and items left-to-right. Multi-column layouts are NOT reconstructed here; callers
 * should keep an original-page preview available.
 */
export function itemsToLines(items: readonly RawTextItem[]): TextLine[] {
  type Acc = { y: number; height: number; parts: { x: number; w: number; s: string }[] };
  const rows: Acc[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const x = it.transform[4] ?? 0;
    const y = it.transform[5] ?? 0;
    const h = Math.abs(it.height) || Math.abs(it.transform[3] ?? 0) || 10;
    const tol = Math.max(2, h * 0.45);
    let row = rows.find((r) => Math.abs(r.y - y) <= tol);
    if (!row) {
      row = { y, height: h, parts: [] };
      rows.push(row);
    }
    row.height = Math.max(row.height, h);
    row.parts.push({ x, w: it.width, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((r) => {
      r.parts.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd: number | null = null;
      for (const p of r.parts) {
        if (prevEnd !== null && p.x - prevEnd > r.height * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.s)) {
          text += ' ';
        }
        text += p.s;
        prevEnd = p.x + p.w;
      }
      const first = r.parts[0];
      return { text: nfc(text.replace(/\s+/g, ' ').trim()), x: first ? first.x : 0, y: r.y, height: r.height };
    })
    .filter((l) => l.text.length > 0);
}

// Characters typical of legacy (pre-Unicode) Hindi fonts such as Kruti Dev / Chanakya
// when decoded as Latin: Latin-1 supplement, Latin Extended, spacing modifiers, Greek,
// general punctuation/math/geometric symbols and Latin ligatures.
const LEGACY_GLYPH = /[¡-˿Ͱ-Ͽ -◿ﬀ-ﬆ]/gu;
const LETTERLIKE = /[\p{L}¡-˿ -◿]/gu;

/**
 * True when a line looks like mojibake from a legacy, non-Unicode Indic font.
 * Such text cannot be recovered as Unicode Hindi without the font's mapping table,
 * so it is hidden from reflow/parsing and the original page should be consulted.
 */
export function isLegacyEncoded(text: string): boolean {
  const letters = (text.match(LETTERLIKE) ?? []).length;
  if (letters < 3) return false;
  const legacy = (text.match(LEGACY_GLYPH) ?? []).length;
  return legacy / letters >= 0.3;
}

export function countChars(lines: readonly TextLine[]): number {
  let n = 0;
  for (const l of lines) n += l.text.replace(/\s/g, '').length;
  return n;
}

/** Signature used to recognise repeated headers/footers: digits collapse so "Page 3" == "Page 4". */
export function lineSignature(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

const EDGE_LINES = 3;

/**
 * Detect lines that repeat at the top or bottom edge of many pages (running headers,
 * footers, page numbers, set codes) and return their signatures.
 */
export function detectRepeatedEdgeLines(pages: readonly PageText[]): Set<string> {
  const textPages = pages.filter((p) => !p.lowText && p.lines.length > 0);
  const result = new Set<string>();
  if (textPages.length < 3) return result;
  // Count top and bottom bands separately so a line only counts as a header if it
  // keeps recurring in the same band. Lines that look like question/option starts are
  // never treated as headers, so a repeated option such as "(4) None of these" survives.
  const counts = new Map<string, number>();
  for (const p of textPages) {
    const n = p.lines.length;
    const seen = new Set<string>();
    p.lines.forEach((l, i) => {
      const band = i < EDGE_LINES ? 'top' : i >= n - EDGE_LINES ? 'bottom' : null;
      if (!band || ITEM_START.test(l.text)) return;
      const sig = lineSignature(l.text);
      const key = `${band}\u0000${sig}`;
      if (sig.length === 0 || seen.has(key)) return;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  const min = Math.max(3, Math.ceil(textPages.length * 0.6));
  for (const [key, c] of counts) if (c >= min) result.add(key.split('\u0000')[1] ?? '');
  // Bare page numbers ("#", "- # -", "page # of #") are always edge noise.
  result.add('#');
  result.add('- # -');
  result.add('page # of #');
  result.add('page #');
  return result;
}

/** Remove header/footer lines (only within the edge band of each page). */
export function stripEdgeLines(page: PageText, signatures: Set<string>): TextLine[] {
  const n = page.lines.length;
  return page.lines.filter((l, i) => {
    const atEdge = i < EDGE_LINES || i >= n - EDGE_LINES;
    return !(atEdge && !ITEM_START.test(l.text) && signatures.has(lineSignature(l.text)));
  });
}

export type ReflowBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'item'; text: string };

const ITEM_START = /^(?:Q\.?\s*)?\d{1,3}\s*[.)]\s|^\(?[A-Da-d1-4]\)\s|^[A-D]\.\s/;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Reflow lines into readable blocks: joins wrapped lines into paragraphs, keeps
 * numbered/lettered items separate and marks larger text as headings. Heuristic only.
 */
export function reflowLines(lines: readonly TextLine[]): ReflowBlock[] {
  const blocks: ReflowBlock[] = [];
  if (lines.length === 0) return blocks;
  const medH = median(lines.map((l) => l.height)) || 10;
  let cur: { kind: ReflowBlock['kind']; text: string } | null = null;
  let prev: TextLine | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) blocks.push({ kind: cur.kind, text: cur.text.trim() });
    cur = null;
  };
  for (const line of lines) {
    const isHeading = line.height >= medH * 1.25 && line.text.length < 120;
    const isItem = ITEM_START.test(line.text);
    const gap = prev ? prev.y - line.y : 0;
    const bigGap = prev !== null && gap > Math.max(prev.height, line.height) * 1.9;
    if (isHeading) {
      if (cur && (cur as { kind: string }).kind === 'heading' && !bigGap) {
        (cur as { text: string }).text += ` ${line.text}`;
      } else {
        flush();
        cur = { kind: 'heading', text: line.text };
      }
    } else if (isItem || bigGap || !cur || (cur as { kind: string }).kind === 'heading') {
      flush();
      cur = { kind: isItem ? 'item' : 'paragraph', text: line.text };
    } else {
      const c = cur as { text: string };
      // Join hyphenated Latin word breaks; otherwise join with a space.
      if (/[A-Za-z]-$/.test(c.text) && /^[a-z]/.test(line.text)) c.text = c.text.slice(0, -1) + line.text;
      else c.text += ` ${line.text}`;
    }
    prev = line;
  }
  flush();
  return blocks;
}

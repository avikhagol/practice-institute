// @vitest-environment jsdom
import { act } from 'react';
import { expect, test, vi } from 'vitest';
import type { BankQuestion } from './api';

const { request, rows } = vi.hoisted(() => ({ request: vi.fn(), rows: [] as BankQuestion[] }));
vi.mock('./api', () => ({ api: request, setSession: vi.fn(), SESSION_EXPIRED_MESSAGE: 'Expired' }));
vi.mock('../lib/pdf/ingest', () => ({ ingestPdf: vi.fn() }));
vi.mock('../lib/pdf/pdfjs', () => ({ loadPdfJs: vi.fn(), documentOptions: vi.fn() }));
vi.mock('../lib/ocr/engine', () => ({ recognizeCanvas: vi.fn(), recognizePdfPages: vi.fn(), checkOcrAssetStatus: vi.fn(), MAX_OCR_PAGES: 10, MAX_OCR_PIXELS: 1000 }));

async function click(element: Element) { await act(async () => { (element as HTMLElement).click(); }); }
function button(text: string) { return [...document.querySelectorAll('button')].find(el => el.textContent === text)!; }
function input(name: string) { return document.querySelector(`input[aria-label="${name}"]`)!; }
function field(name: string) { return [...document.querySelectorAll('label.field')].find(el => el.querySelector('span')?.textContent === name)!.querySelector('select')!; }
async function change(select: HTMLSelectElement, value: string) { await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); }); }

test('bank bulk review limits selection, preserves keys and retains failed updates for retry', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rows.push(...[1, 2, 3].map(id => ({ id, version: 1, stem_en: `Question ${id}`, stem_hi: null, context_en: null, context_hi: null,
    options: [{ key: 'A', en: 'One', hi: null }, { key: 'B', en: 'Two', hi: null }],
    answer_key: id === 1 ? 'A' : null, key_verified: id === 1, status: id === 3 ? 'excluded' : 'needs-review',
    origin: 'manual', source_id: null, source_number: null, source_page: null, subject: null, year: null,
    explanation_en: null, explanation_hi: null, warnings: [],
  } as BankQuestion)));
  let fail = false;
  request.mockImplementation(async (path: string, body?: BankQuestion) => {
    if (path === 'me') return { username: 'Owner', role: 'owner', csrf_token: 'test' };
    if (path === 'sources') return { sources: [] };
    if (path === 'exams') return { exams: [] };
    if (path === 'questions') return { questions: [...rows] };
    if (path.startsWith('questions/')) {
      if (fail && body?.id === 2) throw new Error('question changed');
      const index = rows.findIndex(q => q.id === body?.id);
      rows[index] = { ...body!, version: body!.version + 1 };
      return rows[index];
    }
    throw new Error(path);
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('./main'); });
  await click(button('Question bank'));
  await change(field('Status'), 'needs-review');
  await click(input('Select question 1'));
  expect((input('Select all matching questions') as HTMLInputElement).indeterminate).toBe(true);
  await click(input('Select all matching questions'));
  expect(document.body.textContent).toContain('2 selected');
  expect(button('Apply to selected').disabled).toBe(true);
  const ack = [...document.querySelectorAll('label.check')].find(el => el.textContent?.includes('for all selected'))!.querySelector('input')!;
  await click(ack);
  await click(button('Apply to selected'));
  expect(rows[0]).toMatchObject({ status: 'reviewed', answer_key: 'A', key_verified: true, version: 2 });
  expect(rows[1]).toMatchObject({ status: 'reviewed', answer_key: null, key_verified: false, version: 2 });
  expect(rows[2]).toMatchObject({ status: 'excluded', version: 1 });
  await change(field('Status'), 'reviewed');
  await click(input('Select all matching questions'));
  await change(field('Status'), '');
  expect(document.body.textContent).toContain('0 selected');
  await change(field('Status'), 'reviewed');
  await click(input('Select all matching questions'));
  await change(field('Bulk action'), 'needs-review');
  fail = true;
  await click(button('Apply to selected'));
  expect(document.querySelector('[role=alert]')?.textContent).toContain('1 of 2 questions updated. Remaining questions are still selected.');
  expect(document.body.textContent).toContain('1 selected');
  fail = false;
  await click(button('Apply to selected'));
  expect(rows.slice(0, 2).every(q => q.status === 'needs-review')).toBe(true);
  expect(document.body.textContent).toContain('0 selected');
});

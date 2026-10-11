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

test('exam select-all follows filters, shows partial selection and submits unique selected IDs', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rows.push(...[1, 2, 3, 4].map(id => ({ id, version: 1, stem_en: `Question ${id}`, stem_hi: null,
    options: [{ key: 'A', en: 'One', hi: null }, { key: 'B', en: 'Two', hi: null }],
    status: id === 4 ? 'needs-review' : 'reviewed', subject: id === 3 ? 'History' : 'Science',
    key_verified: false, warnings: [], context_en: null, context_hi: null, answer_key: null, origin: 'manual',
    source_id: null, source_number: null, source_page: null, year: null, explanation_en: null, explanation_hi: null,
  } as BankQuestion)));
  request.mockImplementation(async (path: string, body?: unknown) => {
    if (path === 'me') return { username: 'Owner', role: 'owner', csrf_token: 'test' };
    if (path === 'sources') return { sources: [] };
    if (path === 'exams') return body ? { code: 'TEST' } : { exams: [] };
    if (path === 'questions') return { questions: rows };
    throw new Error(path);
  });
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('./main'); });
  await click(button('Exams'));
  const all = () => document.querySelector('input[type=checkbox]') as HTMLInputElement;
  await change(field('Subject'), 'Science');
  await click(input('Select exam question 1'));
  expect(all().indeterminate).toBe(true);
  await click(all());
  expect(button('Create draft · 2 questions').disabled).toBe(false);
  expect(all().checked).toBe(true);
  await change(field('Subject'), 'History');
  expect(all().checked).toBe(false);
  await click(all());
  expect(button('Create draft · 3 questions')).toBeDefined();
  await change(field('Subject'), 'Science');
  await click(all());
  expect(button('Create draft · 1 questions')).toBeDefined();
  await click(all());
  expect(button('Create draft · 3 questions')).toBeDefined();
  await change(field('Language'), 'hi');
  expect(all().disabled).toBe(true);
  await change(field('Language'), '');
  const form = document.querySelector('form')!;
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const create = request.mock.calls.find(([path, body]) => path === 'exams' && body);
  expect(create?.[1].question_ids).toEqual([3, 1, 2]);
  await click(button('Clear selection'));
  expect(button('Create draft · 0 questions').disabled).toBe(true);
  expect(all().checked).toBe(false);
});

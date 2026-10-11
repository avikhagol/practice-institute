import { describe, expect, it } from 'vitest';
import { acceptQuestion, eligibleQuestions, findDuplicates, makeBank, parseBank } from './bank';
import { loadBank, saveBank, STORAGE_KEY } from './storage';
import { fromBank, reducer, type State } from '../../state/store';
import type { Question, SourceDoc } from '../types';

export const source: SourceDoc = { id: 'one', fileName: 'paper.pdf', label: 'Paper', year: '2024', sizeBytes: 12, pageCount: 2, pagesProcessed: 2, addedAt: 10, warnings: [], synthetic: true };
export const question: Question = { id: 'one:q1', docId: 'one', number: 1, page: 1, pageEnd: 1, stem: 'Which is correct?', context: 'Passage', options: ['A', 'B', 'C', 'D'].map(key => ({ key, sourceLabel: `(${key})`, text: `Choice ${key}` })), status: 'ok', confidence: .9, warnings: [], answerKey: null, answerSource: 'none', explanation: null, rawText: 'original raw block', edited: false };
const bank = () => makeBank([structuredClone(source)], [structuredClone(question)]);
const state = (): State => fromBank(bank());
const copy = (patch: Partial<Question> = {}): Question => ({ ...structuredClone(question), id: 'two:q1', docId: 'two', ...patch });

describe('bank JSON', () => {
  it('round trips every field, including labels, supplied keys, excluded items and warnings', () => {
    const b = bank(); b.questions[0] = { ...question, status: 'excluded', answerKey: 'B', answerSource: 'imported', explanation: 'Supplied rationale', warnings: [{ code: 'diagram-reference', message: 'See figure', blocking: false }] };
    expect(parseBank(JSON.stringify(b))).toEqual(b);
    const stored = new Map<string, string>();
    saveBank({ setItem: (k, v) => { stored.set(k, v); } }, b);
    expect(loadBank({ getItem: k => stored.get(k) ?? null })).toEqual(b);
    expect(stored.get(STORAGE_KEY)).not.toMatch(/cleanPages|"pdf"/);
  });
  it('accepts the original compact version-1 source export', () => {
    const b = bank(); const { id, fileName, label, year, pageCount, synthetic } = source;
    const result = parseBank(JSON.stringify({ ...b, sources: [{ id, fileName, label, year, pageCount, synthetic }] }));
    expect(result.questions).toEqual(b.questions); expect(result.sources[0]?.pagesProcessed).toBe(2);
  });
  it.each([
    ['version', (b: ReturnType<typeof bank>) => ({ ...b, version: 2 }), 'version'],
    ['missing source', (b: ReturnType<typeof bank>) => ({ ...b, sources: [] }), 'source is missing'],
    ['duplicate ID', (b: ReturnType<typeof bank>) => ({ ...b, questions: [question, question] }), 'duplicate question ID'],
    ['wrong option key', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, options: [{ key: 'Z', sourceLabel: 'Z', text: 'x' }] }] }), 'options[0].key'],
    ['missing answer option', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, answerKey: 'E', answerSource: 'manual' }] }), 'answer does not match'],
    ['NaN-like confidence', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, confidence: null }] }), 'confidence'],
    ['wrong page', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, page: 3 }] }), '.page'],
    ['unsafe ready state', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, stem: '' }] }), '.status'],
    ['unknown warning', (b: ReturnType<typeof bank>) => ({ ...b, questions: [{ ...question, warnings: [{ code: 'unknown', message: 'x', blocking: true }] }] }), '.code'],
  ])('rejects %s with a reason', (_, change, reason) => expect(() => parseBank(JSON.stringify(change(bank())))).toThrow(reason));
  it('rejects invalid JSON and wrong top-level values', () => {
    expect(() => parseBank('{')).toThrow('Invalid JSON');
    expect(() => parseBank('null')).toThrow('expected an object');
  });
  it('preserves malformed extraction candidates that still need review', () => {
    const b = bank(); b.questions = [{ ...question, stem: '', options: [], status: 'needs-review' }];
    expect(parseBank(JSON.stringify(b))).toEqual(b);
  });
  it('propagates storage failures instead of pretending a save succeeded', () => {
    expect(() => saveBank({ setItem: () => { throw new Error('quota'); } }, bank())).toThrow('quota');
    expect(() => loadBank({ getItem: () => { throw new Error('blocked'); } })).toThrow('blocked');
    expect(() => loadBank({ getItem: () => 'broken' })).toThrow('Invalid JSON');
  });
});

describe('editing and acceptance', () => {
  it('keeps provenance and option keys, saves for review, accepts warnings, excludes and restores', () => {
    let s = state();
    s.questions[0] = { ...question, status: 'needs-review', warnings: [{ code: 'bilingual-duplicate', message: 'Check options', blocking: true }] };
    s = reducer(s, { type: 'edit-question', question: { ...s.questions[0]!, docId: 'fake', page: 99, rawText: 'fake', stem: 'Corrected text' } });
    expect(s.questions[0]).toMatchObject({ stem: 'Corrected text', docId: 'one', page: 1, rawText: question.rawText, edited: true, status: 'needs-review' });
    expect(s.questions[0]?.options).toEqual(question.options);
    s = reducer(s, { type: 'accept-question', id: question.id });
    expect(s.questions[0]?.status).toBe('ok'); expect(s.questions[0]?.warnings[0]?.blocking).toBe(false);
    s = reducer(s, { type: 'exclude-question', id: question.id }); expect(eligibleQuestions(s.questions)).toHaveLength(0);
    s = reducer(s, { type: 'restore-question', id: question.id }); expect(eligibleQuestions(s.questions)).toHaveLength(1);
  });
  it('cannot accept a missing stem, too few options or empty options', () => {
    for (const q of [{ ...question, stem: '' }, { ...question, options: [] }, { ...question, options: [{ key: 'A', sourceLabel: 'A', text: '' }, question.options[1]!] }]) {
      expect(acceptQuestion(q).status).toBe('needs-review'); expect(eligibleQuestions([acceptQuestion(q)])).toHaveLength(0);
    }
  });
  it('restores an unresolved excluded question to review', () => {
    const s = state(); s.questions = [{ ...question, status: 'excluded', stem: '' }];
    expect(reducer(s, { type: 'restore-question', id: question.id }).questions[0]?.status).toBe('needs-review');
  });
  it('imports into an empty bank without loss and appends collision-safe IDs', () => {
    expect(reducer({ docs: [], questions: [] }, { type: 'import-bank', bank: bank() })).toEqual(state());
    const s = reducer(state(), { type: 'import-bank', bank: bank() });
    expect(new Set(s.questions.map(q => q.id)).size).toBe(2);
    expect(s.questions[1]?.docId).toBe(s.docs[1]?.doc.id);
    expect(s.docs[1]?.pdf).toBeNull(); expect(s.docs[1]?.cleanPages).toEqual([]);
  });
});

describe('conservative duplicate review', () => {
  it('uses NFC and normalized whitespace/case across sources without deleting copies', () => {
    const qs = [{ ...question, stem: 'CAFÉ  question' }, copy({ stem: 'cafe\u0301 question' })];
    expect(findDuplicates(qs).get('two:q1')).toBe('one:q1'); expect(eligibleQuestions(qs)).toHaveLength(1); expect(qs).toHaveLength(2);
  });
  it('keeps differing options, option order, passages, keys, diagrams and same-file repeats separate', () => {
    const variants = [copy({ options: question.options.map(o => ({ ...o, text: `${o.text}!` })) }), copy({ options: [...question.options].reverse() }), copy({ context: 'Other passage' }), copy({ answerKey: 'B', answerSource: 'manual' }), copy({ warnings: [{ code: 'diagram-reference', message: 'See figure', blocking: false }] }), copy({ docId: 'one' })];
    for (const q of variants) expect(findDuplicates([question, q]).size).toBe(0);
  });
  it('prefers a checked copy over an unresolved original', () => {
    const unresolved = { ...question, status: 'needs-review' as const, warnings: [{ code: 'numbering-gap' as const, message: 'Check numbering', blocking: true }] };
    expect(findDuplicates([unresolved, copy()]).get(question.id)).toBe('two:q1');
    expect(eligibleQuestions([unresolved, copy()])).toHaveLength(1);
  });
  it('promotes a copy when its original is excluded or changed', () => {
    expect(findDuplicates([{ ...question, status: 'excluded' }, copy()]).size).toBe(0);
    expect(findDuplicates([{ ...question, stem: 'Changed' }, copy()]).size).toBe(0);
  });
});

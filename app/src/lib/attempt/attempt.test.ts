import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerOf, createAttempt, grade, parseAttempts, selectedPool, serializeAttempts, transition, type Setup } from './attempt';
import { keyTemplate, parseKey } from '../bank/keys';
import { reducer, fromBank } from '../../state/store';
import { makeBank } from '../bank/bank';
import type { Question, SourceDoc } from '../types';
const source: SourceDoc = { id: 'one', fileName: 'paper.pdf', label: 'Paper', year: '2024', sizeBytes: 12, pageCount: 2, pagesProcessed: 2, addedAt: 10, warnings: [], synthetic: true };
const question: Question = { id: 'one:q1', docId: 'one', number: 1, page: 1, pageEnd: 1, stem: 'Which is correct?', context: 'Passage', options: ['A', 'B', 'C', 'D'].map(key => ({ key, sourceLabel: `(${key})`, text: `Choice ${key}` })), status: 'ok', confidence: .9, warnings: [], answerKey: null, answerSource: 'none', explanation: null, rawText: 'original raw block', edited: false };
const setup: Setup = { mode: 'exam', sourceIds: ['one'], year: '', count: 1, seed: 'test', minutes: 1, scheme: null };
const create = () => createAttempt([question], [source], setup, 1000, 'attempt-1');
afterEach(() => vi.useRealTimers());
describe('selection and snapshots', () => {
  it('filters before dedup so selected-source copies remain eligible, with year filtering', () => {
    const other = { ...source, id: 'two', year: '2025' };
    const copy = { ...question, id: 'two:q1', docId: 'two' };
    expect(selectedPool([question, copy], [source, other], ['two'], '')).toEqual([copy]);
    expect(selectedPool([question, copy], [source, other], ['one', 'two'], '2025')).toEqual([copy]);
    expect(selectedPool([question, copy], [source, other], ['one'], '2025')).toEqual([]);
  });
  it('samples without replacement reproducibly and freezes questions, keys and provenance', () => {
    const qs = Array.from({ length: 10 }, (_, i) => ({ ...structuredClone(question), id: `q${i}`, number: i + 1, stem: `Question ${i}` }));
    const sources = [structuredClone(source)];
    const options = { ...setup, count: 5 };
    const a = createAttempt(qs, sources, options, 1000, 'x');
    expect(createAttempt(qs, sources, options, 2000, 'y').questions).toEqual(a.questions);
    expect(new Set(a.questions.map(q => q.id)).size).toBe(5);
    qs.forEach(q => { q.stem = 'edited'; q.options[0]!.text = 'edited'; q.answerKey = 'A'; }); sources[0]!.label = 'Changed';
    expect(a.questions[0]!.stem).not.toBe('edited'); expect(a.questions[0]!.options[0]!.text).toBe('Choice A'); expect(a.questions[0]!.answerKey).toBeNull(); expect(a.sources[0]!.label).toBe('Paper');
  });
  it('rejects invalid count, seed, duration and scheme instead of silently clamping', () => {
    for (const patch of [{ count: 0 }, { count: 2 }, { count: 1.5 }, { seed: '' }, { minutes: .5 }, { minutes: 1441 }, { scheme: { correct: Infinity, incorrect: 0, unanswered: 0 } }]) expect(() => createAttempt([question], [source], { ...setup, ...patch }, 1, 'x')).toThrow();
    expect(selectedPool([{ ...question, status: 'excluded' }, { ...question, id: 'b', status: 'needs-review' }], [source], ['one'], '')).toEqual([]);
  });
});
describe('deadline state machine', () => {
  it('locks exactly at expiry even before a tick and is idempotent across repeated submits and reload', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    let a = create();
    vi.setSystemTime(60_999); a = transition(a, { type: 'answer', id: question.id, key: 'A' }, Date.now());
    expect(a.answers[question.id]).toBe('A');
    vi.setSystemTime(61_000); a = transition(a, { type: 'answer', id: question.id, key: 'B' }, Date.now());
    expect(a).toMatchObject({ reason: 'timeout', submittedAt: 61_000, answers: { [question.id]: 'A' } });
    const reloaded = parseAttempts(serializeAttempts([a]))[0]!;
    expect(transition(reloaded, { type: 'submit' }, 99_000)).toBe(reloaded);
    expect(transition(reloaded, { type: 'mark', id: question.id }, 99_000)).toBe(reloaded);
    expect(transition(reloaded, { type: 'navigate', index: 0 }, 99_000)).toBe(reloaded);
  });
  it('reconciles background/reload expiry at the absolute deadline, not at resume time', () => {
    const a = parseAttempts(serializeAttempts([create()]))[0]!;
    const resumed = transition(a, { type: 'tick' }, 999_000);
    expect(resumed.submittedAt).toBe(61_000); expect(grade(resumed).elapsedMs).toBe(60_000);
  });
  it('practice is untimed; navigation, marking, clearing and early submit persist', () => {
    let a = createAttempt([question], [source], { ...setup, mode: 'practice' }, 1000, 'p');
    a = transition(a, { type: 'answer', id: question.id, key: 'A' }, 999_000);
    a = transition(a, { type: 'mark', id: question.id }, 999_001);
    expect(a.marked).toEqual([question.id]); expect(a.submittedAt).toBeNull();
    a = transition(a, { type: 'answer', id: question.id, key: null }, 999_002);
    expect(a.answers).toEqual({});
    a = transition(a, { type: 'submit' }, 999_003);
    expect(parseAttempts(serializeAttempts([a]))).toEqual([a]);
    expect(transition(a, { type: 'answer', id: question.id, key: 'B' }, 999_004)).toBe(a);
  });
  it('rejects invalid option/navigation and handles prototype-like imported IDs safely', () => {
    const a = create(); expect(transition(a, { type: 'answer', id: question.id, key: 'E' }, 1001)).toBe(a);
    expect(transition(a, { type: 'navigate', index: 4 }, 1001)).toBe(a);
    const special = createAttempt([{ ...question, id: '__proto__' }], [source], setup, 1000, 'safe');
    expect(answerOf(special, '__proto__')).toBeUndefined();
    const answered = transition(special, { type: 'answer', id: '__proto__', key: 'A' }, 1001);
    expect(answerOf(answered, '__proto__')).toBe('A'); expect(grade(answered).attempted).toBe(1);
  });
});
describe('honest results and keys', () => {
  it('unkeyed questions stay ungraded; partial keys and custom deductions count only keyed questions', () => {
    expect(grade(create())).toMatchObject({ keyed: 0, score: null });
    const qs = [question, { ...question, id: 'correct', number: 2, answerKey: 'A', answerSource: 'manual' as const }, { ...question, id: 'wrong', number: 3, answerKey: 'B', answerSource: 'imported' as const }, { ...question, id: 'empty', number: 4, answerKey: 'C', answerSource: 'manual' as const }];
    let a = createAttempt(qs, [source], { ...setup, count: 4, scheme: { correct: 2, incorrect: -.5, unanswered: 0 } }, 1000, 'g');
    for (const id of [question.id, 'correct', 'wrong']) a = transition(a, { type: 'answer', id, key: 'A' }, 1001);
    a = transition(a, { type: 'submit' }, 2000);
    expect(grade(a)).toMatchObject({ attempted: 3, unanswered: 1, keyed: 3, correct: 1, incorrect: 1, keyedUnanswered: 1, score: 1.5, elapsedMs: 1000 });
  });
  it('maps repeated printed numbers by source + number + ID and validates atomically', () => {
    const qs = [question, { ...question, id: 'one:q1-copy' }];
    const template = keyTemplate(qs, 'one'); template.entries[1]!.key = 'B';
    const patches = parseKey(JSON.stringify(template), qs, 'one');
    const next = reducer(fromBank(makeBank([source], qs)), { type: 'set-keys', patches, source: 'imported' });
    expect(next.questions.map(q => q.answerKey)).toEqual([null, 'B']); expect(next.questions[1]!.status).toBe('ok');
    template.entries[0]!.key = '(1)'; expect(() => parseKey(JSON.stringify(template), qs, 'one')).toThrow('canonical option');
    template.entries[0]!.key = 'A'; template.entries[0]!.number = 2; expect(() => parseKey(JSON.stringify(template), qs, 'one')).toThrow('number and questionId');
    expect(() => parseKey(JSON.stringify(template), qs, 'other')).toThrow('selected source');
  });
  it('rejects corrupt persistence including missing snapshots, multiple active attempts and impossible deadlines', () => {
    for (const patch of [{ sources: [] }, { answers: { unknown: 'A' } }, { marked: ['unknown'] }, { deadline: 0 }, { current: -1 }, { submittedAt: 70_000, reason: 'manual' }, { scheme: { correct: null } }]) expect(() => parseAttempts(JSON.stringify({ format: 'pdf-smart-attempts', version: 1, attempts: [{ ...create(), ...patch }] }))).toThrow();
    expect(() => parseAttempts(serializeAttempts([create(), { ...create(), id: 'other' }]))).toThrow();
    expect(() => parseAttempts('null')).toThrow();
  });
});

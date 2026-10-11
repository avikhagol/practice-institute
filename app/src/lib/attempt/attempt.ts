import { eligibleQuestions, makeBank, parseBank } from '../bank/bank';
import { sampleWithoutReplacement } from '../rng';
import type { Question, SourceDoc } from '../types';

export interface Scheme { correct: number; incorrect: number; unanswered: number }
export interface Attempt {
  id: string; mode: 'practice' | 'exam'; seed: string;
  sources: SourceDoc[]; questions: Question[];
  startedAt: number; deadline: number | null; submittedAt: number | null;
  reason: 'manual' | 'timeout' | null;
  answers: Record<string, string>; marked: string[]; current: number;
  scheme: Scheme | null;
}
export interface Setup { mode: Attempt['mode']; sourceIds: string[]; year: string; count: number; seed: string; minutes: number; scheme: Scheme | null }
export function selectedPool(questions: Question[], sources: SourceDoc[], sourceIds: string[], year: string) {
  const ids = new Set(sources.filter(s => sourceIds.includes(s.id) && (!year || (s.year ?? 'unknown') === year)).map(s => s.id));
  return eligibleQuestions(questions.filter(q => ids.has(q.docId)));
}
export function validScheme(s: Scheme) {
  return [s.correct, s.incorrect, s.unanswered].every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
}
export function createAttempt(questions: Question[], sources: SourceDoc[], setup: Setup, now: number, id: string): Attempt {
  const pool = selectedPool(questions, sources, setup.sourceIds, setup.year);
  if (!Number.isInteger(setup.count) || setup.count < 1 || setup.count > pool.length) throw new Error(`Choose 1–${pool.length} ready questions.`);
  if (!setup.seed.trim() || setup.seed.length > 200) throw new Error('Supply a seed of 1–200 characters.');
  if (setup.mode === 'exam' && (!Number.isInteger(setup.minutes) || setup.minutes < 1 || setup.minutes > 1440)) throw new Error('Exam duration must be 1–1,440 whole minutes.');
  if (setup.scheme && !validScheme(setup.scheme)) throw new Error('Each marking value must be a finite number between −1,000 and 1,000.');
  const chosen = sampleWithoutReplacement(pool, setup.count, setup.seed);
  // JSON-compatible deep snapshots: later question/key/source edits cannot alter an attempt.
  return JSON.parse(JSON.stringify({ id, mode: setup.mode, seed: setup.seed, sources: sources.filter(s => chosen.some(q => q.docId === s.id)), questions: chosen, startedAt: now, deadline: setup.mode === 'exam' ? now + setup.minutes * 60_000 : null, submittedAt: null, reason: null, answers: {}, marked: [], current: 0, scheme: setup.scheme })) as Attempt;
}
export type AttemptAction =
  | { type: 'answer'; id: string; key: string | null }
  | { type: 'mark'; id: string }
  | { type: 'navigate'; index: number }
  | { type: 'submit' }
  | { type: 'tick' };
/** Every event reconciles expiry first, including answers arriving before the timer callback. */
export function transition(a: Attempt, action: AttemptAction, now: number): Attempt {
  if (a.submittedAt !== null) return a;
  if (a.deadline !== null && now >= a.deadline) return { ...a, submittedAt: a.deadline, reason: 'timeout' };
  if (action.type === 'submit') return { ...a, submittedAt: Math.max(a.startedAt, now), reason: 'manual' };
  if (action.type === 'navigate') return Number.isInteger(action.index) && action.index >= 0 && action.index < a.questions.length ? { ...a, current: action.index } : a;
  if (action.type === 'mark') return a.questions.some(q => q.id === action.id) ? { ...a, marked: a.marked.includes(action.id) ? a.marked.filter(id => id !== action.id) : [...a.marked, action.id] } : a;
  if (action.type === 'answer') {
    const q = a.questions.find(q => q.id === action.id);
    if (!q || (action.key !== null && !q.options.some(o => o.key === action.key))) return a;
    const answers = { ...a.answers };
    if (action.key === null) delete answers[action.id]; else Object.defineProperty(answers, action.id, { value: action.key, enumerable: true, configurable: true, writable: true });
    return { ...a, answers };
  }
  return a;
}
export function answerOf(a: Attempt, id: string): string | undefined { return Object.hasOwn(a.answers, id) ? a.answers[id] : undefined; }
export function grade(a: Attempt) {
  let correct = 0, incorrect = 0, keyedUnanswered = 0;
  for (const q of a.questions) {
    if (!q.answerKey) continue;
    if (!answerOf(a, q.id)) keyedUnanswered++;
    else if (answerOf(a, q.id) === q.answerKey) correct++; else incorrect++;
  }
  const keyed = correct + incorrect + keyedUnanswered;
  const attempted = Object.keys(a.answers).length;
  return { attempted, unanswered: a.questions.length - attempted, keyed, correct, incorrect, keyedUnanswered,
    score: keyed && a.scheme ? correct * a.scheme.correct + incorrect * a.scheme.incorrect + keyedUnanswered * a.scheme.unanswered : null,
    elapsedMs: Math.max(0, (a.submittedAt ?? a.startedAt) - a.startedAt) };
}
export const ATTEMPT_STORAGE_KEY = 'pdf-smart-attempts-v1';
export const ATTEMPT_LIMIT = 20;
export function parseAttempts(text: string): Attempt[] {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error('Saved attempts exceed 10 MB.');
  const data = JSON.parse(text) as { format?: string; version?: number; attempts?: unknown[] };
  if (!data || data.format !== 'pdf-smart-attempts' || data.version !== 1 || !Array.isArray(data.attempts) || data.attempts.length > ATTEMPT_LIMIT) throw new Error('Invalid saved attempts.');
  const ids = new Set<string>();
  let active = 0;
  return data.attempts.map(value => {
    const a = value as Attempt;
    const fail = () => { throw new Error('Invalid saved attempt.'); };
    if (!a || typeof a.id !== 'string' || !a.id || ids.has(a.id) || !['exam', 'practice'].includes(a.mode) || typeof a.seed !== 'string' || a.seed.length > 200) fail();
    ids.add(a.id);
    const bank = parseBank(JSON.stringify(makeBank(a.sources, a.questions)));
    if (!bank.questions.length || eligibleQuestions(bank.questions).length !== bank.questions.length) fail();
    if (!Number.isSafeInteger(a.startedAt) || a.startedAt < 0 || (a.mode === 'practice' ? a.deadline !== null : !Number.isSafeInteger(a.deadline) || a.deadline! <= a.startedAt || a.deadline! - a.startedAt > 86_400_000)) fail();
    if (a.submittedAt === null) { active++; if (a.reason !== null || active > 1) fail(); }
    else if (!Number.isSafeInteger(a.submittedAt) || a.submittedAt < a.startedAt || !['manual', 'timeout'].includes(a.reason!) || (a.reason === 'timeout' && a.submittedAt !== a.deadline) || (a.deadline !== null && a.submittedAt > a.deadline)) fail();
    if (!Number.isInteger(a.current) || a.current < 0 || a.current >= bank.questions.length || !Array.isArray(a.marked) || new Set(a.marked).size !== a.marked.length || a.marked.some(id => !bank.questions.some(q => q.id === id))) fail();
    if (!a.answers || typeof a.answers !== 'object' || Array.isArray(a.answers) || Object.entries(a.answers).some(([id, key]) => !bank.questions.some(q => q.id === id && q.options.some(o => o.key === key)))) fail();
    if (a.scheme !== null && (!a.scheme || !validScheme(a.scheme))) fail();
    return { ...a, sources: bank.sources, questions: bank.questions };
  });
}
export function serializeAttempts(attempts: Attempt[]) {
  const text = JSON.stringify({ format: 'pdf-smart-attempts', version: 1, attempts });
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error('Attempts exceed 10 MB. Export and clear old attempts.');
  return text;
}

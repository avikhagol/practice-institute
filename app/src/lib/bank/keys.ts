import type { Question } from '../types';
export interface KeyPatch { id: string; key: string | null; explanation: string | null }
/** Requires both source question number and stable ID: repeated printed numbers are unambiguous. */
export function parseKey(text: string, questions: Question[], sourceId: string): KeyPatch[] {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Answer key exceeds 1 MB.');
  const data = JSON.parse(text) as { format: string; version: number; sourceId: string; entries: { questionId: string; number: number; key: string | null; explanation?: string | null }[] };
  if (!data || data.format !== 'pdf-smart-answer-key' || data.version !== 1 || data.sourceId !== sourceId || !Array.isArray(data.entries) || !data.entries.length || data.entries.length > 5000) throw new Error('Choose a version 1 PDF Smart answer key for the selected source, with 1–5,000 entries.');
  const ids = new Set<string>();
  return data.entries.map((e, i) => {
    if (!e || typeof e.questionId !== 'string') throw new Error(`entries[${i}]: supply questionId.`);
    const q = questions.find(q => q.docId === sourceId && q.id === e.questionId && q.number === e.number);
    if (!q || ids.has(e.questionId)) throw new Error(`entries[${i}]: number and questionId must identify one question in the selected source, without repeated entries.`);
    ids.add(q.id);
    if (e.key !== null && !q.options.some(o => o.key === e.key)) throw new Error(`entries[${i}]: key must match a canonical option key (not its printed label), or be null.`);
    if (e.explanation !== undefined && e.explanation !== null && (typeof e.explanation !== 'string' || e.explanation.length > 100_000)) throw new Error(`entries[${i}]: explanation must be text or null.`);
    return { id: q.id, key: e.key, explanation: e.explanation === undefined ? q.explanation : e.explanation };
  });
}
export function keyTemplate(questions: Question[], sourceId: string) {
  return { format: 'pdf-smart-answer-key', version: 1, sourceId, entries: questions.filter(q => q.docId === sourceId).map(q => ({ questionId: q.id, number: q.number, key: q.answerKey, explanation: q.explanation })) };
}

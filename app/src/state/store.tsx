import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageText, Question, SourceDoc } from '../lib/types';
import { acceptQuestion, makeBank, structuralWarnings, type Bank } from '../lib/bank/bank';
import { loadBank, saveBank, SAVE_WARNING } from '../lib/bank/storage';

export interface LoadedDoc {
  doc: SourceDoc;
  cleanPages: PageText[];
  pdf: PDFDocumentProxy | null;
}
export interface State { docs: LoadedDoc[]; questions: Question[] }
export type Action =
  | { type: 'add-doc'; loaded: LoadedDoc; questions: Question[] }
  | { type: 'remove-doc'; docId: string }
  | { type: 'update-doc'; docId: string; patch: Partial<Pick<SourceDoc, 'label' | 'year'>> }
  | { type: 'edit-question'; question: Question; accept?: boolean }
  | { type: 'accept-question'; id: string }
  | { type: 'exclude-question'; id: string }
  | { type: 'restore-question'; id: string }
  | { type: 'add-question'; question: Question; source: SourceDoc }
  | { type: 'import-bank'; bank: Bank }
  | { type: 'set-keys'; patches: { id: string; key: string | null; explanation: string | null }[]; source: 'manual' | 'imported' }
  | { type: 'reset' };

export function fromBank(bank: Bank): State {
  return { docs: bank.sources.map(doc => ({ doc, pdf: null, cleanPages: [] })), questions: bank.questions };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add-doc': return { docs: [...state.docs, action.loaded], questions: [...state.questions, ...action.questions] };
    case 'remove-doc': return { docs: state.docs.filter(d => d.doc.id !== action.docId), questions: state.questions.filter(q => q.docId !== action.docId) };
    case 'update-doc': return { ...state, docs: state.docs.map(d => d.doc.id === action.docId ? { ...d, doc: { ...d.doc, ...action.patch } } : d) };
    case 'edit-question': return { ...state, questions: state.questions.map(q => {
      if (q.id !== action.question.id) return q;
      const edited = { ...action.question, id: q.id, docId: q.docId, number: q.number, page: q.page, pageEnd: q.pageEnd, rawText: q.rawText, edited: true };
      const invalid = structuralWarnings(edited);
      const next = { ...edited, warnings: [...edited.warnings.filter(w => !['missing-stem', 'empty-option', 'option-count'].includes(w.code)), ...invalid] };
      if (action.accept) return acceptQuestion(next);
      return { ...next, status: q.status === 'excluded' ? 'excluded' as const : 'needs-review' as const };
    }) };
    case 'accept-question': return { ...state, questions: state.questions.map(q => q.id === action.id ? acceptQuestion(q) : q) };
    case 'exclude-question': return { ...state, questions: state.questions.map(q => q.id === action.id ? { ...q, status: 'excluded' } : q) };
    case 'restore-question': return { ...state, questions: state.questions.map(q => q.id === action.id ? { ...q, status: q.warnings.some(w => w.blocking) || structuralWarnings(q).length ? 'needs-review' : 'ok' } : q) };
    case 'add-question': return { docs: state.docs.some(d => d.doc.id === action.source.id) ? state.docs : [...state.docs, { doc: action.source, pdf: null, cleanPages: [] }], questions: [...state.questions, action.question] };
    case 'import-bank': {
      // Append atomically. Preserve IDs on empty-bank round trips; namespace collisions.
      const sourceIds = new Set(state.docs.map(d => d.doc.id));
      const questionIds = new Set(state.questions.map(q => q.id));
      const remap = new Map<string, string>();
      const unique = (id: string, ids: Set<string>) => { let next = id, n = 2; while (ids.has(next)) next = `${id}-import${n++}`; ids.add(next); return next; };
      const docs = action.bank.sources.map(doc => {
        const id = unique(doc.id, sourceIds); remap.set(doc.id, id);
        return { doc: { ...doc, id }, pdf: null, cleanPages: [] };
      });
      const questions = action.bank.questions.map(q => ({ ...q, id: unique(q.id, questionIds), docId: remap.get(q.docId)! }));
      return { docs: [...state.docs, ...docs], questions: [...state.questions, ...questions] };
    }
    case 'set-keys': return { ...state, questions: state.questions.map(q => {
      const p = action.patches.find(p => p.id === q.id);
      if (!p || (p.key !== null && !q.options.some(o => o.key === p.key))) return q;
      return { ...q, answerKey: p.key, explanation: p.explanation, answerSource: p.key === null ? 'none' : action.source };
    }) };
    case 'reset': return { docs: [], questions: [] };
  }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void; storageWarning: string | null; retrySave: () => void; saved: boolean } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { const bank = loadBank(window.localStorage); return { state: bank ? fromBank(bank) : { docs: [], questions: [] }, error: null }; }
    catch { return { state: { docs: [], questions: [] }, error: 'Your saved bank could not be read. The saved copy has been left untouched. Import a JSON backup, or make a change to start a new saved bank.' }; }
  });
  const [state, dispatch] = useReducer(reducer, initial.state);
  const [storageWarning, setStorageWarning] = useState<string | null>(initial.error);
  const [retry, setRetry] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // Do not overwrite an unreadable saved copy just by opening the app.
    if (initial.error && state === initial.state && retry === 0) return;
    try {
      saveBank(window.localStorage, makeBank(state.docs.map(d => d.doc), state.questions));
      setStorageWarning(null); setSaved(true);
    } catch { setStorageWarning(SAVE_WARNING); setSaved(false); }
  }, [state, retry, initial]);
  const value = useMemo(() => ({ state, dispatch, storageWarning, saved, retrySave: () => setRetry(n => n + 1) }), [state, storageWarning, saved]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore() { const v = useContext(Ctx); if (!v) throw new Error('useStore outside StoreProvider'); return v; }

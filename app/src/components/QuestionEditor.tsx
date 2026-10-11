import { useId, useState } from 'react';
import { OPTION_KEYS, type Question } from '../lib/types';
import { structuralWarnings } from '../lib/bank/bank';

export function QuestionEditor({ question, onSave, onCancel, isNew = false }: {
  question: Question; onSave: (q: Question, accept: boolean) => void; onCancel: () => void; isNew?: boolean;
}) {
  const [draft, setDraft] = useState(question);
  const prefix = useId();
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<Question>) => { setError(null); setDraft(q => ({ ...q, ...patch })); };
  const save = (accept: boolean) => {
    if (accept) {
      const warnings = structuralWarnings(draft);
      if (warnings.length) { setError(warnings.map(w => w.message).join(' ')); return; }
    }
    onSave({ ...draft, edited: true }, accept);
  };
  return (
    <form className="question-editor" aria-label={isNew ? 'Add question' : `Edit question ${question.number}`} onSubmit={e => { e.preventDefault(); save(true); }}>
      <h3>{isNew ? 'Add a question' : `Edit Q${question.number}`}</h3>
      <p className="muted">Check the question against its source. Save and accept confirms the text and clears blocking parsing warnings. It does not supply an answer.</p>
      <div className="field"><label htmlFor={`${prefix}-stem`}>Question text</label><textarea id={`${prefix}-stem`} autoFocus rows={4} maxLength={100_000} value={draft.stem} onChange={e => update({ stem: e.target.value })} /></div>
      <div className="field"><label htmlFor={`${prefix}-context`}>Passage / directions (optional)</label><textarea id={`${prefix}-context`} rows={3} maxLength={100_000} value={draft.context ?? ''} onChange={e => update({ context: e.target.value || null })} /></div>
      <fieldset>
        <legend>Options (2–5)</legend>
        {draft.options.map(o => (
          <div className="option-editor" key={o.key}>
            <label className="field">Printed label for {o.key}<input value={o.sourceLabel} maxLength={100} onChange={e => update({ options: draft.options.map(item => item.key === o.key ? { ...item, sourceLabel: e.target.value } : item) })} /></label>
            <div className="field"><label htmlFor={`${prefix}-${o.key}`}>Option {o.key}</label><textarea id={`${prefix}-${o.key}`} rows={2} maxLength={100_000} value={o.text} onChange={e => update({ options: draft.options.map(item => item.key === o.key ? { ...item, text: e.target.value } : item) })} /></div>
            <button type="button" className="btn btn-danger btn-sm" aria-label={`Remove option ${o.key}`} onClick={() => {
              update({ options: draft.options.filter(item => item.key !== o.key), ...(draft.answerKey === o.key ? { answerKey: null, answerSource: 'none' as const } : {}) });
            }}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" disabled={draft.options.length >= 5} onClick={() => {
          const key = OPTION_KEYS.find(k => !draft.options.some(o => o.key === k))!;
          update({ options: [...draft.options, { key, sourceLabel: `${key}.`, text: '' }] });
        }}>Add option</button>
      </fieldset>
      {question.answerKey && <p className="callout callout-warn">This question has a supplied answer key ({question.answerKey}). Check it after changing option text. Removing that option clears its key.</p>}
      {error && <p className="callout callout-danger" role="alert">{error}</p>}
      <div className="toolbar">
        <button type="submit" className="btn btn-primary">Save and accept</button>
        <button type="button" className="btn btn-secondary" onClick={() => save(false)}>Save for review</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel editing</button>
      </div>
    </form>
  );
}

import { useId, useRef, useState, type DragEvent } from 'react';
import { LIMITS, formatBytes } from '../lib/pdf/limits';
import { UploadIcon } from './Icons';

interface Props {
  onFiles: (files: File[]) => void;
  onExample?: () => void;
  exampleBusy?: boolean;
  compact?: boolean;
}

/** Keyboard- and screen-reader-accessible drop zone backed by a real file input. */
export function DropZone({ onFiles, onExample, exampleBusy, compact }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const headingId = useId();
  const limitsId = useId();

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <section
      className={`dropzone${over ? ' is-over' : ''}`}
      aria-labelledby={headingId}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {!compact && <UploadIcon />}
      <h2 id={headingId}>{compact ? 'Add more PDFs' : 'Drop your question papers here'}</h2>
      <p className="muted">Select one or several PDFs — past papers from different years combine into one question bank.</p>
      <div className="dropzone-actions">
        <button type="button" className="btn btn-primary" onClick={() => input.current?.click()} aria-describedby={limitsId}>
          Choose PDF files
        </button>
        {onExample && (
          <button type="button" className="btn btn-secondary" onClick={onExample} disabled={exampleBusy}>
            {exampleBusy ? 'Loading example…' : 'Try the example paper'}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <p className="limits" id={limitsId}>
        Up to {LIMITS.maxFiles} PDFs · {formatBytes(LIMITS.maxFileBytes)} each · first {LIMITS.maxPagesPerFile} pages per file · text-based PDFs only (scans are detected, not OCR’d)
      </p>
    </section>
  );
}

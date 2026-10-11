// File queue: validates selection limits, ingests files one at a time (bounded memory),
// exposes per-file progress/errors and per-file cancellation.
import { useCallback, useRef, useState } from 'react';
import { IngestError, ingestPdf, type IngestProgress } from '../lib/pdf/ingest';
import { LIMITS } from '../lib/pdf/limits';
import { useStore } from './store';

export type JobStatus = 'queued' | 'working' | 'done' | 'error' | 'cancelled';

export interface Job {
  key: string;
  file: File;
  status: JobStatus;
  progress: IngestProgress | null;
  error: string | null;
  questionCount: number;
  synthetic: boolean;
}

export function useIngestQueue() {
  const { state, dispatch } = useStore();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(false);
  const queue = useRef<Job[]>([]);

  const patch = useCallback((key: string, p: Partial<Job>) => {
    setJobs((js) => js.map((j) => (j.key === key ? { ...j, ...p } : j)));
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const job = queue.current.shift()!;
        const ctrl = controllers.current.get(job.key);
        if (!ctrl || ctrl.signal.aborted) continue;
        patch(job.key, { status: 'working' });
        try {
          const res = await ingestPdf(job.file, {
            signal: ctrl.signal,
            synthetic: job.synthetic,
            onProgress: (progress) => patch(job.key, { progress }),
          });
          if (ctrl.signal.aborted) {
            await res.pdf.loadingTask.destroy();
            patch(job.key, { status: 'cancelled' });
            continue;
          }
          dispatch({ type: 'add-doc', loaded: { doc: res.doc, cleanPages: res.cleanPages, pdf: res.pdf }, questions: res.questions });
          patch(job.key, { status: 'done', questionCount: res.questions.length });
        } catch (e) {
          if (e instanceof IngestError && e.code === 'cancelled') patch(job.key, { status: 'cancelled' });
          else patch(job.key, { status: 'error', error: e instanceof Error ? e.message : 'Unknown error' });
        } finally {
          controllers.current.delete(job.key);
        }
      }
    } finally {
      running.current = false;
    }
  }, [dispatch, patch]);

  const addFiles = useCallback(
    (files: File[], opts: { synthetic?: boolean } = {}) => {
      setNotice(null);
      const active = jobs.filter((j) => j.status === 'queued' || j.status === 'working').length;
      const room = LIMITS.maxFiles - state.docs.length - active;
      const accepted = files.slice(0, Math.max(0, room));
      if (accepted.length < files.length) {
        setNotice(`Up to ${LIMITS.maxFiles} PDFs can be open at once. ${files.length - accepted.length} file(s) were not added — remove a document first.`);
      }
      const newJobs: Job[] = accepted.map((file) => ({
        key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        status: 'queued',
        progress: null,
        error: null,
        questionCount: 0,
        synthetic: Boolean(opts.synthetic),
      }));
      for (const j of newJobs) controllers.current.set(j.key, new AbortController());
      setJobs((js) => [...js, ...newJobs]);
      queue.current.push(...newJobs);
      void pump();
    },
    [jobs, state.docs.length, pump],
  );

  const cancel = useCallback(
    (key: string) => {
      controllers.current.get(key)?.abort();
      queue.current = queue.current.filter((j) => j.key !== key);
      patch(key, { status: 'cancelled' });
    },
    [patch],
  );

  const dismiss = useCallback((key: string) => setJobs((js) => js.filter((j) => j.key !== key)), []);

  return { jobs, addFiles, cancel, dismiss, notice };
}

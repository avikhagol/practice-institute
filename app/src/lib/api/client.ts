// Student API client. Every call goes to the real backend; nothing here fabricates responses.
// The attempt resume secret is sent as a Bearer token (no cookies cross-origin).

export const API_BASE: string = import.meta.env.VITE_PI_API_BASE ?? 'http://127.0.0.1:8787';

export type Lang = 'en' | 'hi';
export type LangText = { en: string | null; hi: string | null };

export interface ExamInfo {
  code: string;
  title: string;
  instructions: string;
  mode: 'cohort' | 'independent';
  status: 'published' | 'closed';
  scored: boolean;
  duration_s: number;
  opens_at: number;
  closes_at: number;
  late_join_s: number;
  question_count: number;
  pool_count: number;
  max_attempts: number;
  random_subset: boolean;
  languages: Lang[];
  marks: { correct: number; wrong: number };
  server_now: number;
}

export interface ExamQuestion {
  qid: string;
  context: LangText;
  stem: LangText;
  options: { key: string; en: string | null; hi: string | null }[];
}

export interface SavedAnswer {
  choice: string | null;
  marked: boolean;
  seq: number;
}

export interface AttemptState {
  attempt_id: string;
  attempt_number: number;
  alias: string;
  status: 'active' | 'submitted' | 'expired';
  phase: 'lobby' | 'running' | 'finished';
  finish_reason: 'submitted' | 'timeout' | null;
  started_at: number;
  deadline_at: number;
  finished_at: number | null;
  last_seq: number;
  server_now: number;
  exam: ExamInfo;
  questions: ExamQuestion[];
  answers: Record<string, SavedAnswer>;
}

export interface JoinResult {
  attempt_id: string;
  token: string;
  exam: ExamInfo;
  started_at: number;
  deadline_at: number;
  server_now: number;
}

export interface Change {
  qid: string;
  choice: string | null;
  marked: boolean;
  seq: number;
}

export interface SaveAck {
  acked: Record<string, number>;
  last_seq: number;
  server_now: number;
  deadline_at: number;
}

export interface AttemptResult {
  status: 'submitted' | 'expired';
  finish_reason: 'submitted' | 'timeout';
  scores_released: boolean;
  answers_released: boolean;
  score?: number | null;
  correct?: number;
  wrong?: number;
  unanswered?: number;
  total?: number;
  review?: (ExamQuestion & { answer_key: string | null; explanation: LangText; your_choice: string | null })[];
}

/** HTTP error from the API (server reachable). `status` 0 means the network failed. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string; timeoutMs?: number } = {}): Promise<T> {
  const { token, timeoutMs = 12_000, ...rest } = init;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (rest.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers, signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Cannot reach the Practice Institute server. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page (e.g. tunnel down) */
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown; error?: unknown } | null);
    const msg = typeof detail?.detail === 'string' ? detail.detail : typeof detail?.error === 'string' ? detail.error : `Server error (HTTP ${res.status}).`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export const api = {
  health: () => call<{ status: string; server_now: number }>('/api/v1/health', { timeoutMs: 6000 }),
  exam: (code: string) => call<ExamInfo>(`/api/v1/exams/${encodeURIComponent(code.trim().toUpperCase())}`),
  join: (code: string, alias: string) =>
    call<JoinResult>(`/api/v1/exams/${encodeURIComponent(code.trim().toUpperCase())}/join`, { method: 'POST', body: JSON.stringify({ alias }) }),
  reattempt: (id: string, token: string) => call<JoinResult>(`/api/v1/attempts/${encodeURIComponent(id)}/reattempt`, { method: 'POST', token, body: '{}' }),
  attempt: (id: string, token: string) => call<AttemptState>(`/api/v1/attempts/${encodeURIComponent(id)}`, { token }),
  save: (id: string, token: string, changes: Change[]) =>
    call<SaveAck>(`/api/v1/attempts/${encodeURIComponent(id)}/answers`, { method: 'POST', token, body: JSON.stringify({ changes }) }),
  submit: (id: string, token: string, changes: Change[]) =>
    call<{ status: string; finish_reason: string; finished_at: number; server_now: number }>(
      `/api/v1/attempts/${encodeURIComponent(id)}/submit`, { method: 'POST', token, body: JSON.stringify({ changes }) }),
  result: (id: string, token: string) => call<AttemptResult>(`/api/v1/attempts/${encodeURIComponent(id)}/result`, { token }),
};

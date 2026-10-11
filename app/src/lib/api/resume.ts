// Per-device resume credentials for shared-exam attempts. This is NOT shared exam state:
// the server is authoritative for answers, deadlines and grades; this only remembers
// which attempts this browser may resume (the secret token the server issued at join).

export interface ResumeEntry {
  attemptId: string;
  token: string;
  code: string;
  title: string;
  alias: string;
  joinedAt: number;
}

export const RESUME_KEY = 'practice-institute-resume-v1';
const LIMIT = 50;

export function loadResume(storage: Pick<Storage, 'getItem'> = localStorage): ResumeEntry[] {
  try {
    const data = JSON.parse(storage.getItem(RESUME_KEY) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(
      (e): e is ResumeEntry =>
        e && typeof e.attemptId === 'string' && typeof e.token === 'string' && typeof e.code === 'string' && typeof e.title === 'string' && typeof e.alias === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberAttempt(entry: ResumeEntry, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const rest = loadResume(storage).filter((e) => e.attemptId !== entry.attemptId);
  storage.setItem(RESUME_KEY, JSON.stringify([entry, ...rest].slice(0, LIMIT)));
}

export function findAttempt(attemptId: string, storage: Pick<Storage, 'getItem'> = localStorage): ResumeEntry | undefined {
  return loadResume(storage).find((e) => e.attemptId === attemptId);
}

export function forgetAttempt(attemptId: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  storage.setItem(RESUME_KEY, JSON.stringify(loadResume(storage).filter((e) => e.attemptId !== attemptId)));
}

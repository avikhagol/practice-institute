// Explicit, user-visible processing bounds (shown on the landing page and in errors).
export const LIMITS = {
  maxFiles: 10,
  maxFileBytes: 40 * 1024 * 1024,
  maxPagesPerFile: 200,
  /** Pages are processed sequentially; files one at a time. Keeps memory bounded. */
  pageConcurrency: 1,
} as const;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type PreflightError = { code: 'not-pdf' | 'too-large' | 'empty'; message: string };

/** Cheap checks before PDF.js is even loaded. Magic bytes are checked separately. */
export function preflight(file: { name: string; size: number; type: string }): PreflightError | null {
  if (file.size === 0) return { code: 'empty', message: 'The file is empty (0 bytes).' };
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) return { code: 'not-pdf', message: 'Not a PDF file. Only .pdf documents are supported.' };
  if (file.size > LIMITS.maxFileBytes)
    return {
      code: 'too-large',
      message: `File is ${formatBytes(file.size)}; the limit is ${formatBytes(LIMITS.maxFileBytes)} per file.`,
    };
  return null;
}

/** True when the first bytes contain the %PDF- signature (allowing leading junk up to 1 KB, as PDF.js does). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

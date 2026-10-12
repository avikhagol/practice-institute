import fs from 'node:fs';
export function redact(line: string): string {
  // Drop the whole line if a sensitive field is present: values can contain
  // whitespace, escaped quotes or multiple cookies, making partial redaction unsafe.
  if (/(?:password|confirm|token|secret|authorization|cookie)["']?\s*[=:]/i.test(line)) return '[redacted]';
  return line.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]');
}
export class Logs {
  tail: string[] = [];
  constructor(readonly file: string) {}
  append(line: string): void {
    const safe = redact(line).slice(0, 8192);
    this.tail.push(safe); this.tail = this.tail.slice(-20);
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size + Buffer.byteLength(safe) > 2 * 1024 * 1024) {
        for (let n = 4; n >= 1; n--) { const source = `${this.file}.${n}`; if (fs.existsSync(source)) fs.renameSync(source, `${this.file}.${n + 1}`); }
        fs.renameSync(this.file, `${this.file}.1`);
      }
      fs.appendFileSync(this.file, safe + '\n', { mode: 0o600 });
    } catch { /* Logging failures must never reveal the original line through exception reporting. */ }
  }
}

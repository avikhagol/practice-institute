// Client clock sync. The countdown uses (server deadline) − (local now + offset); the server
// still enforces the real cutoff, so a wrong local clock can only mislead the display, never
// extend the exam.

/** Estimated server − client clock offset in ms from one request's send/receive times. */
export function serverOffset(sentAt: number, receivedAt: number, serverNow: number): number {
  return serverNow - Math.round((sentAt + receivedAt) / 2);
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Local wall-clock rendering plus explicit UTC, so schedules are unambiguous across timezones. */
export function formatWhen(epochMs: number): string {
  const d = new Date(epochMs);
  const local = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const utc = d.toISOString().slice(0, 16).replace('T', ' ');
  return `${local} (${utc} UTC)`;
}

// Owner-facing copy and pure state->text helpers (PACKAGING.md §9). No DOM access here.
import type { ExamActivity, LauncherState, ServerStatus, TunnelStatus } from '../shared/ipc';

export type Tone = 'neutral' | 'busy' | 'good' | 'bad';
export interface Badge { icon: string; word: string; tone: Tone }

export function serverBadge(s: ServerStatus): Badge {
  switch (s.kind) {
    case 'stopped': return { icon: '■', word: 'Stopped', tone: 'neutral' };
    case 'starting': case 'probing': return { icon: '…', word: 'Starting', tone: 'busy' };
    case 'running': return { icon: '✔', word: 'Running', tone: 'good' };
    case 'stopping': return { icon: '…', word: 'Stopping', tone: 'busy' };
    case 'failed': return { icon: '⚠', word: 'Problem', tone: 'bad' };
  }
}

export function tunnelBadge(t: TunnelStatus): Badge {
  switch (t.kind) {
    case 'not-configured': return { icon: '○', word: 'Not set up', tone: 'neutral' };
    case 'stopped': return { icon: '■', word: 'Stopped', tone: 'neutral' };
    case 'starting': return { icon: '…', word: 'Starting', tone: 'busy' };
    case 'running-unverified': return { icon: '◐', word: 'Running – not verified', tone: 'busy' };
    case 'connected': return { icon: '✔', word: 'Connected', tone: 'good' };
    case 'verified': return { icon: '✔', word: 'Verified', tone: 'good' };
    case 'failed': return { icon: '⚠', word: 'Problem', tone: 'bad' };
  }
}

export const KEEP_AWAKE_WARNING = 'Keep this laptop awake, plugged in and online until every student has submitted. Closing the lid or losing Wi-Fi stops the exam for everyone.';
export const KEEP_AWAKE_DETAIL = 'Sleep, closing the lid, losing Wi-Fi or restarting the laptop all cut students off from the exam.';
export const PUBLIC_RULE = 'Only /api/v1 is public. The admin site, uploads and backups are never reachable through the tunnel.';

export interface Problem { title: string; body: string; changePort: boolean; logTail: string[] }

export function serverProblem(s: ServerStatus): Problem | null {
  if (s.kind !== 'failed') return null;
  const base = { changePort: false, logTail: s.logTail.slice(-20) };
  switch (s.reason) {
    case 'port-in-use':
      return { ...base, title: 'Port in use', changePort: true, body: `Another program is using port ${s.port ?? 8787}. Close it or choose a different port in Setup.` };
    case 'already-running':
      return { ...base, title: 'Already running', body: 'Practice Institute is already running for this user.' };
    case 'crashed':
      return { ...base, title: 'The server stopped unexpectedly', body: 'The server stopped unexpectedly. Recent log lines are shown below.' };
    case 'config':
      return { ...base, title: 'Settings problem', body: 'The saved settings could not be used. Check the ports and addresses in Setup.' };
    case 'probe-failed':
      return { ...base, title: 'Server did not become ready', body: 'The server started but did not answer its health check. Open the logs folder for details.' };
    case 'runtime-missing':
      return { ...base, title: 'Installation is incomplete', body: 'Part of the installed program is missing. Reinstall Practice Institute; your data is kept.' };
  }
}

export const OWNER_ERRORS: Record<string, { field: 'username' | 'password' | 'confirm' | 'form'; text: string }> = {
  'bad-input': { field: 'form', text: 'Please fill in every field.' },
  'bad-username': { field: 'username', text: 'Choose a username with letters, numbers, dots, dashes or underscores.' },
  mismatch: { field: 'confirm', text: 'The two passwords do not match.' },
  'weak-password': { field: 'password', text: 'Use at least 12 characters.' },
  'owner-exists': { field: 'form', text: 'An owner account already exists on this laptop.' },
};

export function settingsError(code: string, message: string): string {
  if (code === 'server-running') return 'Stop the server and tunnel before changing these settings.';
  if (code === 'busy') return 'Another action is in progress. Try again in a moment.';
  if (code.startsWith('invalid-')) return `Please check the ${code.slice(8).replace(/([A-Z])/g, ' $1').toLowerCase()} value. ${message}`.trim();
  return message || 'Settings could not be saved.';
}

/** Reason recovery is unavailable, or null when allowed. Fails closed when activity is unknown. */
export function recoveryBlock(a: ExamActivity | null): string | null {
  if (!a) return 'Checking whether an exam is in progress…';
  if (a.activeAttempts > 0) return `${a.activeAttempts} student attempt${a.activeAttempts === 1 ? ' is' : 's are'} in progress. Backup and restore wait until everyone has submitted.`;
  if (a.openExams > 0) return `${a.openExams} exam${a.openExams === 1 ? ' is' : 's are'} still open. Close them in the admin site first.`;
  return null;
}

export function settingsLocked(s: LauncherState): boolean {
  const serverIdle = s.server.kind === 'stopped' || s.server.kind === 'failed';
  const tunnelIdle = s.tunnel.kind === 'not-configured' || s.tunnel.kind === 'stopped' || s.tunnel.kind === 'failed';
  return !(serverIdle && tunnelIdle);
}

export const MISSING_LABEL: Record<string, string> = {
  hostname: 'Public API hostname (Setup)',
  'tunnel-id': 'Tunnel ID',
  credentials: 'Tunnel credentials file',
  'student-origin': "Students' website address (Setup)",
};

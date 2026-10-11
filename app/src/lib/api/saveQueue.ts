// Autosave queue for one attempt. Pure logic (no React, no fetch) so it is unit-testable.
//
// Every local edit gets a strictly increasing `seq`. Only the newest edit per question is
// kept pending; the server applies a change only if its seq is newer than what it stored,
// so retries and out-of-order deliveries are idempotent. A change stays "pending" until the
// server acknowledges a seq >= the pending seq — a local queue never claims success.

import type { Change, SavedAnswer } from './client';

export interface QueueState {
  seq: number;
  /** Latest local value per question (what the student sees). */
  local: Record<string, { choice: string | null; marked: boolean }>;
  /** Unacknowledged changes, newest per question. */
  pending: Record<string, Change>;
}

export function initQueue(serverAnswers: Record<string, SavedAnswer>, lastSeq: number, carry?: QueueState): QueueState {
  const local: QueueState['local'] = {};
  for (const [qid, a] of Object.entries(serverAnswers)) local[qid] = { choice: a.choice, marked: a.marked };
  const pending: QueueState['pending'] = {};
  let seq = lastSeq;
  // Re-apply still-unacknowledged local edits (e.g. after reconnect) on top of server truth.
  if (carry) {
    seq = Math.max(seq, carry.seq);
    for (const [qid, c] of Object.entries(carry.pending)) {
      const server = serverAnswers[qid];
      if (!server || server.seq < c.seq) {
        pending[qid] = c;
        local[qid] = { choice: c.choice, marked: c.marked };
      }
    }
  }
  return { seq, local, pending };
}

export function edit(state: QueueState, qid: string, patch: Partial<{ choice: string | null; marked: boolean }>): QueueState {
  const prev = state.local[qid] ?? { choice: null, marked: false };
  const next = { ...prev, ...patch };
  const seq = state.seq + 1;
  return {
    seq,
    local: { ...state.local, [qid]: next },
    pending: { ...state.pending, [qid]: { qid, choice: next.choice, marked: next.marked, seq } },
  };
}

export function batch(state: QueueState): Change[] {
  return Object.values(state.pending).sort((a, b) => a.seq - b.seq);
}

/** Drop pending entries the server has acknowledged (ack seq >= pending seq). */
export function acknowledge(state: QueueState, acked: Record<string, number>): QueueState {
  const pending = { ...state.pending };
  for (const [qid, seq] of Object.entries(acked)) {
    if (pending[qid] && pending[qid].seq <= seq) delete pending[qid];
  }
  return { ...state, pending };
}

export function pendingCount(state: QueueState): number {
  return Object.keys(state.pending).length;
}

import { describe, expect, it } from 'vitest';
import { acknowledge, batch, edit, initQueue, pendingCount } from './saveQueue';
import { serverOffset } from './time';

describe('save queue', () => {
  it('keeps only the newest edit per question with increasing seq', () => {
    let q = initQueue({}, 4);
    q = edit(q, 'q1', { choice: 'A' });
    q = edit(q, 'q1', { choice: 'B' });
    q = edit(q, 'q2', { marked: true });
    expect(batch(q)).toEqual([
      { qid: 'q1', choice: 'B', marked: false, seq: 6 },
      { qid: 'q2', choice: null, marked: true, seq: 7 },
    ]);
  });

  it('stays pending until the server acknowledges that exact or newer seq', () => {
    let q = edit(initQueue({}, 0), 'q1', { choice: 'A' });
    const sent = batch(q);
    q = edit(q, 'q1', { choice: 'C' }); // edited again while request in flight
    q = acknowledge(q, { q1: sent[0]!.seq });
    expect(pendingCount(q)).toBe(1);
    expect(q.local.q1?.choice).toBe('C');
    q = acknowledge(q, { q1: 2 });
    expect(pendingCount(q)).toBe(0);
  });

  it('re-applies unacknowledged edits after reload/reconnect without regressing newer server data', () => {
    let carry = edit(initQueue({}, 0), 'q1', { choice: 'A' }); // seq 1, never acked
    carry = edit(carry, 'q2', { choice: 'B' }); // seq 2
    const q = initQueue({ q2: { choice: 'D', marked: false, seq: 5 } }, 5, carry);
    expect(q.local.q1?.choice).toBe('A');
    expect(q.local.q2?.choice).toBe('D');
    expect(Object.keys(q.pending)).toEqual(['q1']);
    expect(edit(q, 'q3', { choice: 'A' }).seq).toBe(6);
  });
});

describe('server clock offset', () => {
  it('uses the request midpoint so a slow round trip does not skew the deadline', () => {
    expect(serverOffset(1000, 1200, 5100)).toBe(5100 - 1100);
  });
});

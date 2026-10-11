import { expect, it } from 'vitest';
import { LIMITS, preflight } from './limits';
it('accepts the boundary and rejects oversize PDFs before opening', () => {
  expect(preflight({ name: 'valid.pdf', type: 'application/pdf', size: LIMITS.maxFileBytes })).toBeNull();
  expect(preflight({ name: 'big.pdf', type: 'application/pdf', size: LIMITS.maxFileBytes + 1 })).toMatchObject({ code: 'too-large' });
});

import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, sampleWithoutReplacement, shuffle } from './rng';

describe('seeded randomness', () => {
  it('is reproducible for the same seed', () => {
    const pool = Array.from({ length: 50 }, (_, i) => i);
    expect(sampleWithoutReplacement(pool, 20, 'abc')).toEqual(sampleWithoutReplacement(pool, 20, 'abc'));
    expect(sampleWithoutReplacement(pool, 20, 'abc')).not.toEqual(sampleWithoutReplacement(pool, 20, 'abd'));
  });

  it('samples without replacement and clamps count', () => {
    const pool = Array.from({ length: 30 }, (_, i) => `q${i}`);
    const picked = sampleWithoutReplacement(pool, 30, 'seed');
    expect(new Set(picked).size).toBe(30);
    expect(sampleWithoutReplacement(pool, 999, 'seed')).toHaveLength(30);
    expect(sampleWithoutReplacement(pool, -3, 'seed')).toHaveLength(0);
  });

  it('shuffle keeps every element exactly once', () => {
    const pool = Array.from({ length: 100 }, (_, i) => i);
    const out = shuffle(pool, mulberry32(hashSeed('x')));
    expect([...out].sort((a, b) => a - b)).toEqual(pool);
  });

  it('produces values in [0,1)', () => {
    const r = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

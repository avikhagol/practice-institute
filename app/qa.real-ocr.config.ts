import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['qa/real-ocr.test.ts'], testTimeout: 180000 } });

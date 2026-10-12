// Audit the actual packaged binaries, not only the builder configuration.
import assert from 'node:assert/strict';
import path from 'node:path';
import { getCurrentFuseWire, FuseV1Options, FuseVersion } from '../../desktop/node_modules/@electron/fuses/dist/index.js';
const root = path.resolve(import.meta.dirname, '../..');
for (const file of [
  'release/linux-unpacked/practice-institute',
  'release/win-unpacked/Practice Institute.exe',
]) {
  const wire = await getCurrentFuseWire(path.join(root, file));
  assert.equal(wire.version, FuseVersion.V1);
  for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) {
    assert.equal(wire[FuseV1Options[name]], 48, `${file}: ${name} must be disabled`);
  }
  console.log(`${file}: RunAsNode, NODE_OPTIONS and CLI inspector fuses disabled PASS`);
}

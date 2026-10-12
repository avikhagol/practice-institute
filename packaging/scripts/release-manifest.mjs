// Generate release hashes only after both actual installers and unpacked payloads exist.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const output = path.join(repo, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'desktop/package.json')));
const digest = file => {
  const hash = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
};
const artifacts = [`Practice-Institute-Setup-${pkg.version}-x64.exe`, `practice-institute_${pkg.version}_amd64.deb`].map(name => {
  const file = path.join(output, name), stats = fs.statSync(file);
  if (!stats.isFile() || stats.size < 10 * 1024 * 1024) throw Error(`Missing or implausible installer: ${name}`);
  return { name, bytes: stats.size, sha256: digest(file) };
});
function inventory(root, prefix = '') {
  const files = {}, symlinks = {};
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relative = prefix + entry.name, absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) symlinks[relative] = fs.readlinkSync(absolute);
    else if (entry.isDirectory()) {
      const nested = inventory(absolute, relative + '/'); Object.assign(files, nested.files); Object.assign(symlinks, nested.symlinks);
    } else if (entry.isFile()) files[relative] = { bytes: fs.statSync(absolute).size, sha256: digest(absolute) };
    else throw Error(`Unexpected package file: ${relative}`);
  }
  return { files, symlinks };
}
const resources = {}, glibcEvidence = [];
for (const [platform, folder] of [['win', 'win-unpacked'], ['linux', 'linux-unpacked']]) {
  const root = path.join(output, folder), payload = inventory(root);
  const runtime = JSON.parse(fs.readFileSync(path.join(root, 'resources/runtime/manifest.json')));
  for (const [relative, expected] of Object.entries(runtime.files)) {
    if (payload.files['resources/runtime/' + relative]?.sha256 !== expected) throw Error(`Runtime drift: ${platform}/${relative}`);
  }
  for (const [relative, expected] of Object.entries(runtime.symlinks)) {
    if (payload.symlinks['resources/runtime/' + relative] !== expected) throw Error(`Runtime symlink drift: ${platform}/${relative}`);
  }
  const licenses = Object.keys(payload.files).filter(name => /(?:^|\/)(?:licenses\/|LICENSE|COPYING|NOTICE)/i.test(name));
  if (!licenses.includes('LICENSE.electron.txt') || !licenses.includes('LICENSES.chromium.html')) throw Error('Missing Electron notices');
  resources[platform] = { ...payload, runtime, licenses };
  if (platform === 'linux') for (const relative of Object.keys(payload.files)) {
    const file = path.join(root, relative), fd = fs.openSync(file, 'r'), magic = Buffer.alloc(4);
    try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
    if (magic.toString('hex') !== '7f454c46') continue;
    const dumped = spawnSync('rtk', ['proxy', 'objdump', '-T', file], { maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' });
    const staticBinary = dumped.status !== 0 && /not a dynamic object/.test(dumped.stderr);
    if (dumped.status !== 0 && !staticBinary) throw Error(`ELF symbol audit failed: ${relative}`);
    const symbols = dumped.stdout;
    const versions = [...new Set([...symbols.matchAll(/GLIBC_(\d+\.\d+(?:\.\d+)?)/g)].map(m => m[1]))];
    versions.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return (x[0]-y[0]) || (x[1]-y[1]) || ((x[2]??0)-(y[2]??0)); });
    glibcEvidence.push({ file: relative, versions, maxRequired: versions.at(-1) ?? null, staticBinary });
  }
}
const maximum = glibcEvidence.map(e => e.maxRequired).filter(Boolean).sort((a,b) => { const x=a.split('.').map(Number), y=b.split('.').map(Number); return x[0]-y[0] || x[1]-y[1] || (x[2]??0)-(y[2]??0); }).at(-1);
const manifest = { schema: 1, version: pkg.version, generatedAt: new Date().toISOString(),
  electron: pkg.devDependencies.electron, electronBuilder: pkg.devDependencies['electron-builder'],
  windowsBuildImage: 'electronuserland/builder:wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64',
  artifacts, resources, linux: { glibcMaxRequired: maximum, glibcEvidence, target: 'Ubuntu 22.04 / Debian 12 amd64; clean installation/runtime checks recorded separately in DELIVERY.md' },
  verification: { windowsNative: 'not performed; Linux Wine cross-build only', signing: 'no owner certificate supplied; installer unsigned', publicDeployment: 'not performed' } };
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'SHA256SUMS'), [...artifacts.map(a => `${a.sha256}  ${a.name}`), `${digest(path.join(output, 'manifest.json'))}  manifest.json`].join('\n') + '\n');
console.log(JSON.stringify({ artifacts, glibcMaxRequired: maximum, elfFiles: glibcEvidence.length, licenseFiles: Object.fromEntries(Object.entries(resources).map(([k,v])=>[k,v.licenses.length])) }));

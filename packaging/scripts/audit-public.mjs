// Read-only, fail-closed pre-publication audit. Never prints credential contents.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const denyPath = /(?:^|\/)(?:\.env(?:\..*)?|uploads|backups|release|releases|data|logs|sources)(?:\/|$)|\.(?:sqlite\w*|db|pem|key|pfx|p12|log)$|(?:^|\/)fixtures\/real(?:\/|$)|(?:^|\/)(?:cert\.pem|credentials\.json)$/i;
export function checkRepoPath(name) {
  if (name.endsWith('/.env.example') || name === '.env.example') return;
  if (denyPath.test(name) || /(?:^|\/)tunnel\/.*\.json$/i.test(name)) throw Error(`Private repository path: ${name}`);
}
export function checkText(data, name, allowedTokens = []) {
  const text = data.toString('utf8');
  // Normalize common JS/JSON encodings so escaping cannot hide an API/private marker.
  const decoded = text.replace(/\\u([0-9a-f]{4})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replaceAll('\\/', '/');
  if (/\/api\/admin|dist-admin|\/admin(?:\/|["'`\s])|pi_admin_session|X-CSRF-Token|AccountTag|TunnelSecret|-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|gh[pousr]_[A-Za-z0-9_]+|github_pat_|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(decoded)) {
    throw Error(`Private content marker: ${name}`);
  }
  const allowed = new Set(allowedTokens);
  for (const token of decoded.match(/[A-Za-z0-9_-]{40,}/g) ?? []) {
    if (!allowed.has(sha(token))) throw Error(`Unreviewed long token: ${name}`);
  }
}
export function walk(root, prefix = '') {
  const result = [];
  if (fs.lstatSync(root).isSymbolicLink()) throw Error('Symlink audit root');
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const name = prefix + entry.name, absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw Error(`Symlink: ${name}`);
    if (entry.isDirectory()) result.push(...walk(absolute, name + '/'));
    else if (entry.isFile()) result.push(name);
    else throw Error(`Non-regular file: ${name}`);
  }
  return result.sort();
}
export function auditStudent(root, manifest, policy) {
  if (manifest.schema !== 1 || !manifest.files || typeof manifest.files !== 'object') throw Error('Invalid public manifest');
  if (policy?.schema !== 1 || !policy.pinnedAssets || !policy.allowedTokens) throw Error('Missing reviewed public policy');
  const names = walk(root);
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.files).sort())) throw Error('Public file list differs from reviewed manifest');
  for (const name of names) {
    checkRepoPath(name);
    const record = manifest.files[name];
    if (!record || !/^[a-f0-9]{64}$/.test(record.sha256)) throw Error(`Invalid file record: ${name}`);
    const data = fs.readFileSync(path.join(root, name));
    if (sha(data) !== record.sha256) throw Error(`Public checksum mismatch: ${name}`);
    if (record.mode === 'text') {
      if (name !== 'index.html' && !/^assets\/(?:index|pdf|pdf\.worker\.min)-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)) throw Error(`Unapproved text path: ${name}`);
      checkText(data, name, Object.keys(policy.allowedTokens));
    } else if (record.mode !== 'pinned-asset' || policy.pinnedAssets[name]?.sha256 !== record.sha256) throw Error(`Unapproved pinned asset: ${name}`);
  }
  for (const name of Object.keys(policy.pinnedAssets)) if (!manifest.files[name]) throw Error(`Missing pinned asset: ${name}`);
  return names.length;
}
export function auditGit(root, staged = false, directGit = false) {
  const git = args => execFileSync(directGit ? 'git' : 'rtk', directGit ? args : ['proxy', 'git', ...args], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
  const names = git(args).toString().split('\0').filter(Boolean);
  const indexLinks = new Set(git(['ls-files', '--stage', '-z']).toString().split('\0')
    .filter(entry => entry.startsWith('120000 ')).map(entry => entry.slice(entry.indexOf('\t') + 1)));
  for (const name of names) {
    checkRepoPath(name);
    if (staged ? indexLinks.has(name) : fs.lstatSync(path.join(root, name)).isSymbolicLink()) throw Error(`Repository symlink: ${name}`);
    const data = staged ? git(['show', `:${name}`]) : fs.readFileSync(path.join(root, name));
    // Credentials must not be committed under an innocuous name. Test/source references
    // to field names are allowed; actual key blocks and recognizable access tokens aren't.
    if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|"TunnelSecret"\s*:\s*"[A-Za-z0-9+/=]{16,}"/.test(data.toString('utf8'))) throw Error(`Credential content in repository: ${name}`);
  }
  return names.length;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const gitCount = auditGit(repo, process.argv.includes('--staged'), process.argv.includes('--ci-git'));
    const student = path.resolve(repo, 'app/dist');
    const manifestPath = process.argv.find(a => a.startsWith('--manifest='))?.slice(11) ?? path.join(repo, '.cache/public-manifest.json');
    const policy = JSON.parse(fs.readFileSync(path.join(repo, 'packaging/public-policy.json'), 'utf8'));
    const count = auditStudent(student, JSON.parse(fs.readFileSync(manifestPath, 'utf8')), policy);
    console.log(`Public audit passed: ${gitCount} ${process.argv.includes('--staged') ? 'staged' : 'tracked + nonignored source'} paths, ${count} manifest-bound student files. No publication performed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

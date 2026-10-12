// Create a build-specific manifest only after every byte passes the checked-in policy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk, sha, checkRepoPath, checkText, auditStudent } from './audit-public.mjs';
const repo = fileURLToPath(new URL('../..', import.meta.url));
const root = path.join(repo, 'app/dist');
const policy = JSON.parse(fs.readFileSync(path.join(repo, 'packaging/public-policy.json'), 'utf8'));
const files = {};
const allowedTokens = Object.keys(policy.allowedTokens);
for (const name of walk(root)) {
  checkRepoPath(name);
  const data = fs.readFileSync(path.join(root, name));
  if (name === 'index.html' || /^assets\/(?:index|pdf|pdf\.worker\.min)-[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)) {
    checkText(data, name, allowedTokens);
    files[name] = { sha256: sha(data), mode: 'text' };
  } else {
    if (policy.pinnedAssets[name]?.sha256 !== sha(data)) throw Error(`Unapproved asset: ${name}`);
    files[name] = { sha256: sha(data), mode: 'pinned-asset' };
  }
}
for (const name of Object.keys(policy.pinnedAssets)) if (!files[name]) throw Error(`Missing pinned asset: ${name}`);
const manifest = { schema: 1, policySha256: sha(fs.readFileSync(path.join(repo, 'packaging/public-policy.json'))), files };
auditStudent(root, manifest, policy);
fs.mkdirSync(path.join(repo, '.cache'), { recursive: true });
fs.writeFileSync(path.join(repo, '.cache/public-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Policy approved ${Object.keys(files).length} student files; .cache/public-manifest.json written.`);

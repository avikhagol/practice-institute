import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditStudent, auditGit, checkRepoPath, checkText, sha } from '../scripts/audit-public.mjs';
const policy = { schema: 1, pinnedAssets: {}, allowedTokens: {} };
for (const name of ['.env', 'nested/.env.production', 'x.sqlite3', 'x.db', 'x.key', 'uploads/paper.pdf', 'fixtures/real/a.pdf', 'release/setup.exe', 'config/tunnel/uuid.json']) {
  test(`reject private path ${name}`, () => assert.throws(() => checkRepoPath(name)));
}
test('example env file is allowed', () => checkRepoPath('backend/.env.example'));
for (const text of ['/api/admin/me', '/admin/', 'dist-admin', 'AccountTag', 'TunnelSecret', '\\u002fapi\\u002fadmin', '\\x2fadmin\\x2f', 'A'.repeat(50)]) {
  test('reject private content without echoing it', () => {
    assert.throws(() => checkText(Buffer.from(text), 'index.html'), e => !e.message.includes(text) && /index.html/.test(e.message));
  });
}
test('only exact reviewed token hashes pass', () => {
  const token = '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE';
  checkText(Buffer.from(token), 'index.html', [sha(token)]);
  assert.throws(() => checkText(Buffer.from(token + 'X'), 'index.html', [sha(token)]));
});
test('manifest rejects extra/missing files, changed bytes, symlinks and forged exemptions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-public-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<html>Student</html>');
  const manifest = { schema: 1, files: { 'index.html': { mode: 'text', sha256: sha(fs.readFileSync(path.join(root, 'index.html'))) } } };
  assert.equal(auditStudent(root, manifest, policy), 1);
  fs.writeFileSync(path.join(root, 'secret.json'), '{}');
  assert.throws(() => auditStudent(root, manifest, policy), /file list/);
  fs.unlinkSync(path.join(root, 'secret.json'));
  fs.writeFileSync(path.join(root, 'index.html'), '/api/admin/me');
  assert.throws(() => auditStudent(root, manifest, policy), /checksum/);
  manifest.files['index.html'].sha256 = sha('/api/admin/me');
  assert.throws(() => auditStudent(root, manifest, policy), /marker/);
  manifest.files['index.html'].mode = 'pinned-asset';
  assert.throws(() => auditStudent(root, manifest, policy), /Unapproved/);
  fs.unlinkSync(path.join(root, 'index.html'));
  fs.symlinkSync('/etc/passwd', path.join(root, 'index.html'));
  assert.throws(() => auditStudent(root, manifest, policy), /Symlink/);
});
test('source audit includes untracked files while staged audit reads index bytes and rejects links', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-source-audit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('rtk', ['proxy', 'git', ...args], { cwd: root, stdio: 'pipe' });
  git(['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'safe.md'), 'Safe staged document');
  git(['add', '--', 'safe.md']);
  fs.writeFileSync(path.join(root, 'safe.md'), 'ghp_' + 'A'.repeat(40));
  assert.equal(auditGit(root, true), 1);
  assert.throws(() => auditGit(root), /Credential content/);
  fs.writeFileSync(path.join(root, 'safe.md'), 'Safe staged document');
  fs.writeFileSync(path.join(root, 'private.sqlite3'), 'synthetic');
  assert.throws(() => auditGit(root), /Private repository path/);
  fs.unlinkSync(path.join(root, 'private.sqlite3'));
  fs.symlinkSync('/etc/passwd', path.join(root, 'link.md'));
  assert.throws(() => auditGit(root), /symlink/);
  git(['add', '--', 'link.md']);
  assert.throws(() => auditGit(root, true), /symlink/);
});

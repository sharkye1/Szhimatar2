import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { publishRelease } from './publish-release.mjs';
import { compareVersions, createManifest, setVersion, validateVersions, verifyManifestSignature } from './release-version.mjs';

function mockGitHub() {
  let release;
  let commit;
  const files = new Map();
  return {
    failUpload: true,
    writes: [],
    api(path, { data } = {}) {
      if (data) this.writes.push(path);
      switch (path) {
        case '/releases?per_page=100': return release ? [release] : [];
        case '/git/ref/tags/v1.5.1': return commit ? { object: { type: 'commit', sha: commit } } : null;
        case '/releases/latest': return null;
        case '/releases/generate-notes': return { body: 'Generated notes' };
        case '/git/refs': commit = data.sha; return;
        case '/releases':
          release = { ...data, id: 123, assets: [], html_url: 'https://github.com/example/repo/releases/tag/v1.5.1' };
          return release;
        case '/releases/123':
          if (data) release = { ...release, ...data };
          return release;
        default: throw new Error(`Unexpected API path in release test: ${path}`);
      }
    },
    upload(_tag, paths) {
      if (this.failUpload) throw new Error('Simulated asset upload failure');
      this.writes.push('upload');
      for (const path of paths) files.set(basename(path), readFileSync(path));
      release.assets = Array.from(files, ([name, contents]) => ({
        name, state: 'uploaded', digest: `sha256:${createHash('sha256').update(contents).digest('hex')}`,
      }));
    },
    download(_tag, name) {
      return files.get(name).toString();
    },
  };
}

const tempRoot = resolve(tmpdir());
const root = mkdtempSync(join(tempRoot, 'szhimatar-release-check-'));
try {
  const names = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'src/version.ts'];
  for (const name of names) {
    mkdirSync(resolve(root, name, '..'), { recursive: true });
    copyFileSync(name, join(root, name));
  }
  const initial = validateVersions(root);
  const parts = initial.split('.').map(Number);
  const next = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  assert.equal(compareVersions('1.10.0', '1.9.99'), 1);
  assert.equal(compareVersions('1.5.1', '1.5.1'), 0);
  assert.throws(() => compareVersions('1.5.1-beta', '1.5.0'));

  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('add', ...names);
  git('-c', 'user.name=Release check', '-c', 'user.email=release-check@localhost', 'commit', '-m', 'fixture');
  const before = git('rev-parse', 'HEAD');
  const output = join(root, 'github-output.txt');
  const detect = (event = 'push') => {
    writeFileSync(output, '');
    execFileSync(process.execPath, [resolve('scripts/release-version.mjs'), 'detect'], {
      cwd: root, env: { ...process.env, GITHUB_EVENT_NAME: event, BEFORE_SHA: before, GITHUB_OUTPUT: output }, stdio: 'pipe',
    });
    return readFileSync(output, 'utf8');
  };
  assert.match(detect(), /release=false/);
  assert.ok(detect().includes(`commit=${before}`));
  assert.equal(setVersion(root, next), next);
  assert.match(detect(), /release=true/);
  assert.match(detect('pull_request'), /release=false/);
  assert.match(detect('workflow_dispatch'), /release=true/);
  assert.throws(() => setVersion(root, initial), /greater/);
  const config = join(root, 'src-tauri/tauri.conf.json');
  writeFileSync(config, readFileSync(config, 'utf8').replace(`"${next}"`, `"${initial}"`));
  assert.throws(() => validateVersions(root), /expected/);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  writeFileSync(join(root, 'src-tauri/update-public-key.hex'), `${publicHex}\n`);
  const manifest = createManifest('1.5.1', 'example/repo', 'Notes', Buffer.from('abc'), privateKey, new Date('2026-01-02T00:00:00Z'));
  assert.equal(manifest.platforms['windows-x86_64'].hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(manifest.platforms['windows-x86_64'].url, 'https://github.com/example/repo/releases/download/v1.5.1/Szhimatar.exe');
  assert.equal(manifest.notes, 'Notes');
  const assets = join(root, 'assets');
  mkdirSync(assets);
  writeFileSync(join(assets, 'Szhimatar.exe'), 'abc');
  writeFileSync(join(assets, 'Szhimatar_1.5.1_x64-setup.exe'), 'installer');
  writeFileSync(join(assets, 'Szhimatar_1.5.1_x64_en-US.msi'), 'msi');
  const notes = join(root, 'notes.txt');
  writeFileSync(notes, 'Release notes');
  const manifestArgs = [resolve('scripts/release-version.mjs'), 'manifest', '1.5.1', 'example/repo', assets, notes];
  const encodedPrivateKey = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  execFileSync(process.execPath, manifestArgs, {
    cwd: root, env: { ...process.env, SZHIMATAR_UPDATE_PRIVATE_KEY: encodedPrivateKey },
  });
  const generated = JSON.parse(readFileSync(join(assets, 'latest.json'), 'utf8'));
  assert.equal(generated.platforms['windows-x86_64'].hash, manifest.platforms['windows-x86_64'].hash);
  assert.equal(generated.notes, 'Release notes');
  assert.ok(verifyManifestSignature(generated, '1.5.1', 'example/repo', publicKey));
  generated.platforms['windows-x86_64'].hash = '00'.repeat(32);
  assert.equal(verifyManifestSignature(generated, '1.5.1', 'example/repo', publicKey), false);
  assert.equal(readFileSync(join(assets, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').length, 3);

  const github = mockGitHub();
  const release = { repository: 'example/repo', version: '1.5.1', commit: before, directory: assets, privateKey: encodedPrivateKey };
  const originalDirectory = process.cwd();
  try {
    process.chdir(root);
    assert.throws(() => publishRelease(github, { ...release, privateKey: undefined }), /Missing SZHIMATAR_UPDATE_PRIVATE_KEY/);
    assert.deepEqual(github.writes, ['/releases/generate-notes']);
    assert.throws(() => publishRelease(github, release), /Simulated asset upload failure/);
    assert.throws(() => publishRelease(github, { ...release, commit: '4'.repeat(40) }), /different commit/);
    github.failUpload = false;
    const url = publishRelease(github, release);
    assert.match(url, /\/tag\/v1\.5\.1$/);
    assert.equal(github.writes.filter(path => path === '/git/refs').length, 1);
    assert.equal(github.writes.filter(path => path === '/releases').length, 1);
    const writesAfterPublication = github.writes.length;
    assert.equal(publishRelease(github, { ...release, privateKey: undefined }), url);
    assert.equal(github.writes.length, writesAfterPublication);
  } finally {
    process.chdir(originalDirectory);
  }
} finally {
  if (!resolve(root).startsWith(tempRoot + sep)) throw new Error('Refusing to remove fixture outside temp directory');
  rmSync(root, { recursive: true, force: true });
}
console.log('Release tooling checks passed');

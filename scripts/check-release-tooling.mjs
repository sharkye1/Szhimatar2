import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { compareVersions, createManifest, setVersion, validateVersions } from './release-version.mjs';

const tempRoot = resolve(tmpdir());
const root = mkdtempSync(join(tempRoot, 'szhimatar-release-check-'));
try {
  const names = ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'src/version.ts'];
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
  const detect = () => {
    writeFileSync(output, '');
    execFileSync(process.execPath, [resolve('scripts/release-version.mjs'), 'detect'], {
      cwd: root, env: { ...process.env, GITHUB_EVENT_NAME: 'push', BEFORE_SHA: before, GITHUB_OUTPUT: output }, stdio: 'pipe',
    });
    return readFileSync(output, 'utf8');
  };
  assert.match(detect(), /release=false/);
  assert.equal(setVersion(root, next), next);
  assert.match(detect(), /release=true/);
  assert.throws(() => setVersion(root, initial), /greater/);
  const config = join(root, 'src-tauri/tauri.conf.json');
  writeFileSync(config, readFileSync(config, 'utf8').replace(`"${next}"`, `"${initial}"`));
  assert.throws(() => validateVersions(root), /expected/);
  const manifest = createManifest('1.5.1', 'example/repo', 'Notes', Buffer.from('abc'), new Date('2026-01-02T00:00:00Z'));
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
  execFileSync(process.execPath, [resolve('scripts/release-version.mjs'), 'manifest', '1.5.1', 'example/repo', assets, notes]);
  const generated = JSON.parse(readFileSync(join(assets, 'latest.json'), 'utf8'));
  assert.equal(generated.platforms['windows-x86_64'].hash, manifest.platforms['windows-x86_64'].hash);
  assert.equal(generated.notes, 'Release notes');
  assert.equal(readFileSync(join(assets, 'SHA256SUMS.txt'), 'utf8').trim().split('\n').length, 3);
} finally {
  if (!resolve(root).startsWith(tempRoot + sep)) throw new Error('Refusing to remove fixture outside temp directory');
  rmSync(root, { recursive: true, force: true });
}
console.log('Release tooling checks passed');

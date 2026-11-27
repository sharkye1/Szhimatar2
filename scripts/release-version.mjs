import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(value) {
  if (!versionPattern.test(value)) throw new Error(`Invalid stable version: ${value}. Use X.Y.Z.`);
  return value.split('.').map(BigInt);
}

export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

const files = {
  package: 'package.json',
  lock: 'package-lock.json',
  tauri: 'src-tauri/tauri.conf.json',
  cargo: 'src-tauri/Cargo.toml',
  frontend: 'src/version.ts',
};
const read = (root, path) => readFileSync(join(root, path), 'utf8');

export function validateVersions(root = '.') {
  const pkg = JSON.parse(read(root, files.package));
  const lock = JSON.parse(read(root, files.lock));
  const tauri = JSON.parse(read(root, files.tauri));
  const cargo = read(root, files.cargo).match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  const frontend = read(root, files.frontend).match(/APP_VERSION\s*=\s*import\.meta\.env\.VITE_APP_VERSION\s*\|\|\s*'([^']+)'/)?.[1];
  const versions = { 'package.json': pkg.version, 'package-lock.json': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'tauri.conf.json': tauri.package?.version, 'Cargo.toml': cargo, 'src/version.ts': frontend };
  parseVersion(pkg.version);
  for (const [file, version] of Object.entries(versions)) {
    if (version !== pkg.version) throw new Error(`${file}: expected ${pkg.version}, found ${version ?? 'no version'}`);
  }
  return pkg.version;
}

function replaceOnce(text, pattern, replace, name) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  if (matches.length !== 1) throw new Error(`${name}: expected one version field, found ${matches.length}`);
  return text.replace(pattern, replace);
}

export function setVersion(root, version) {
  parseVersion(version);
  const current = validateVersions(root);
  if (compareVersions(version, current) <= 0) throw new Error(`New version must be greater than ${current}`);
  const results = new Map();
  const replace = (name, pattern) => {
    const content = read(root, name);
    results.set(name, replaceOnce(content, pattern, (_, prefix) => `${prefix}${version}`, name));
  };
  replace(files.package, /("version"\s*:\s*")\d+\.\d+\.\d+(?=")/);
  const lock = read(root, files.lock);
  const rootField = replaceOnce(lock, /^(\s{4}"version"\s*:\s*")\d+\.\d+\.\d+(?=")/m, (_, prefix) => `${prefix}${version}`, files.lock);
  results.set(files.lock, replaceOnce(rootField, /(""\s*:\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*")\d+\.\d+\.\d+(?=")/, (_, prefix) => `${prefix}${version}`, files.lock));
  replace(files.tauri, /("version"\s*:\s*")\d+\.\d+\.\d+(?=")/);
  replace(files.cargo, /(^\[package\][\s\S]*?^version\s*=\s*")\d+\.\d+\.\d+(?=")/m);
  replace(files.frontend, /(APP_VERSION\s*=\s*import\.meta\.env\.VITE_APP_VERSION\s*\|\|\s*')\d+\.\d+\.\d+(?=')/);
  for (const [name, content] of results) writeFileSync(join(root, name), content);
  return validateVersions(root);
}

export function createManifest(version, repository, notes, executable, date = new Date()) {
  parseVersion(version);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid GitHub repository');
  return {
    version, notes, pub_date: date.toISOString(),
    platforms: { 'windows-x86_64': {
      url: `https://github.com/${repository}/releases/download/v${version}/Szhimatar.exe`,
      hash: createHash('sha256').update(executable).digest('hex'),
    } },
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'check') {
    console.log(`All version files match: ${validateVersions()}`);
  } else if (command === 'set') {
    if (args.length !== 1) throw new Error('Usage: npm run version:set -- 1.5.2');
    console.log(`Updated all version files to ${setVersion('.', args[0])}`);
  } else if (command === 'detect') {
    const version = validateVersions();
    const event = process.env.GITHUB_EVENT_NAME;
    let release = false;
    if (event === 'workflow_dispatch') {
      release = true;
    } else if (event === 'push') {
      const before = process.env.BEFORE_SHA;
      if (!/^[a-f0-9]{40}$/i.test(before || '') || /^0+$/.test(before)) throw new Error('Cannot determine the previous main commit');
      const previous = JSON.parse(execFileSync('git', ['show', `${before}:package.json`], { encoding: 'utf8' })).version;
      const comparison = compareVersions(version, previous);
      if (comparison < 0) throw new Error(`Version decreased from ${previous} to ${version}`);
      release = comparison > 0;
      console.log(`Previous version: ${previous}; current version: ${version}`);
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nrelease=${release}\n`);
  } else if (command === 'manifest') {
    const [version, repository, directory, notesFile] = args;
    const exe = readFileSync(join(directory, 'Szhimatar.exe'));
    const manifest = createManifest(version, repository, readFileSync(notesFile, 'utf8'), exe);
    writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const names = readdirSync(directory).filter(name => /\.(exe|msi)$/i.test(name)).sort();
    if (names.length !== 3) throw new Error(`Expected portable exe, installer exe and MSI, got: ${names.join(', ')}`);
    const checksums = names.map(name => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}`).join('\n');
    writeFileSync(join(directory, 'SHA256SUMS.txt'), `${checksums}\n`);
  } else if (command === 'assert-newer') {
    const [version, latestTag] = args;
    const latest = latestTag.replace(/^v/, '');
    if (compareVersions(version, latest) <= 0) throw new Error(`Version ${version} must be newer than published ${latest}`);
  } else {
    throw new Error('Usage: node scripts/release-version.mjs check|set|detect|manifest|assert-newer');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

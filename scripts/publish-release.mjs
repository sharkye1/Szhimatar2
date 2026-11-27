import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareVersions, parseVersion, publicUpdateKey, releaseBundles, verifyManifestSignature, writeReleaseAssets,
} from './release-version.mjs';

function githubClient(repository) {
  const env = { ...process.env };
  delete env.SZHIMATAR_UPDATE_PRIVATE_KEY;
  const gh = (args, options) => execFileSync('gh', args, { env, encoding: 'utf8', ...options });

  return {
    api(path, { data, missing = false, pages = false, method = data ? 'POST' : 'GET' } = {}) {
      const args = ['api', '--method', method, `repos/${repository}${path}`];
      if (pages) args.push('--paginate', '--slurp');
      if (data) args.push('--input', '-');
      const result = spawnSync('gh', args, { env, encoding: 'utf8', input: data && JSON.stringify(data) });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        if (missing && /\(HTTP 404\)/.test(result.stderr)) return null;
        throw new Error(`GitHub ${method} ${path} failed: ${result.stderr.trim()}`);
      }
      const response = JSON.parse(result.stdout);
      return pages ? response.flat() : response;
    },
    download(tag, name) {
      return gh(['release', 'download', tag, '--repo', repository, '--pattern', name, '--output', '-']);
    },
    upload(tag, paths) {
      gh(['release', 'upload', tag, '--repo', repository, '--clobber', ...paths], { stdio: 'inherit' });
    },
  };
}

function tagCommit(github, tag) {
  let object = github.api(`/git/ref/tags/${tag}`, { missing: true })?.object;
  while (object?.type === 'tag') {
    object = github.api(`/git/tags/${object.sha}`).object;
  }
  if (object && object.type !== 'commit') throw new Error(`Tag ${tag} does not point to a commit`);
  return object?.sha;
}

function uploadedAssets(release, names) {
  return new Map(names.map(name => {
    const asset = release.assets.find(asset => asset.name === name && asset.state === 'uploaded');
    if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
      throw new Error(`Release ${release.tag_name} is missing a verified ${name}`);
    }
    return [name, asset.digest.slice('sha256:'.length)];
  }));
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function publishRelease(github, { repository, version, commit, directory, privateKey }) {
  parseVersion(version);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Expected a full release commit SHA');
  const tag = `v${version}`;
  const bundles = releaseBundles(version).sort();
  const names = [...bundles, 'latest.json', 'SHA256SUMS.txt'];
  const releases = github.api('/releases?per_page=100', { pages: true }).filter(release => release.tag_name === tag);
  if (releases.length > 1) throw new Error(`Ambiguous release for ${tag}`);
  let release = releases[0];
  const existingCommit = tagCommit(github, tag);

  if (existingCommit && existingCommit !== commit) throw new Error(`Tag ${tag} belongs to a different commit`);
  if (release && !release.draft) {
    if (!existingCommit) throw new Error(`Published release ${tag} has no commit tag`);
    const assets = uploadedAssets(release, names);
    const manifest = JSON.parse(github.download(tag, 'latest.json'));
    if (!verifyManifestSignature(manifest, version, repository, publicUpdateKey())
        || manifest.platforms['windows-x86_64'].hash !== assets.get('Szhimatar.exe')) {
      throw new Error(`Published release ${tag} does not contain a valid signed update`);
    }
    const expectedChecksums = bundles.map(name => `${assets.get(name)}  ${name}`).join('\n');
    if (github.download(tag, 'SHA256SUMS.txt').trim() !== expectedChecksums) {
      throw new Error(`Published release ${tag} checksums differ from uploaded artifacts`);
    }
    console.log(`${tag} is already published for ${commit}`);
    return release.html_url;
  }

  if (release && !existingCommit && release.target_commitish !== commit) {
    throw new Error(`Draft release ${tag} belongs to a different commit`);
  }
  const latest = github.api('/releases/latest', { missing: true });
  if (latest && compareVersions(version, latest.tag_name.replace(/^v/, '')) <= 0) {
    throw new Error(`Release ${tag} must be newer than ${latest.tag_name}`);
  }
  const title = `Szhimatar ${version}`;
  const ref = `refs/tags/${tag}`;
  const notes = release?.body ?? github.api('/releases/generate-notes', {
    data: { tag_name: tag, target_commitish: commit },
  }).body;

  writeReleaseAssets(version, repository, directory, notes, privateKey);
  if (!existingCommit) github.api('/git/refs', { data: { ref, sha: commit } });
  if (!release) {
    release = github.api('/releases', {
      data: { tag_name: tag, target_commitish: commit, name: title, body: notes, draft: true },
    });
  }

  const path = `/releases/${release.id}`;
  if (!github.api(path).draft || tagCommit(github, tag) !== commit) {
    throw new Error(`Release ${tag} changed during publication`);
  }
  const paths = names.map(name => join(directory, name));
  github.upload(tag, paths);
  const draft = github.api(path);
  const assets = uploadedAssets(draft, names);
  for (const [name, checksum] of assets) {
    if (digest(join(directory, name)) !== checksum) throw new Error(`Uploaded checksum differs for ${name}`);
  }
  if (!draft.draft || tagCommit(github, tag) !== commit) {
    throw new Error(`Release ${tag} changed during asset upload`);
  }
  const published = github.api(path, { method: 'PATCH', data: { draft: false, make_latest: 'true' } });
  if (published.draft) throw new Error(`Release ${tag} is still a draft`);
  console.log(`Published ${tag} for ${commit}`);
  return published.html_url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [version, commit, directory] = process.argv.slice(2);
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw new Error('Invalid GITHUB_REPOSITORY');
    const url = publishRelease(githubClient(repository), {
      repository, version, commit, directory, privateKey: process.env.SZHIMATAR_UPDATE_PRIVATE_KEY,
    });
    console.log(url);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

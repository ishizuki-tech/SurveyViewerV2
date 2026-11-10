import { createHash, randomUUID } from 'node:crypto';
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const marker = 'survey-release.txt';
const digest = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

export async function releaseFingerprint(directory: string): Promise<string> {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => relative(directory, join(entry.parentPath, entry.name)))
    .filter(path => path !== marker)
    .sort();

  if (!files.includes('survey-index.json')) throw new Error('The build is missing survey-index.json.');
  const fingerprints = await Promise.all(files.map(async path => {
    const bytes = await readFile(join(directory, path));
    if (path !== 'survey-index.json') return [path, digest(bytes)];

    // The generation clock changes on every run. The pinned revisions and all other index data
    // still count, so a commit that adds only WAV files produces a different release.
    const { generatedAt, ...snapshot } = JSON.parse(bytes.toString('utf8'));
    return [path, digest(JSON.stringify(snapshot))];
  }));
  return digest(JSON.stringify(fingerprints));
}

export async function needsDeployment(baseUrl: string, fingerprint: string, request = fetch): Promise<boolean> {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${marker}`;
  url.searchParams.set('check', randomUUID());
  const response = await request(url, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return true;
  if (!response.ok) throw new Error(`Could not verify the published release (HTTP ${response.status}).`);
  const published = (await response.text()).trim();
  if (!/^[a-f0-9]{64}$/.test(published)) throw new Error('Invalid fingerprint on the published site.');
  return published !== fingerprint;
}

if (import.meta.main) {
  const { PAGES_BASE_URL, GITHUB_OUTPUT } = process.env;
  if (!PAGES_BASE_URL || !GITHUB_OUTPUT) throw new Error('PAGES_BASE_URL and GITHUB_OUTPUT are required.');
  const directory = resolve('dist');
  const fingerprint = await releaseFingerprint(directory);
  const changed = await needsDeployment(PAGES_BASE_URL, fingerprint);
  if (changed) await writeFile(join(directory, marker), fingerprint + '\n');
  await appendFile(GITHUB_OUTPUT, `changed=${changed}\n`);
  console.log(changed ? 'A new release is ready to publish.' : 'The published release already matches this build.');
}

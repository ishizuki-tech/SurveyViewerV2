import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildIndex } from '../scripts/github-index.ts';
import { needsDeployment, releaseFingerprint } from '../scripts/pages-refresh.ts';
import { rawUrl } from '../src/paths.ts';
import { exportFor, revision, route, wav } from './fixtures.ts';

const laterRevision = '2'.repeat(40);
const voice = `${route.date}/voice/${wav('Q7', 0)}`;
const snapshots = new Map([
  [revision, [route.path]],
  [laterRevision, [route.path, voice]],
]);

test('a WAV-only commit refreshes the published index while timestamp-only rebuilds skip deployment', async t => {
  let head = revision;
  const request: typeof fetch = async input => {
    const url = new URL(String(input));
    const production = !url.pathname.includes('SurveyExports-Dev');
    const sha = production ? head : revision;
    if (url.pathname.endsWith('/branches/main')) {
      return Response.json({ commit: { sha, commit: { tree: { sha } } } });
    }
    if (url.hostname === 'api.github.com') {
      assert.equal(url.pathname.split('/').at(-1), sha);
      const paths = production ? snapshots.get(sha)! : [];
      return Response.json({ truncated: false, tree: paths.map(path => ({ path, type: 'blob', mode: '100644' })) });
    }
    assert.equal(url.href, rawUrl('production', sha, route.path));
    return Response.json(exportFor());
  };

  const directory = await mkdtemp(join(tmpdir(), 'survey-refresh-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  const appFile = join(directory, 'assets', 'app.js');
  await writeFile(appFile, 'application-v1');
  const writeIndex = (value: Awaited<ReturnType<typeof buildIndex>>) =>
    writeFile(join(directory, 'survey-index.json'), JSON.stringify(value));

  const first = await buildIndex(request);
  await writeIndex(first);
  const published = await releaseFingerprint(directory);
  const baseUrl = 'https://example.test/SurveyViewerV2';
  const compare = (candidate: string) => needsDeployment(baseUrl, candidate, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/SurveyViewerV2/survey-release.txt');
    assert.ok(url.searchParams.has('check'));
    assert.equal(new Headers(init?.headers).get('Cache-Control'), 'no-cache');
    return new Response(published + '\n');
  });

  await writeFile(join(directory, 'survey-release.txt'), published + '\n');
  await writeIndex({ ...first, generatedAt: '2026-11-08T10:15:00Z' });
  assert.equal(await compare(await releaseFingerprint(directory)), false);
  await writeFile(appFile, 'application-v2');
  assert.equal(await compare(await releaseFingerprint(directory)), true);
  await writeFile(appFile, 'application-v1');

  head = laterRevision;
  const refreshed = await buildIndex(request);
  assert.deepEqual(refreshed.sources.production.surveys, first.sources.production.surveys);
  assert.deepEqual(refreshed.sources.development, first.sources.development);
  assert.equal(refreshed.sources.production.revision, laterRevision);
  assert.doesNotMatch(JSON.stringify(refreshed), /\.wav|transcript|Captured synthetic prompt|More buses/);
  await writeIndex(refreshed);
  assert.equal(await compare(await releaseFingerprint(directory)), true);
});

test('a missing marker bootstraps deployment and an unexpected lookup failure stops it', async () => {
  const url = 'https://example.test/';
  const candidate = 'a'.repeat(64);
  assert.equal(await needsDeployment(url, candidate, async () => new Response(null, { status: 404 })), true);
  await assert.rejects(needsDeployment(url, candidate, async () => new Response(null, { status: 503 })), /HTTP 503/);
  await assert.rejects(needsDeployment(url, candidate, async () => new Response('<html>')), /Invalid fingerprint/);
});

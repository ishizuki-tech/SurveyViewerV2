import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIndex } from '../scripts/github-index.ts';
import { readCatalog } from '../src/catalog.ts';
import { dev, exportFor, revision, route, second } from './fixtures.ts';

const root = '2'.repeat(40);
const day = '3'.repeat(40);
const folder = '4'.repeat(40);
const secret = 'fixture-token';
const blob = (path: string, mode = '100644') => ({ path, type: 'blob', mode });
const tree = (path: string, sha: string) => ({ path, type: 'tree', sha });

function githubFixture(fail = false) {
  const rawRequests: string[] = [];
  const apiRequests: string[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get('Authorization');
    assert.equal(init?.redirect, 'error');
    const devSource = url.pathname.includes('SurveyExports-Dev');
    if (url.hostname === 'api.github.com') {
      assert.equal(auth, secret ? `Bearer ${secret}` : null);
      apiRequests.push(url.href);
      if (url.pathname.endsWith('/branches/main')) {
        return Response.json({ commit: { sha: revision, commit: { tree: { sha: root } } } });
      }
      if (url.search === '?recursive=1') {
        return Response.json(devSource ? { tree: [], truncated: true } : {
          tree: [blob(route.path), blob(second.path), blob(dev.path, '120000'),
            blob('exports/surveys/legacy.json'), blob(route.path.replace('/survey/', '/diagnostics/'))],
          truncated: false,
        });
      }
      const hash = url.pathname.split('/').at(-1);
      if (hash === root) return Response.json({ tree: [tree(dev.date, day), tree('exports', day)], truncated: false });
      if (hash === day) return Response.json({ tree: [tree('survey', folder), tree('voice', day)], truncated: false });
      if (hash === folder) return Response.json({ tree: [blob(dev.path.split('/').at(-1)!)], truncated: false });
    }
    if (url.hostname === 'raw.githubusercontent.com') {
      assert.equal(auth, null);
      assert.ok(url.pathname.includes(`/${revision}/`));
      rawRequests.push(url.href);
      const selected = devSource ? dev : url.pathname.endsWith(second.path) ? second : route;
      if (fail && selected === second) return new Response(null, { status: 503 });
      return Response.json(exportFor(selected, selected === route ? 'completed' : 'incomplete'));
    }
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  return { request, rawRequests, apiRequests };
}

test('independently builds both pinned catalogs, walking only survey folders if the Git tree is truncated', async () => {
  const { request, rawRequests, apiRequests } = githubFixture();
  const index = await buildIndex(request, secret);
  assert.equal(index.sources.production.revision, revision);
  assert.deepEqual(index.sources.production.surveys.map(x => x.path), [second.path, route.path]);
  assert.deepEqual(index.sources.development.surveys.map(x => x.path), [dev.path]);
  assert.equal(rawRequests.length, 3);
  assert.equal(apiRequests.length, 7);
  assert.equal(readCatalog(index).sources.production.surveys[1].status, 'completed');
});

test('serialized index emits only the explicit metadata allowlist', async () => {
  const { request } = githubFixture();
  const output = await buildIndex(request, secret);
  for (const source of Object.values(output.sources)) {
    assert.deepEqual(Object.keys(source).sort(), ['revision', 'surveys']);
    for (const summary of source.surveys) {
      assert.deepEqual(Object.keys(summary).sort(), ['answerCount', 'audioCount', 'exportedAt', 'followupCount', 'path', 'status']);
    }
  }
  const json = JSON.stringify(output);
  assert.doesNotMatch(json, /buses|transcript|private-meta|synthetic-build|Captured synthetic prompt|How often/);
});

test('fails generation when an indexed survey fetch fails', async () => {
  const { request } = githubFixture(true);
  await assert.rejects(buildIndex(request, secret), /HTTP 503/);
});

test('derives V2 counts without duplicating mirrors and distinguishes empty from unknown', async () => {
  const { request } = githubFixture();
  const data = exportFor();
  Object.assign(data.answers, { unanswered: { question: 'Blank answer', answer: '  ' } });
  data.answers.Q7.audio.push({ file: 'https://example.test/unsafe.wav' });
  const custom: typeof fetch = async (input, init) => {
    if (String(input).endsWith(route.path)) return Response.json(data);
    return request(input, init);
  };
  const summary = async () => {
    const index = await buildIndex(custom, secret).then(readCatalog);
    return index.sources.production.surveys.find(item => item.path === route.path)!;
  };
  const first = await summary();
  assert.equal(first.answerCount, 2);
  assert.equal(first.followupCount, 2);
  assert.equal(first.audioCount, 5);
  Object.assign(data, { answers: {}, followups: {}, voice_files: [] });
  const empty = await summary();
  assert.equal(empty.answerCount, 0);
  assert.equal(empty.followupCount, 0);
  assert.equal(empty.audioCount, 0);
  Object.assign(data, { answers: undefined, followups: { Q7: 'malformed' }, voice_files: undefined });
  const unknown = await summary();
  assert.equal(unknown.answerCount, undefined);
  assert.equal(unknown.followupCount, undefined);
  assert.equal(unknown.audioCount, undefined);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIndex, githubJson } from '../scripts/github-index.ts';
import { readCatalog } from '../src/catalog.ts';
import { readSurvey } from '../src/contract.ts';
import { environments, rawUrl } from '../src/paths.ts';

const catalog = await buildIndex(fetch, process.env.SURVEY_GITHUB_TOKEN || process.env.GITHUB_TOKEN).then(readCatalog);

for (const environment of environments) {
  test(`${environment}: pinned GitHub survey JSON and referenced RIFF/WAVE files`, async t => {
    const source = catalog.sources[environment];
    assert.ok(source.surveys.length, 'Expected live V2 survey records');
    const statuses = new Set<string>();
    const paths = new Set<string>();
    let modern = 0;
    for (const summary of source.surveys) {
      const data = await githubJson(rawUrl(environment, source.revision, summary.path), fetch);
      const survey = await readSurvey(data, summary);
      assert.equal(survey.status, summary.status);
      statuses.add(survey.status);
      for (const question of survey.questions) {
        for (const recording of question.recordings) {
          assert.ok(recording.path, 'Live WAV reference failed validation');
          assert.ok(recording.id, 'Live WAV had no recording identity');
          paths.add(recording.path);
          if (recording.status) modern++;
        }
      }
    }
    assert.ok(statuses.has('completed') && statuses.has('incomplete'), 'Expected both completion states');
    assert.ok(paths.size, 'Expected live V2 WAVs');
    for (const path of paths) {
      const response = await fetch(rawUrl(environment, source.revision, path), {
        headers: { Range: 'bytes=0-11', Origin: 'https://ishizuki-tech.github.io' },
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
      });
      assert.ok(response.ok, `Live WAV returned HTTP ${response.status}`);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
      const reader = response.body!.getReader();
      const prefix = new Uint8Array(12);
      let offset = 0;
      try {
        while (offset < prefix.length) {
          const { value, done } = await reader.read();
          if (done) break;
          const length = Math.min(value.length, prefix.length - offset);
          prefix.set(value.subarray(0, length), offset);
          offset += length;
        }
      } finally {
        await reader.cancel();
      }
      const signature = new TextDecoder().decode(prefix);
      assert.equal(signature.slice(0, 4), 'RIFF');
      assert.equal(signature.slice(8, 12), 'WAVE');
    }
    t.diagnostic(`${source.revision} · ${source.surveys.length} JSON · ${paths.size} WAV · ${modern} with transcription status`);
  });
}

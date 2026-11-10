import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { filterSurveys, readCatalog } from '../src/catalog.ts';
import { exportTimestamp, readSurvey } from '../src/contract.ts';
import { rawUrl, surveyPath, voicePath } from '../src/paths.ts';
import { dev, exportFor, index, note, recordingIds, revision, route, second, wav } from './fixtures.ts';

test('discovers only matching V2 survey filenames, including underscore-rich device names', () => {
  assert.equal(surveyPath(route.path)?.device, 'SYNTHETIC_Test-Device');
  assert.equal(surveyPath(route.path)?.startedAt, '2026-11-08T08:00:00.000Z');
  for (const path of [
    `exports/surveys/${route.id}.json`,
    route.path.replace('/survey/', '/survey/nested/'),
    route.path.replace('_08-00-00Z', '_08-00-01Z'),
    route.path.replace('/survey/', '/voice/'),
    route.path.replace('-7000-', '-4000-'),
    route.path.replace('Test-Device', 'Test..Device'),
    route.path.replace('Test-Device', 'X'.repeat(255)),
    route.path + '\r\n',
  ]) assert.equal(surveyPath(path), null, path);
});

test('resolves a WAV only in the correct date, device, survey and question with the recording ID', async () => {
  const file = wav('Q7', 0);
  const location = await voicePath(route, file, 'Q7', recordingIds[0]);
  assert.deepEqual(location, { path: `${route.date}/voice/${file}`, id: recordingIds[0] });
  assert.equal(new URL(rawUrl('development', revision, location!.path)).hostname, 'raw.githubusercontent.com');
  assert.match(rawUrl('development', revision, location!.path), /\/SurveyExports-Dev\//);
  assert.equal(await voicePath(route, file, 'Q8', recordingIds[0]), null);
  assert.equal(await voicePath(route, file, 'Q7', recordingIds[1]), null);
  assert.equal(await voicePath(second, file, 'Q7', recordingIds[0]), null);
  assert.equal(await voicePath(route, file.replace(route.device, 'AnotherDevice'), 'Q7'), null);
  for (const bad of [`https://example.com/${file}`, `../${file}`, `%2f${file}`, `\\${file}`, `${file}?a=b`,
    `${file}#fragment`, `${file}\n`]) {
    assert.equal(await voicePath(route, bad, 'Q7'), null, bad);
  }
  assert.throws(() => rawUrl('production', 'main', route.path), /Invalid/);
  assert.throws(() => rawUrl('production', revision, 'a/../b'), /Invalid/);
});

test('verifies the exporter hash for non-filename or oversized question IDs', async () => {
  for (const question of ['A/B 例', 'X'.repeat(300), '..']) {
    const segment = 'q-' + createHash('sha256').update(question).digest('hex').slice(0, 24);
    assert.equal((await voicePath(route, wav(segment, 0), question))?.id, recordingIds[0]);
    assert.equal(await voicePath(route, wav(segment, 0), question + 'x'), null);
  }
});

test('preserves response text, AI outcomes, follow-up positions, all retakes and raw per-recording results', async () => {
  const survey = await readSurvey(exportFor(), route);
  assert.equal(survey.status, 'completed');
  assert.equal(survey.exportedAt, '2026-11-08T08:12:04.123Z');
  const [question, surveyNote, outcomeOnly] = survey.questions;
  assert.match(question.answer, /<img.*>\nMore buses\./);
  assert.equal(question.outcome, 'accepted');
  assert.equal(question.followups[0].answer, 'Every day.');
  assert.equal(question.followups[1].answer, '');
  assert.deepEqual(question.recordings.map(r => r.id), recordingIds.slice(0, 4));
  assert.deepEqual(question.recordings.map(r => r.position), [undefined, undefined, 1, 3]);
  assert.deepEqual(question.recordings.map(r => r.status), ['success', 'empty', 'failed', 'interrupted']);
  assert.equal(question.recordings[0].transcript, ' raw original \n');
  assert.equal(question.recordings[1].transcript, undefined);
  assert.ok(question.recordings.every(recording => recording.path));
  assert.equal(surveyNote.id, note);
  assert.equal(surveyNote.recordings[0].kind, 'survey_note');
  assert.equal(outcomeOnly.outcome, 'skipped');
});

test('early V2 recording exposes only its file identity and does not use historical answer as transcript', async () => {
  const data = { ...exportFor(), voice_files: [
    { file: wav('Q7', 0), survey_id: route.id, question_id: 'Q7', question: 'Prompt', answer: 'Survey answer' },
  ] };
  const survey = await readSurvey(data, route);
  const [first, mirroredOnly] = survey.questions[0].recordings;
  assert.equal(first.id, recordingIds[0]);
  assert.ok(first.path);
  assert.equal(first.kind, undefined);
  assert.equal(first.transcript, undefined);
  assert.equal(first.status, undefined);
  assert.equal(mirroredOnly.id, recordingIds[1]);
});

test('rejects wrong export identities and only permits valid recording paths', async () => {
  await assert.rejects(readSurvey(exportFor(second), route), /does not match/);
  await assert.rejects(readSurvey({ ...exportFor(), status: 'other' }, route), /does not match/);
  const data = exportFor();
  data.voice_files[0].file = 'https://example.com/test.wav';
  const survey = await readSurvey(data, route);
  assert.equal(survey.questions[0].recordings[0].path, undefined);
  assert.equal(exportTimestamp('2026-02-30T08:00:00Z'), undefined);
  assert.equal(exportTimestamp('2026-11-08T24:00:00Z'), undefined);
});

test('validates index input and filters by ID, device, date and completion with stable sorting', () => {
  const catalog = readCatalog(index);
  const { surveys } = catalog.sources.production;
  assert.deepEqual(filterSurveys(surveys, '', '', 'newest').map(x => x.id), [second.id, route.id]);
  assert.deepEqual(filterSurveys(surveys, 'test-device 2026-11-08', '', 'oldest').map(x => x.id), [route.id, second.id]);
  assert.deepEqual(filterSurveys(surveys, route.id.toUpperCase(), 'completed', 'newest').map(x => x.id), [route.id]);
  assert.deepEqual(filterSurveys(surveys, '', 'incomplete', 'newest').map(x => x.id), [second.id]);
  assert.equal(filterSurveys(surveys, 'buses', '', 'newest').length, 0);
  assert.equal(catalog.sources.development.surveys[0].id, dev.id);
  assert.throws(() => readCatalog({ ...index, version: 2 }), /Invalid/);
  const invalid = structuredClone(index);
  invalid.sources.production.surveys.push({ path: 'https://example.com/a.json', status: 'completed' });
  assert.throws(() => readCatalog(invalid), /Invalid/);
});

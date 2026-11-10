import { expect, test } from '@playwright/test';
import { dev, exportFor, index, recordingIds, revision, route, second } from '../fixtures.ts';

const jsonHeaders = { 'access-control-allow-origin': '*' };

function syntheticWav() {
  const sampleRate = 8000;
  const pcmBytes = sampleRate * 2 * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBytes, 40);
  return wav;
}

test.beforeEach(async ({ page }) => {
  await page.route('**/SurveyViewerV2/survey-index.json', request => request.fulfill({ json: index }));
  await page.route('https://raw.githubusercontent.com/**', async request => {
    const url = new URL(request.request().url());
    if (url.pathname.endsWith('.wav')) {
      expect(url.pathname).toContain(`/SurveyExports/${revision}/${route.date}/voice/`);
      return request.fulfill({ body: syntheticWav(), contentType: 'audio/wav' });
    }
    const isDev = url.pathname.includes('/SurveyExports-Dev/');
    const selected = isDev ? dev : url.pathname.endsWith(second.path) ? second : route;
    expect(url.pathname).toBe(`/ishizuki-tech/${isDev ? 'SurveyExports-Dev' : 'SurveyExports'}/${revision}/${selected.path}`);
    const data = exportFor(selected, selected === route ? 'completed' : 'incomplete');
    if (selected !== route) {
      data.voice_files = [];
      data.answers.Q7.audio = [];
    }
    return request.fulfill({ json: data, headers: jsonHeaders });
  });
});

test('filters records, opens a response, plays a take, inspects raw JSON and switches sources', async ({ page }) => {
  await page.goto('./');
  const rows = page.locator('.survey-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(second.id);
  await page.getByLabel('Sort by').selectOption('oldest');
  await expect(rows.first()).toContainText(route.id);
  await page.getByLabel('Completion').selectOption('completed');
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Search records').fill('missing');
  await expect(page.getByText('No surveys match these filters.')).toBeVisible();
  await page.getByLabel('Search records').fill('synthetic 2026-11-08');
  await rows.first().click();
  await expect(page.getByRole('heading', { name: 'Survey record' })).toBeVisible();
  await expect(page.getByText('AI outcome: accepted')).toBeVisible();
  await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByText('Every day.')).toBeVisible();
  await expect(page.getByText('Recordings with no matching follow-up in this export.')).toBeVisible();
  await expect(page.getByText('Transcription: interrupted')).toBeVisible();
  await expect(page.getByText('Raw transcript').first()).toBeVisible();
  await expect(page.locator('audio')).toHaveCount(5);
  const player = page.locator(`audio[aria-label="Recording ${recordingIds[0]}"]`);
  await player.evaluate(async audio => {
    (audio as HTMLAudioElement).muted = true;
    await (audio as HTMLAudioElement).play();
  });
  await expect.poll(() => player.evaluate(audio => (audio as HTMLAudioElement).duration)).toBe(2);
  await page.getByRole('button', { name: 'Raw JSON' }).click();
  await expect(page.getByLabel('Raw survey JSON')).toContainText('fixture-private-meta');
  await expect(player).toBeHidden();
  await expect.poll(() => player.evaluate(audio => (audio as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Responses' }).click();
  await expect(page.getByLabel('Raw survey JSON')).toBeHidden();
  await page.getByLabel('Export source').selectOption('development');
  await expect(page.getByRole('heading', { name: 'Select a survey' })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(page.locator('.detail-header')).toContainText(dev.id);
  await expect(page.locator('.detail-header')).toContainText('Incomplete');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('recovers from a missing index and a failed survey fetch', async ({ page }) => {
  await page.route('**/SurveyViewerV2/survey-index.json', request => request.fulfill({ status: 503 }), { times: 1 });
  await page.route(`https://raw.githubusercontent.com/**/${second.path}`,
    request => request.fulfill({ status: 503, headers: jsonHeaders }), { times: 1 });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('Could not load the export index');
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.locator('.survey-row').first().click();
  await expect(page.getByRole('alert')).toContainText('Could not load this survey');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.detail-header')).toContainText(second.id);
});

test('plays a late WAV after the published index moves to the commit that contains it', async ({ page }) => {
  const laterRevision = '2'.repeat(40);
  let publishedRevision = revision;
  await page.route('**/SurveyViewerV2/survey-index.json', request => request.fulfill({
    json: {
      ...index,
      sources: {
        ...index.sources,
        production: { ...index.sources.production, revision: publishedRevision },
      },
    },
  }));
  const data = exportFor();
  const recording = data.voice_files[0];
  const filename = recording.file;
  data.voice_files = [recording];
  data.answers.Q7.audio = [{ file: filename }];
  const wavRevisions: string[] = [];
  await page.route('https://raw.githubusercontent.com/**', async request => {
    const url = new URL(request.request().url());
    const sha = url.pathname.split('/')[3];
    expect([revision, laterRevision]).toContain(sha);
    const base = `/ishizuki-tech/SurveyExports/${sha}/`;
    if (url.pathname === base + route.path) return request.fulfill({ json: data, headers: jsonHeaders });
    expect(url.pathname).toBe(base + `${route.date}/voice/${filename}`);
    wavRevisions.push(sha);
    return sha === revision
      ? request.fulfill({ status: 404 })
      : request.fulfill({ body: syntheticWav(), contentType: 'audio/wav' });
  });

  async function openRecording() {
    await page.getByRole('button', { name: new RegExp(route.id) }).click();
    const player = page.locator(`audio[aria-label="Recording ${recording.recording_id}"]`);
    await expect(player).toBeVisible();
    return player;
  }

  await page.goto('./');
  const initial = await openRecording();
  // The JSON can reference a file that is still queued for upload.
  await initial.evaluate(async audio => {
    const player = audio as HTMLAudioElement;
    player.muted = true;
    await player.play().catch(() => {});
  });
  await expect(page.getByText('Audio unavailable at this export revision.')).toBeVisible();
  expect(wavRevisions).toContain(revision);
  expect(wavRevisions).not.toContain(laterRevision);

  publishedRevision = laterRevision;
  await page.reload();
  const refreshed = await openRecording();
  await refreshed.evaluate(async audio => {
    const player = audio as HTMLAudioElement;
    player.muted = true;
    await player.play();
  });
  await expect.poll(() => refreshed.evaluate(audio => (audio as HTMLAudioElement).duration)).toBe(2);
  expect(wavRevisions).toContain(laterRevision);
  await expect(page.getByText('Transcription: success')).toBeVisible();
});

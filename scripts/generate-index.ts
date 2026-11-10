import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildIndex } from './github-index.ts';

const directory = new URL('../public/', import.meta.url);
const temporary = new URL(`.survey-index-${randomUUID()}.tmp`, directory);
try {
  const index = await buildIndex(fetch, process.env.SURVEY_GITHUB_TOKEN || process.env.GITHUB_TOKEN);
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, JSON.stringify(index, null, 2) + '\n', { flag: 'wx' });
  await rename(temporary, new URL('survey-index.json', directory));
  for (const [env, source] of Object.entries(index.sources)) {
    console.log(`${env}: ${source.surveys.length} V2 surveys at ${source.revision}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Survey index generation failed.');
  process.exitCode = 1;
} finally {
  await rm(temporary, { force: true });
}

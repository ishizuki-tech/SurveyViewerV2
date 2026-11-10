import { surveyPath } from '../src/paths.ts';
import type { Status } from '../src/contract.ts';

export const revision = '1'.repeat(40);
export const device = 'SYNTHETIC_Test-Device';
export const note = '__home_free_text__';

export function routeAt(seconds: number) {
  const time = new Date(Date.UTC(2026, 10, 8, 8, 0, seconds));
  const ms = time.valueOf().toString(16).padStart(12, '0');
  const id = `${ms.slice(0, 8)}-${ms.slice(8)}-7000-8000-000000000000`;
  const stamp = time.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-') + 'Z';
  return surveyPath(`2026-11-08/survey/${stamp}_survey_${device}_${id}.json`)!;
}

export const route = routeAt(0);
export const second = routeAt(1);
export const dev = routeAt(2);
export const recordingIds = [1, 2, 3, 4, 5, 6].map(n =>
  `00000000-0000-4000-8000-00000000000${n}`,
);

export function wav(question: string, index: number) {
  return `${route.stamp}_voice_${route.device}_${route.id}_${question}_${recordingIds[index]}.wav`;
}

export function exportFor(survey = route, status: Status = 'completed') {
  return {
    survey_id: survey.id,
    status,
    exported_at: '2026-11-08T08:12:04.123456Z',
    build: 'synthetic-build',
    meta: { sensitive: 'fixture-private-meta' },
    answers: {
      Q7: {
        question: 'What would improve access?',
        answer: '<img src=x onerror=alert(1)>\nMore buses.',
        audio: [0, 1, 2, 3].map(index => ({ file: wav('Q7', index) })),
      },
      [note]: { question: 'Survey Note', answer: 'Synthetic note.' },
    },
    ai_outcomes: { Q7: 'accepted', Q8: 'skipped' },
    followups: { Q7: [
      { question: 'How often?', answer: 'Every day.' },
      { question: 'Which route?', answer: '' },
    ] },
    voice_files: [
      { question_id: 'Q7', prompt_kind: 'original', transcription_status: 'success', transcript: ' raw original \n' },
      { question_id: 'Q7', prompt_kind: 'original', transcription_status: 'empty' },
      { question_id: 'Q7', prompt_kind: 'followup', followup_position: 1, transcription_status: 'failed' },
      { question_id: 'Q7', prompt_kind: 'followup', followup_position: 3, transcription_status: 'interrupted' },
      { question_id: note, prompt_kind: 'survey_note', transcription_status: 'success', transcript: 'note transcript' },
    ].map((entry, index) => ({
      survey_id: survey.id,
      recording_id: recordingIds[index],
      file: wav(entry.question_id, index),
      prompt_text: 'Captured synthetic prompt',
      ...entry,
    })),
  };
}

export const index = {
  version: 1,
  generatedAt: '2026-11-08T09:00:00Z',
  sources: {
    production: { revision, surveys: [
      { path: route.path, status: 'completed' }, { path: second.path, status: 'incomplete' },
    ] },
    development: { revision, surveys: [{ path: dev.path, status: 'incomplete' }] },
  },
};

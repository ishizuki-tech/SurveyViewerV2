import { voicePath } from './paths.ts';
import type { SurveyPath } from './paths.ts';

export type Status = 'completed' | 'incomplete';
type PromptKind = 'original' | 'followup' | 'survey_note';
type TranscriptionStatus = 'success' | 'empty' | 'failed' | 'interrupted';

export const noteId = '__home_free_text__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function entries(value: unknown) {
  return new Map(Object.entries(record(value)));
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function surveyStatus(value: unknown): Status | undefined {
  return value === 'completed' || value === 'incomplete' ? value : undefined;
}

export function exportTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    return undefined;
  }
  const time = new Date(value);
  if (!Number.isFinite(time.valueOf()) || time.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    return undefined;
  }
  return time.toISOString();
}

export function readHeader(value: unknown, survey: SurveyPath) {
  const data = record(value);
  const status = surveyStatus(data.status);
  if (string(data.survey_id).toLowerCase() !== survey.id || !status) {
    throw new Error('Export ID or completion status does not match the V2 contract.');
  }
  return { status, exportedAt: exportTimestamp(data.exported_at) };
}

export interface Recording {
  file: string;
  id?: string;
  path?: string;
  kind?: PromptKind;
  prompt?: string;
  position?: number;
  status?: TranscriptionStatus;
  transcript?: string;
}

async function readRecording(value: unknown, survey: SurveyPath, questionId: string): Promise<Recording> {
  const data = record(value);
  const file = string(data.file);
  const id = string(data.recording_id);
  const location = await voicePath(survey, file, questionId, id || undefined);
  const kind = data.prompt_kind;
  const position = data.followup_position;
  const status = data.transcription_status;
  const validKind = (kind === 'followup' && Number.isSafeInteger(position) && Number(position) > 0 && questionId !== noteId)
    || (kind === 'original' && questionId !== noteId && position == null)
    || (kind === 'survey_note' && questionId === noteId && position == null);
  return {
    file,
    id: id || location?.id,
    path: location?.path,
    kind: validKind ? kind : undefined,
    prompt: string(data.prompt_text) || undefined,
    position: validKind && kind === 'followup' ? Number(position) : undefined,
    status: status === 'success' || status === 'empty' || status === 'failed' || status === 'interrupted'
      ? status : undefined,
    transcript: typeof data.transcript === 'string' ? data.transcript : undefined,
  };
}

function readAnswer(value: unknown) {
  const answer = record(value);
  return { question: string(answer.question), answer: string(answer.answer) };
}

export async function readSurvey(value: unknown, survey: SurveyPath) {
  const header = readHeader(value, survey);
  const data = record(value);
  const answers = entries(data.answers);
  const followups = entries(data.followups);
  const outcomes = entries(data.ai_outcomes);
  const recordings = new Map<string, Recording[]>();
  const files = new Set<string>();

  async function add(questionId: string, value: unknown) {
    const recording = await readRecording(value, survey, questionId);
    if (!recording.file || files.has(recording.file)) return;
    files.add(recording.file);
    const group = recordings.get(questionId) ?? [];
    group.push(recording);
    recordings.set(questionId, group);
  }

  // The top-level inventory carries recording identity and wins over mirrored answer.audio references.
  if (Array.isArray(data.voice_files)) {
    for (const value of data.voice_files) {
      const item = record(value);
      if (string(item.survey_id).toLowerCase() === survey.id) {
        await add(string(item.question_id), item);
      }
    }
  }
  for (const [questionId, value] of answers) {
    const { audio } = record(value);
    if (Array.isArray(audio)) {
      for (const ref of audio) await add(questionId, { file: record(ref).file });
    }
  }

  const ids = new Set([...answers.keys(), ...followups.keys(), ...outcomes.keys(), ...recordings.keys()]);
  const questions = Array.from(ids, id => {
    const history = followups.get(id);
    return {
      id,
      ...readAnswer(answers.get(id)),
      outcome: string(outcomes.get(id)),
      followups: Array.isArray(history) ? history.map(readAnswer) : [],
      recordings: recordings.get(id) ?? [],
    };
  });
  return { ...header, build: string(data.build), questions };
}

export type Survey = Awaited<ReturnType<typeof readSurvey>>;

export const metricKeys = ['answerCount', 'followupCount', 'audioCount'] as const;
export type Metric = typeof metricKeys[number];
export type SurveyMetrics = Partial<Record<Metric, number>>;

export async function readSurveyMetadata(value: unknown, route: SurveyPath) {
  const { status, exportedAt, questions } = await readSurvey(value, route);
  const data = record(value);
  const answers = Object.values(record(data.answers));
  const history = Object.values(record(data.followups));
  const hasFile = (item: unknown) => typeof record(item).file === 'string';
  const answerCount = isRecord(data.answers) && answers.every(item => typeof record(item).answer === 'string')
    ? questions.filter(question => question.answer.trim()).length : undefined;
  const followupCount = isRecord(data.followups) && history.every(items =>
    Array.isArray(items) && items.every(item => typeof record(item).question === 'string' &&
      typeof record(item).answer === 'string'))
    ? questions.reduce((sum, question) => sum + question.followups.length, 0) : undefined;
  const audioCount = Array.isArray(data.voice_files) && data.voice_files.every(item =>
    hasFile(item) && typeof record(item).survey_id === 'string' && typeof record(item).question_id === 'string') &&
    isRecord(data.answers) && answers.every(item => {
      const { audio } = record(item);
      return isRecord(item) && (audio === undefined || (Array.isArray(audio) && audio.every(hasFile)));
    })
    ? questions.reduce((sum, question) => sum + question.recordings.filter(recording => recording.path).length, 0)
    : undefined;
  return { status, exportedAt, answerCount, followupCount, audioCount };
}

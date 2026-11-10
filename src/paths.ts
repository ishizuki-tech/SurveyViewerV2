export const sources = {
  production: { label: 'Production', repo: 'SurveyExports' },
  development: { label: 'Development', repo: 'SurveyExports-Dev' },
} as const;

export type Environment = keyof typeof sources;
export const environments = ['production', 'development'] as const;
export const commitSha = /^[a-f0-9]{40}$/;

const uuid7 = '[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const surveyName = new RegExp(
  `^(\\d{4}-\\d{2}-\\d{2})/survey/(\\1_\\d{2}-\\d{2}-\\d{2}Z)_survey_([A-Za-z0-9._-]+)_(${uuid7})\\.json$(?![\\s\\S])`,
);
const safeSegment = /^[A-Za-z0-9._-]+$(?![\s\S])/;
const uuid = /[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

function filenameSegment(value: string): boolean {
  return safeSegment.test(value) && value !== '.' && !value.includes('..');
}

export function surveyPath(path: string) {
  const match = surveyName.exec(path);
  if (!match || path.split('/')[2].length > 255) return null;
  const [, date, stamp, device, id] = match;
  const startedAt = new Date(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toISOString();
  const expectedStamp = startedAt.slice(0, 19).replace('T', '_').replace(/:(?=\d)/g, '-') + 'Z';
  if (stamp !== expectedStamp || date.startsWith('0000') || !filenameSegment(device)) return null;
  return { path, date, stamp, device, id, startedAt };
}

export type SurveyPath = NonNullable<ReturnType<typeof surveyPath>>;

export async function voicePath(survey: SurveyPath, file: string, questionId: string, recordingId?: string) {
  if (!questionId.trim() || file.length > 255 || !filenameSegment(file) || !file.endsWith('.wav')) return null;
  const prefix = `${survey.stamp}_voice_${survey.device}_${survey.id}_`;
  if (!file.startsWith(prefix)) return null;

  const tail = file.slice(prefix.length, -4);
  // Early V2 exports expose the UUID only in the basename.
  const id = recordingId ?? uuid.exec(tail)?.[0];
  if (!id || !filenameSegment(id) || !tail.endsWith(`_${id}`)) return null;
  const questionSegment = tail.slice(0, -id.length - 1);
  if (!filenameSegment(questionSegment)) return null;
  const available = 255 - (file.length - questionSegment.length);
  let expectedQuestion = questionId;
  if (!filenameSegment(questionId) || questionId.length > available) {
    if (!/^q-[a-f0-9]{24}$/.test(questionSegment)) return null;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(questionId));
    const hex = Array.from(new Uint8Array(digest, 0, 12), byte => byte.toString(16).padStart(2, '0')).join('');
    expectedQuestion = `q-${hex}`;
  }
  if (questionSegment !== expectedQuestion) return null;
  return { path: `${survey.date}/voice/${file}`, id };
}

export function rawUrl(environment: Environment, sha: string, path: string): string {
  if (!commitSha.test(sha) || sha.length !== 40 ||
      !path.split('/').every(filenameSegment)) {
    throw new Error('Invalid GitHub artifact location');
  }
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/ishizuki-tech/${sources[environment].repo}/${sha}/${encodedPath}`;
}

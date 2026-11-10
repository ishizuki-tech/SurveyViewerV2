import { exportTimestamp, record, surveyStatus } from './contract.ts';
import type { Status } from './contract.ts';
import { commitSha, environments, surveyPath } from './paths.ts';
import type { Environment, SurveyPath } from './paths.ts';

export interface SurveySummary extends SurveyPath {
  status: Status;
  exportedAt?: string;
}

export interface SourceIndex {
  revision: string;
  surveys: SurveySummary[];
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  sources: Record<Environment, SourceIndex>;
}

export function readCatalog(value: unknown): Catalog {
  const data = record(value);
  const generatedAt = exportTimestamp(data.generatedAt);
  if (data.version !== 1 || !generatedAt) throw new Error('Invalid survey index.');
  const sources = {} as Catalog['sources'];
  for (const env of environments) {
    const source = record(record(data.sources)[env]);
    if (typeof source.revision !== 'string' || source.revision.length !== 40 ||
        !commitSha.test(source.revision) || !Array.isArray(source.surveys)) {
      throw new Error('Invalid source in the survey index.');
    }
    const seen = new Set<string>();
    const surveys = source.surveys.map((value: unknown) => {
      const entry = record(value);
      const route = typeof entry.path === 'string' ? surveyPath(entry.path) : null;
      const status = surveyStatus(entry.status);
      if (!route || !status || seen.has(route.path)) throw new Error('Invalid survey index entry.');
      seen.add(route.path);
      return { ...route, status, exportedAt: exportTimestamp(entry.exportedAt) };
    });
    sources[env] = { revision: source.revision, surveys };
  }
  return { version: 1, generatedAt, sources };
}

export type SortOrder = 'newest' | 'oldest';

export function filterSurveys(surveys: SurveySummary[], query: string, status: Status | '',
                              order: SortOrder): SurveySummary[] {
  const terms = query.trim().toLowerCase().split(/\s+/);
  const direction = order === 'newest' ? -1 : 1;
  return surveys.filter(survey => {
    const text = `${survey.id} ${survey.device} ${survey.date}`.toLowerCase();
    return (!status || survey.status === status) && terms.every(term => text.includes(term));
  }).sort((a, b) => direction * (
    a.startedAt.localeCompare(b.startedAt) || a.path.localeCompare(b.path)
  ));
}

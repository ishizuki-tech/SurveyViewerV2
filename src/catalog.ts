import { exportTimestamp, metricKeys, record, surveyStatus } from './contract.ts';
import type { Metric, Status, SurveyMetrics } from './contract.ts';
import { commitSha, environments, surveyPath } from './paths.ts';
import type { Environment, SurveyPath } from './paths.ts';

export interface SurveySummary extends SurveyPath, SurveyMetrics {
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
      const metrics: SurveyMetrics = {};
      for (const key of metricKeys) {
        const count = entry[key];
        if (count === undefined) continue;
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
          throw new Error('Invalid metric in the survey index.');
        }
        metrics[key] = count;
      }
      return { ...route, status, exportedAt: exportTimestamp(entry.exportedAt), ...metrics };
    });
    sources[env] = { revision: source.revision, surveys };
  }
  return { version: 1, generatedAt, sources };
}

export const sortOptions = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  'most-answers': 'Most answers',
  'fewest-answers': 'Fewest answers',
  'most-followups': 'Most follow-ups',
  'fewest-followups': 'Fewest follow-ups',
  'most-audio': 'Most audio',
  'fewest-audio': 'Fewest audio',
} as const;

export type SortOrder = keyof typeof sortOptions;
export const sortMetrics: Partial<Record<SortOrder, Metric>> = {
  'most-answers': 'answerCount', 'fewest-answers': 'answerCount',
  'most-followups': 'followupCount', 'fewest-followups': 'followupCount',
  'most-audio': 'audioCount', 'fewest-audio': 'audioCount',
};

export interface SurveyFilters {
  query?: string;
  status?: Status;
  month?: string;
  date?: string;
  device?: string;
  path?: string;
}

export function filterSurveys(surveys: SurveySummary[], filters: SurveyFilters,
                              order: SortOrder): SurveySummary[] {
  const terms = (filters.query ?? '').trim().toLowerCase().split(/\s+/);
  const metric = sortMetrics[order];
  const direction = order.startsWith('most-') ? -1 : 1;
  return surveys.filter(survey => {
    const text = `${survey.id} ${survey.device} ${survey.date}`.toLowerCase();
    return (!filters.status || survey.status === filters.status)
      && (!filters.month || survey.date.slice(0, 7) === filters.month)
      && (!filters.date || survey.date === filters.date)
      && (!filters.device || survey.device === filters.device)
      && (!filters.path || survey.path === filters.path)
      && terms.every(term => text.includes(term));
  }).sort((a, b) => {
    if (metric) {
      const left = a[metric];
      const right = b[metric];
      if (left === undefined && right !== undefined) return 1;
      if (right === undefined && left !== undefined) return -1;
      if (left !== undefined && right !== undefined && left !== right) return direction * (left - right);
    }
    const tie = a.path === b.path ? 0 : a.path < b.path ? -1 : 1;
    return (order === 'oldest' ? 1 : -1) * (a.startedAt.localeCompare(b.startedAt) || tie);
  });
}

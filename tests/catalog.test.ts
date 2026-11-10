import assert from 'node:assert/strict';
import test from 'node:test';
import { filterSurveys, readCatalog, sortOptions } from '../src/catalog.ts';
import type { SortOrder, SurveyFilters } from '../src/catalog.ts';
import { device, index, route, routeAt, second } from './fixtures.ts';

const later = routeAt(30 * 86400, 'SYNTHETIC_Other');
const nextDay = routeAt(86400);
const earliest = routeAt(-1);
const items = [
  { path: route.path, status: 'completed', answerCount: 0, followupCount: 4, audioCount: 2 },
  { path: second.path, status: 'incomplete', answerCount: 5, followupCount: 0, audioCount: 2 },
  { path: later.path, status: 'completed' },
  { path: nextDay.path, status: 'completed', answerCount: 5, followupCount: 2, audioCount: 0 },
  { path: earliest.path, status: 'completed' },
];
const input = {
  ...index,
  sources: { ...index.sources, production: { ...index.sources.production, surveys: items } },
};
const { surveys } = readCatalog(input).sources.production;
const ids = (filters: SurveyFilters, order: SortOrder = 'newest') =>
  filterSurveys(surveys, filters, order).map(item => item.id);

test('filters by month, exact date, device and survey independently and in combination', () => {
  assert.deepEqual(ids({ month: '2026-12' }), [later.id]);
  assert.deepEqual(ids({ date: route.date }), [second.id, route.id, earliest.id]);
  assert.deepEqual(ids({ device }), [nextDay.id, second.id, route.id, earliest.id]);
  assert.deepEqual(ids({ path: second.path }), [second.id]);
  const filters = {
    query: 'test-device 2026-11', status: 'incomplete' as const, month: '2026-11',
    date: route.date, device, path: second.path,
  };
  assert.deepEqual(ids(filters), [second.id]);
  assert.deepEqual(ids({ ...filters, month: '2026-12' }), []);
  assert.deepEqual(ids({ ...filters, query: 'absent' }), []);
  assert.deepEqual(ids({ ...filters, status: 'completed' }), []);
});

test('sorts all eight ways, keeping unknown below known zero and breaking metric ties by recency', () => {
  const expected = {
    newest: [later, nextDay, second, route, earliest],
    oldest: [earliest, route, second, nextDay, later],
    'most-answers': [nextDay, second, route, later, earliest],
    'fewest-answers': [route, nextDay, second, later, earliest],
    'most-followups': [route, nextDay, second, later, earliest],
    'fewest-followups': [second, nextDay, route, later, earliest],
    'most-audio': [second, route, nextDay, later, earliest],
    'fewest-audio': [nextDay, second, route, later, earliest],
  } satisfies Record<SortOrder, (typeof route)[]>;
  for (const order of Object.keys(sortOptions) as SortOrder[]) {
    assert.deepEqual(ids({}, order), expected[order].map(item => item.id), order);
  }
  const alternate = routeAt(0, 'AnotherDevice');
  const tied = [
    { ...route, status: 'completed' as const, answerCount: 1 },
    { ...alternate, status: 'completed' as const, answerCount: 1 },
  ];
  assert.deepEqual(filterSurveys(tied, {}, 'most-answers'), filterSurveys(tied.toReversed(), {}, 'most-answers'));
  assert.deepEqual(surveys.map(item => item.path), items.map(item => item.path));
});

test('derives a missing device field from the validated V2 path and validates optional numeric metrics', () => {
  assert.equal(surveys[0].device, device);
  assert.equal(surveys[0].answerCount, 0);
  assert.equal(surveys[2].answerCount, undefined);
  for (const bad of [-1, 1.5, '0', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const data = structuredClone(input);
    Object.assign(data.sources.production.surveys[0], { answerCount: bad });
    assert.throws(() => readCatalog(data), /Invalid metric/);
  }
});

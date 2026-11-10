import './style.css';
import { filterSurveys, readCatalog, sortMetrics, sortOptions } from './catalog.ts';
import type { Catalog, SortOrder, SurveyFilters, SurveySummary } from './catalog.ts';
import { readSurvey, surveyStatus } from './contract.ts';
import { element, statusBadge, surveyDetail } from './detail.ts';
import { rawUrl, sources } from './paths.ts';
import type { Environment } from './paths.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header class="masthead">
    <div class="masthead-inner">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="3.5" width="14" height="17" rx="2"/>
            <path d="M9 8h6m-6 4h6m-6 4h3"/>
          </svg>
        </div>
        <div><div class="eyebrow">Survey2026</div><h1>Survey Viewer <span>V2</span></h1></div>
      </div>
      <div class="environment">
        <label class="eyebrow" for="environment">Export source</label>
        <select id="environment" disabled>
          <option value="production">Production</option>
          <option value="development">Development</option>
        </select>
      </div>
    </div>
  </header>
  <main class="workspace">
    <section class="library" aria-labelledby="library-heading">
      <div class="library-heading">
        <div class="eyebrow" id="source-label">Production archive</div>
        <h2 id="library-heading">Survey records</h2>
        <p id="snapshot" class="muted">Loading export index…</p>
      </div>
      <div class="filters">
        <label class="search">Search records
          <input id="search" type="search" placeholder="Survey ID, device or UTC date" autocomplete="off" disabled>
        </label>
        <label>Completion
          <select id="status" disabled>
            <option value="">All statuses</option><option value="completed">Completed</option>
            <option value="incomplete">Incomplete</option>
          </select>
        </label>
        <label>Sort by
          <select id="sort" disabled></select>
        </label>
        <label>Month (UTC)
          <select id="month" disabled></select>
        </label>
        <label>Date (UTC)
          <select id="date" disabled></select>
        </label>
        <label class="wide-filter">Device
          <select id="device" disabled></select>
        </label>
        <label class="wide-filter">Survey
          <select id="survey" disabled></select>
        </label>
      </div>
      <div class="filter-footer">
        <p id="active-filters" class="muted" role="status">No active filters</p>
        <button type="button" id="clear-filters" class="view-button" disabled>Clear filters</button>
      </div>
      <p id="result-count" class="result-count" role="status"></p>
      <ul id="list" class="survey-list"></ul>
      <button type="button" id="more" class="view-button more" hidden>Show more surveys</button>
    </section>
    <section class="detail" aria-label="Survey details">
      <a class="back-link" href="#library-heading" hidden>↑ Back to survey list</a>
      <div id="detail" tabindex="-1"></div>
    </section>
  </main>
`;

const source = document.querySelector<HTMLSelectElement>('#environment')!;
const search = document.querySelector<HTMLInputElement>('#search')!;
const status = document.querySelector<HTMLSelectElement>('#status')!;
const sort = document.querySelector<HTMLSelectElement>('#sort')!;
const month = document.querySelector<HTMLSelectElement>('#month')!;
const date = document.querySelector<HTMLSelectElement>('#date')!;
const device = document.querySelector<HTMLSelectElement>('#device')!;
const survey = document.querySelector<HTMLSelectElement>('#survey')!;
const activeFilters = document.querySelector('#active-filters')!;
const clearFilters = document.querySelector<HTMLButtonElement>('#clear-filters')!;
const list = document.querySelector<HTMLUListElement>('#list')!;
const resultCount = document.querySelector('#result-count')!;
const snapshot = document.querySelector('#snapshot')!;
const sourceLabel = document.querySelector('#source-label')!;
const more = document.querySelector<HTMLButtonElement>('#more')!;
const back = document.querySelector<HTMLAnchorElement>('.back-link')!;
const detail = document.querySelector<HTMLDivElement>('#detail')!;
const filterControls = [search, status, month, date, device, survey];
const metricLabels = { answerCount: 'Answers', followupCount: 'Follow-ups', audioCount: 'Audio references' };
sort.replaceChildren(...Object.entries(sortOptions).map(([value, label]) => new Option(label, value)));

let catalog: Catalog;
let environment: Environment = 'production';
let selected: SurveySummary | undefined;
let pending: AbortController | undefined;
const pageSize = 40;
let limit = pageSize;

function message(title: string, body: string, isError = false) {
  for (const audio of detail.querySelectorAll('audio')) audio.pause();
  const placeholder = element('div', 'placeholder');
  placeholder.setAttribute('role', isError ? 'alert' : 'status');
  placeholder.append(element('div', 'eyebrow', 'Export explorer'), element('h2', '', title),
    element('p', 'muted', body));
  detail.replaceChildren(placeholder);
  return placeholder;
}

function syncSelection() {
  for (const button of list.querySelectorAll('button')) {
    if (button.dataset.path === selected?.path) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

async function openSurvey(summary: SurveySummary, focus: boolean) {
  pending?.abort();
  const controller = new AbortController();
  pending = controller;
  const env = environment;
  const revision = catalog.sources[env].revision;
  selected = summary;
  syncSelection();
  back.hidden = false;
  message('Loading survey…', 'Fetching the V2 export from GitHub.');
  if (focus) {
    detail.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 760px)').matches) back.scrollIntoView({ block: 'start' });
  }
  try {
    const response = await fetch(rawUrl(env, revision, summary.path), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    const raw = await response.text();
    const survey = await readSurvey(JSON.parse(raw), summary);
    if (controller.signal.aborted) return;
    detail.replaceChildren(surveyDetail(summary, survey, raw, env, revision));
  } catch (error) {
    if (controller.signal.aborted) return;
    const panel = message('Could not load this survey',
      error instanceof SyntaxError ? 'The export contains invalid JSON.' : 'Check the connection and try again.', true);
    const retry = element('button', 'view-button', 'Retry');
    retry.addEventListener('click', () => void openSurvey(summary, true));
    panel.append(retry);
  }
}

function renderList() {
  const all = catalog.sources[environment].surveys;
  const filters: SurveyFilters = {
    query: search.value.trim(),
    status: surveyStatus(status.value),
    month: month.value,
    date: date.value,
    device: device.value,
    path: survey.value,
  };
  const order = sort.value as SortOrder;
  const metric = sortMetrics[order];
  const surveys = filterSurveys(all, filters, order);
  const active = [];
  if (filters.query) active.push(`Search: ${filters.query}`);
  if (filters.status) active.push(`Completion: ${status.selectedOptions[0].text}`);
  if (filters.month) active.push(`Month: ${filters.month}`);
  if (filters.date) active.push(`Date: ${filters.date}`);
  if (filters.device) active.push(`Device: ${filters.device}`);
  if (filters.path) active.push(`Survey: ${survey.selectedOptions[0].text}`);
  activeFilters.textContent = active.length ? active.join(' · ') : 'No active filters';
  clearFilters.disabled = active.length === 0;
  resultCount.textContent = `${surveys.length} of ${all.length} surveys`;
  more.hidden = surveys.length <= limit;
  const rows = surveys.slice(0, limit).map(summary => {
    const row = element('li');
    const button = element('button', 'survey-row');
    button.type = 'button';
    button.dataset.path = summary.path;
    const top = element('span', 'row-top');
    top.append(element('strong', '', summary.startedAt.slice(0, 16).replace('T', ' ') + ' UTC'),
      statusBadge(summary.status));
    button.append(top, element('span', 'row-device', summary.device), element('span', 'row-id', summary.id));
    if (metric) {
      button.append(element('span', 'muted', `${metricLabels[metric]}: ${summary[metric] ?? 'Unknown'}`));
    }
    button.addEventListener('click', () => void openSurvey(summary, true));
    row.append(button);
    return row;
  });
  if (!rows.length) rows.push(element('li', 'empty-list', all.length ? 'No surveys match these filters.' : 'No V2 exports in this source.'));
  list.replaceChildren(...rows);
  syncSelection();
}

function populateOptions(surveys: SurveySummary[]) {
  function setValues(control: HTMLSelectElement, label: string, values: string[]) {
    control.replaceChildren(new Option(label, ''), ...Array.from(new Set(values), value => new Option(value, value)));
  }
  const dates = surveys.map(item => item.date).sort().reverse();
  setValues(month, 'All months', dates.map(day => day.slice(0, 7)));
  setValues(date, 'All dates', dates);
  setValues(device, 'All devices', surveys.map(item => item.device).sort());
  survey.replaceChildren(new Option('All surveys', ''), ...filterSurveys(surveys, {}, 'newest')
    .map(item => new Option(item.id, item.path)));
}

function resetFilters() {
  for (const control of filterControls) control.value = '';
  limit = pageSize;
  renderList();
}

function updateSource() {
  pending?.abort();
  selected = undefined;
  sourceLabel.textContent = `${sources[environment].label} archive`;
  const revision = catalog.sources[environment].revision;
  snapshot.textContent = `Snapshot ${revision.slice(0, 7)} · ${catalog.generatedAt.slice(0, 10)} UTC`;
  populateOptions(catalog.sources[environment].surveys);
  back.hidden = true;
  resetFilters();
  message('Select a survey', 'Choose a record to see answers, follow-ups and recordings.');
}

for (const control of [...filterControls, sort]) {
  control.addEventListener(control === search ? 'input' : 'change', () => {
    limit = pageSize;
    renderList();
  });
}
clearFilters.addEventListener('click', () => {
  resetFilters();
  search.focus();
});
source.addEventListener('change', () => {
  environment = source.value === 'development' ? 'development' : 'production';
  updateSource();
});
more.addEventListener('click', () => {
  const previousLimit = limit;
  limit += pageSize;
  renderList();
  list.querySelectorAll('button')[previousLimit]?.focus();
});
back.addEventListener('click', event => {
  event.preventDefault();
  (list.querySelector<HTMLButtonElement>('[aria-current="true"]') ?? search).focus();
});

message('Loading index…', 'Looking up the latest indexed export snapshot.');
async function loadIndex() {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}survey-index.json`, {
      cache: 'no-cache',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Could not load index.');
    catalog = readCatalog(await response.json());
    for (const control of [source, ...filterControls, sort]) control.disabled = false;
    updateSource();
  } catch {
    snapshot.textContent = 'Index unavailable';
    const panel = message('Could not load the export index',
      'Refresh the index with npm run index when running locally, or retry a published snapshot.', true);
    const retry = element('button', 'view-button', 'Retry');
    retry.addEventListener('click', () => void loadIndex());
    panel.append(retry);
  }
}
void loadIndex();

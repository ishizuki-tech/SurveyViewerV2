import { noteId } from './contract.ts';
import type { Recording, Survey } from './contract.ts';
import type { SurveySummary } from './catalog.ts';
import { rawUrl } from './paths.ts';
import type { Environment } from './paths.ts';

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function statusBadge(status: Survey['status']) {
  return element('span', `badge ${status}`, status === 'completed' ? 'Completed' : 'Incomplete');
}

function displayTimestamp(value: string) {
  return value.replace('T', ' ').slice(0, 19) + ' UTC';
}

function textBlock(label: string, value: string, empty = 'No answer recorded.') {
  const block = element('div', 'text-block');
  block.append(element('div', 'eyebrow', label),
    element('p', value ? 'response' : 'muted response', value || empty));
  return block;
}

const promptLabel = {
  original: 'Original question',
  followup: 'Follow-up',
  survey_note: 'Survey Note',
};

function recordingList(recordings: Recording[], environment: Environment, revision: string) {
  const list = element('div', 'recordings');
  recordings.forEach((recording, index) => {
    const item = element('div', 'recording');
    const head = element('div', 'recording-head');
    const kind = recording.kind ? promptLabel[recording.kind] : 'Prompt association unavailable';
    const position = recording.position ? ` ${recording.position}` : '';
    head.append(element('h4', '', `Recording ${index + 1} · ${kind}${position}`),
      element('span', 'chip', recording.status ? `Transcription: ${recording.status}` : 'Transcription status unavailable'));
    item.append(head);
    item.append(element('p', 'recording-id', `ID ${recording.id || 'unavailable'}`));
    if (recording.prompt) item.append(textBlock('Captured prompt', recording.prompt));
    if (recording.path) {
      const audio = element('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.setAttribute('aria-label', `Recording ${recording.id ?? index + 1}`);
      const error = element('p', 'muted', 'Audio unavailable at this export revision.');
      error.hidden = true;
      audio.addEventListener('error', () => { error.hidden = false; });
      audio.addEventListener('play', () => {
        for (const other of document.querySelectorAll('audio')) {
          if (other !== audio) other.pause();
        }
      });
      audio.src = rawUrl(environment, revision, recording.path);
      item.append(audio, error);
    } else {
      item.append(element('p', 'muted', 'Playback unavailable for this file reference.'));
    }
    if (recording.transcript !== undefined) item.append(textBlock('Raw transcript', recording.transcript, 'Empty transcript.'));
    list.append(item);
  });
  return list;
}

export function surveyDetail(summary: SurveySummary, survey: Survey, raw: string,
                             environment: Environment, revision: string) {
  const fragment = document.createDocumentFragment();
  const header = element('header', 'detail-header');
  const metadata = element('div', 'detail-meta');
  metadata.append(statusBadge(survey.status), element('span', 'muted', displayTimestamp(summary.startedAt)));
  header.append(metadata, element('h2', '', 'Survey record'), element('p', 'full-id', summary.id));
  const facts = element('dl', 'facts');
  for (const [label, value] of [
    ['Device', summary.device],
    ['Exported', survey.exportedAt ? displayTimestamp(survey.exportedAt) : 'Unavailable'],
    ['App build', survey.build || 'Unavailable'],
  ]) {
    const fact = element('div');
    fact.append(element('dt', 'eyebrow', label), element('dd', '', value));
    facts.append(fact);
  }
  header.append(facts);

  const actions = element('div', 'detail-actions');
  const responses = element('button', 'view-button', 'Responses');
  const json = element('button', 'view-button', 'Raw JSON');
  const responsePanel = element('div', 'response-panel');
  const jsonPanel = element('div', 'json-panel');
  const setView = (rawView: boolean) => {
    for (const audio of responsePanel.querySelectorAll('audio')) audio.pause();
    responses.setAttribute('aria-pressed', String(!rawView));
    json.setAttribute('aria-pressed', String(rawView));
    responsePanel.hidden = rawView;
    jsonPanel.hidden = !rawView;
    if (rawView && !jsonPanel.firstChild) {
      const pre = element('pre', 'raw-json', raw);
      pre.tabIndex = 0;
      pre.setAttribute('aria-label', 'Raw survey JSON');
      jsonPanel.append(pre);
    }
  };
  responses.addEventListener('click', () => setView(false));
  json.addEventListener('click', () => setView(true));
  actions.append(responses, json);
  setView(false);

  const heading = element('div', 'section-heading');
  const count = survey.questions.reduce((sum, question) => sum + question.recordings.length, 0);
  heading.append(element('h3', '', 'Questions & answers'), element('span', 'muted',
    `${survey.questions.length} questions · ${count} recordings`));
  responsePanel.append(heading);
  if (!survey.questions.length) responsePanel.append(element('p', 'muted', 'No responses in this export.'));

  for (const question of survey.questions) {
    const card = element('article', 'question-card');
    const title = element('div', 'question-title');
    const label = question.id === noteId ? 'Survey Note' : question.id || 'Unassigned';
    title.append(element('span', 'question-id', label));
    if (question.outcome) title.append(element('span', 'chip', `AI outcome: ${question.outcome}`));
    card.append(title, element('h4', '', question.question || label), textBlock('Answer', question.answer));

    const primary = question.recordings.filter(recording => recording.kind !== 'followup');
    if (primary.length) card.append(recordingList(primary, environment, revision));
    if (question.followups.length) {
      const history = element('ol', 'followups');
      for (const [index, followup] of question.followups.entries()) {
        const item = element('li', 'followup');
        item.append(element('div', 'eyebrow', `Follow-up ${index + 1}`),
          element('h4', '', followup.question || 'Question unavailable'), textBlock('Answer', followup.answer));
        const linked = question.recordings.filter(recording => recording.position === index + 1);
        if (linked.length) item.append(recordingList(linked, environment, revision));
        history.append(item);
      }
      card.append(history);
    }
    const outsideHistory = question.recordings.filter(recording =>
      recording.position !== undefined && recording.position > question.followups.length,
    );
    if (outsideHistory.length) card.append(element('p', 'muted', 'Recordings with no matching follow-up in this export.'),
      recordingList(outsideHistory, environment, revision));
    responsePanel.append(card);
  }

  fragment.append(header, actions, responsePanel, jsonPanel);
  return fragment;
}

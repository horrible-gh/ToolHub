import { generateRandomNumbers } from '../../../tools/random-number/random.js';
import {
  addHistoryEntry,
  clearToolHistory,
  createStorageAdapter,
  emptyHistory,
  getBrowserStorage,
  validHistoryState
} from '../state-store.js';
import { formatRelativeTime } from '../format.js';

function cryptoUint32() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

function parseInteger(value) {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function describeRandomNumberResult(values, min, max, unique = false, durationMs = null) {
  const parts = [values.length + ' generated', 'inclusive range ' + min + ' to ' + max];
  if (unique) parts.push('unique');
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) parts.push(Math.max(0, Math.round(durationMs)) + 'ms');
  return {
    heading: values.length === 1 ? 'Result' : 'Results',
    summary: parts.join(' · ')
  };
}

export function describeRandomNumberArguments({ minimum, maximum, count, unique }) {
  return minimum + '–' + maximum + ' ×' + count + (unique ? ' unique' : '');
}

function historyEntry(toolId, status, summary, outcome, durationMs) {
  const entry = { toolId, status, summary, outcome, createdAt: new Date().toISOString() };
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) entry.durationMs = Math.max(0, durationMs);
  return entry;
}

function createMemoryHistoryStore() {
  let state = null;
  return {
    read(fallback) { return state ?? fallback(); },
    write(value) { state = value; return true; }
  };
}

export function initRandomNumber(root) {
  const pick = (selector) => root.querySelector(selector);
  const form = pick('[data-random-form]');
  if (!form) return;
  const toolId = root.dataset?.toolId ?? 'random-number';
  const ready = pick('[data-random-ready]');
  const error = pick('[data-random-error]');
  const panel = pick('[data-random-result]');
  const heading = pick('[data-random-heading]');
  const summary = pick('[data-random-summary]');
  const list = pick('[data-random-list]');
  const jsonBox = pick('[data-random-json]');
  const jsonToggle = pick('[data-random-json-toggle]');
  const copyStatus = pick('[data-random-copy-status]');
  const copyButtons = [...(root.querySelectorAll?.('[data-random-copy]') ?? [])];
  const drawer = pick('[data-history-drawer]');
  const historyList = pick('[data-history-list]');
  const historyEmpty = pick('[data-history-empty]');
  const historyMeta = pick('[data-history-meta]');
  const historyPanel = pick('[data-history-panel]');
  const historyToggle = pick('[data-history-toggle]');
  const historyClear = pick('[data-history-clear]');
  const historyStatus = pick('[data-history-status]');
  const persistentHistoryStore = createStorageAdapter(getBrowserStorage('sessionStorage'), 'toolhub:session-history', validHistoryState);
  const store = persistentHistoryStore ?? createMemoryHistoryStore();
  let history = store.read(emptyHistory);
  let latest = null;

  const readInputs = () => {
    const data = new FormData(form);
    return {
      minimum: String(data.get('minimum') ?? ''),
      maximum: String(data.get('maximum') ?? ''),
      count: String(data.get('count') ?? ''),
      unique: data.has('unique')
    };
  };

  const entriesForTool = () => history.items.filter((item) => item.toolId === toolId);

  const renderHistory = () => {
    if (!historyList || !drawer) return;
    const entries = entriesForTool().slice().reverse();
    historyList.replaceChildren(...entries.map((entry) => {
      const item = document.createElement('li');
      item.className = 'drow';
      const when = document.createElement('time');
      when.className = 'dwhen';
      when.dateTime = entry.createdAt;
      when.textContent = formatRelativeTime(entry.createdAt);
      const what = document.createElement('span');
      what.className = 'dwhat';
      const args = document.createElement('span');
      args.textContent = (entry.summary || '—') + ' → ';
      const outcome = document.createElement('span');
      outcome.className = entry.status === 'success' ? 'o' : 'bad';
      outcome.textContent = entry.outcome || (entry.status === 'success' ? '' : 'failed');
      what.append(args, outcome);
      const action = document.createElement('span');
      action.className = 'dact';
      item.append(when, what, action);
      return item;
    }));
    if (historyEmpty) historyEmpty.hidden = entries.length !== 0;
    if (historyMeta) {
      historyMeta.textContent = entries.length + (entries.length === 1 ? ' run' : ' runs') +
        (persistentHistoryStore ? ' · this session only' : ' · in memory only, lost if you leave this page');
    }
  };

  const record = (status, args, outcome, durationMs) => {
    history = addHistoryEntry(history, historyEntry(toolId, status, args, outcome, durationMs));
    if (!store.write(history)) return;
    renderHistory();
    if (historyStatus) {
      historyStatus.textContent = status === 'success' ? 'Run added to session history.'
        : status === 'validation-error' ? 'Validation error added to session history.'
          : 'Execution error added to session history.';
    }
  };

  if (drawer) {
    drawer.hidden = false;
    renderHistory();
    if (!persistentHistoryStore && historyStatus) {
      historyStatus.textContent = 'Session storage is unavailable. Runs are kept in memory only and will be lost if you leave this page.';
    }
    historyToggle?.addEventListener('click', () => {
      const expanded = historyToggle.getAttribute('aria-expanded') === 'true';
      historyToggle.setAttribute('aria-expanded', String(!expanded));
      historyToggle.textContent = expanded ? 'Expand' : 'Collapse';
      if (historyPanel) historyPanel.hidden = expanded;
    });
    historyClear?.addEventListener('click', () => {
      history = clearToolHistory(history, toolId);
      if (!store.write(history)) return;
      renderHistory();
      if (historyStatus) historyStatus.textContent = 'Session history cleared.';
    });
  }

  const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
  for (const button of copyButtons) {
    if (!canCopy) continue;
    button.hidden = false;
    button.addEventListener('click', () => {
      if (!latest) return;
      const text = button.dataset.randomCopy === 'csv'
        ? ['value', ...latest.values].join('\n')
        : latest.values.join(', ');
      navigator.clipboard.writeText(text)
        .then(() => { if (copyStatus) copyStatus.textContent = 'Copied to the clipboard.'; })
        .catch(() => { if (copyStatus) copyStatus.textContent = 'Copying failed.'; });
    });
  }

  if (jsonToggle && jsonBox) {
    jsonToggle.hidden = false;
    jsonToggle.addEventListener('click', () => {
      const expanded = jsonToggle.getAttribute('aria-expanded') === 'true';
      jsonToggle.setAttribute('aria-expanded', String(!expanded));
      jsonToggle.textContent = expanded ? 'Show JSON' : 'Hide JSON';
      jsonBox.hidden = expanded;
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = readInputs();
    const args = describeRandomNumberArguments(input);
    let executionStarted = false;
    const started = now();
    try {
      const min = parseInteger(input.minimum);
      const max = parseInteger(input.maximum);
      const count = parseInteger(input.count);
      const values = generateRandomNumbers(
        { min, max, count, unique: input.unique },
        () => { executionStarted = true; return cryptoUint32(); }
      );
      const durationMs = now() - started;
      const described = describeRandomNumberResult(values, min, max, input.unique, durationMs);
      latest = { values, min, max, count, unique: input.unique };
      if (list) {
        list.replaceChildren(...values.map((value) => {
          const item = document.createElement('li');
          item.textContent = String(value);
          return item;
        }));
      }
      if (heading) heading.textContent = described.heading;
      if (summary) summary.textContent = described.summary;
      if (jsonBox) jsonBox.textContent = JSON.stringify(latest, null, 2);
      if (ready) ready.hidden = true;
      if (error) error.hidden = true;
      if (panel) panel.hidden = false;
      record('success', args, described.summary, durationMs);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unable to generate numbers';
      if (ready) ready.hidden = true;
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      record(executionStarted ? 'execution-error' : 'validation-error', args, message, null);
    }
  });
}

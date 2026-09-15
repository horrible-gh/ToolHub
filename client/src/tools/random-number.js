import { generateRandomNumbers } from '../../../tools/random-number/random.js';
import {
  addHistoryEntry,
  createStorageAdapter,
  emptyHistory,
  getBrowserStorage,
  validHistoryState
} from '../state-store.js';

function cryptoUint32() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

function parseInteger(value) {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

export function describeRandomNumberResult(values, min, max) {
  return {
    heading: values.length === 1 ? 'Result' : 'Results',
    summary: values.length + ' generated · inclusive range ' + min + ' to ' + max
  };
}

function historyEntry(toolId, status, summary) {
  return { toolId, status, summary, createdAt: new Date().toISOString() };
}

export function initRandomNumber(root) {
  const form = root.querySelector('[data-random-form]');
  const ready = root.querySelector('[data-random-ready]');
  const error = root.querySelector('[data-random-error]');
  const panel = root.querySelector('[data-random-result]');
  const heading = root.querySelector('[data-random-heading]');
  const summary = root.querySelector('[data-random-summary]');
  const list = root.querySelector('[data-random-list]');
  const historyButton = root.querySelector('[data-history-toggle]');
  const historyPanel = root.querySelector('[data-history-panel]');
  const historyList = root.querySelector('[data-history-list]');
  const historyEmpty = root.querySelector('[data-history-empty]');
  const historyStatus = root.querySelector('[data-history-status]');
  const historyStore = createStorageAdapter(getBrowserStorage('sessionStorage'), 'toolhub:session-history', validHistoryState);
  let history = historyStore?.read(emptyHistory) ?? emptyHistory();

  const renderHistory = () => {
    const entries = history.items.filter((item) => item.toolId === root.dataset.toolId);
    historyList.replaceChildren(...entries.slice().reverse().map((entry) => {
      const item = document.createElement('li');
      const state = document.createElement('strong');
      const detail = document.createElement('span');
      const time = document.createElement('time');
      state.textContent = entry.status === 'success' ? 'Success' :
        entry.status === 'validation-error' ? 'Validation error' : 'Execution error';
      detail.textContent = entry.summary;
      time.dateTime = entry.createdAt;
      time.textContent = new Date(entry.createdAt).toLocaleTimeString();
      item.append(state, detail, time);
      return item;
    }));
    historyEmpty.hidden = entries.length !== 0;
  };
  const record = (status, text) => {
    if (!historyStore) return;
    history = addHistoryEntry(history, historyEntry(root.dataset.toolId, status, text));
    if (!historyStore.write(history)) return;
    if (!historyPanel.hidden) renderHistory();
    historyStatus.textContent = status === 'success' ? 'Run added to session history.' :
      status === 'validation-error' ? 'Validation error added to session history.' :
        'Execution error added to session history.';
  };

  if (historyStore && historyButton && historyPanel) {
    historyButton.hidden = false;
    historyButton.addEventListener('click', () => {
      const expanded = historyButton.getAttribute('aria-expanded') === 'true';
      historyButton.setAttribute('aria-expanded', String(!expanded));
      historyPanel.hidden = expanded;
      if (!expanded) renderHistory();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    let executionStarted = false;
    try {
      const data = new FormData(form);
      const min = parseInteger(String(data.get('minimum') ?? ''));
      const max = parseInteger(String(data.get('maximum') ?? ''));
      const count = parseInteger(String(data.get('count') ?? ''));
      const values = generateRandomNumbers(
        { min, max, count, unique: data.has('unique') },
        () => { executionStarted = true; return cryptoUint32(); }
      );
      const result = describeRandomNumberResult(values, min, max);
      list.replaceChildren(...values.map((value) => {
        const item = document.createElement('li');
        item.textContent = String(value);
        return item;
      }));
      heading.textContent = result.heading;
      summary.textContent = result.summary;
      ready.hidden = true;
      error.hidden = true;
      panel.hidden = false;
      record('success', result.summary);
    } catch (caught) {
      ready.hidden = true;
      panel.hidden = true;
      list.replaceChildren();
      summary.textContent = '';
      error.textContent = caught instanceof Error ? caught.message : 'Unable to generate numbers';
      error.hidden = false;
      record(executionStarted ? 'execution-error' : 'validation-error',
        executionStarted ? 'The number generator could not complete.' : 'Check the generation settings.');
    }
  });
}
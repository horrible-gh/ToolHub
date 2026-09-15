import {
  createStorageAdapter,
  emptyFavorites,
  emptyHistory,
  getBrowserStorage,
  lastRunByTool,
  summarizeRuns,
  toggleFavorite,
  validFavoriteState,
  validHistoryState
} from './state-store.js';
import { formatDuration, formatRelativeTime, truncate } from './format.js';

export const FAVORITES_KEY = 'toolhub:favorites';
export const HISTORY_KEY = 'toolhub:session-history';

export const favoritesAdapter = () => createStorageAdapter(getBrowserStorage('localStorage'), FAVORITES_KEY, validFavoriteState);
export const historyAdapter = () => createStorageAdapter(getBrowserStorage('sessionStorage'), HISTORY_KEY, validHistoryState);

export function statusLabel(status) {
  if (status === 'success') return 'Success';
  return status === 'validation-error' ? 'Validation error' : 'Execution error';
}

export function sortToolRows(rows, mode, { pinned = new Set(), lastUsed = new Map() } = {}) {
  const byName = (a, b) => String(a.dataset.toolName).localeCompare(String(b.dataset.toolName));
  if (mode === 'pinned') {
    const rank = (row) => (pinned.has(row.dataset.toolId) ? 0 : 1);
    return rows.slice().sort((a, b) => rank(a) - rank(b) || byName(a, b));
  }
  if (mode === 'recent') {
    const usedAt = (row) => {
      const entry = lastUsed.get(row.dataset.toolId);
      return entry ? Date.parse(entry.createdAt) : null;
    };
    return rows.slice().sort((a, b) => {
      const left = usedAt(a);
      const right = usedAt(b);
      if (left === null && right === null) return byName(a, b);
      if (left === null) return 1;
      if (right === null) return -1;
      return right - left || byName(a, b);
    });
  }
  return rows.slice().sort(byName);
}

function railGroups(root) {
  return [...root.querySelectorAll('.rail-nav .rail-list')].map((list) => ({
    list,
    heading: list.previousElementSibling?.classList.contains('rgroup') ? list.previousElementSibling : null
  }));
}

function initRailSearch(root) {
  const input = root.querySelector('[data-rail-search]');
  const rail = root.querySelector('.rail');
  if (!input || !rail) return null;
  const hint = root.querySelector('[data-rail-kbd]');
  const empty = root.querySelector('[data-rail-empty]');
  if (hint) hint.hidden = false;

  const apply = () => {
    const query = input.value.normalize('NFKC').trim().toLowerCase();
    let visible = 0;
    for (const item of rail.querySelectorAll('[data-rail-item]')) {
      const haystack = (item.dataset.toolName + ' ' + item.dataset.toolId).normalize('NFKC').toLowerCase();
      const match = !query || haystack.includes(query);
      item.hidden = !match;
      if (match && !item.dataset.railClone) visible += 1;
    }
    for (const { list, heading } of railGroups(root)) {
      const items = [...list.querySelectorAll('[data-rail-item]')];
      const hide = items.length === 0 || items.every((item) => item.hidden);
      list.hidden = hide;
      if (heading) heading.hidden = hide;
    }
    if (empty) empty.hidden = visible !== 0;
  };

  input.addEventListener('input', apply);
  root.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (String(event.key).toLowerCase() !== 'k') return;
    event.preventDefault();
    input.focus();
    input.select();
  });
  apply();
  return apply;
}

function initPins(root, { onChange } = {}) {
  const buttons = [...root.querySelectorAll('[data-pin-toggle]')];
  const pinnedList = root.querySelector('[data-rail-pinned]');
  const pinnedHeading = root.querySelector('[data-rail-pinned-heading]');
  const pinnedCount = root.querySelector('[data-rail-pinned-count]');
  const status = root.querySelector('[data-pin-status]');
  const adapter = favoritesAdapter();
  if (!adapter) return () => new Set();
  let state = adapter.read(emptyFavorites);
  const pinned = () => new Set(state.items.map((item) => item.toolId));

  const renderRail = () => {
    const ids = [...pinned()];
    for (const item of root.querySelectorAll('.rail-nav [data-rail-item]:not([data-rail-clone])')) {
      const star = item.querySelector('[data-rail-star]');
      if (star) star.hidden = !ids.includes(item.dataset.toolId);
    }
    if (!pinnedList) return;
    const clones = [];
    for (const id of ids) {
      const source = root.querySelector('.rail-nav [data-rail-item][data-tool-id="' + id + '"]:not([data-rail-clone])');
      if (!source) continue;
      const clone = source.cloneNode(true);
      clone.dataset.railClone = 'true';
      clone.hidden = false;
      const star = clone.querySelector('[data-rail-star]');
      if (star) star.hidden = false;
      clones.push(clone);
    }
    pinnedList.replaceChildren(...clones);
    pinnedList.hidden = clones.length === 0;
    if (pinnedHeading) pinnedHeading.hidden = clones.length === 0;
    if (pinnedCount) pinnedCount.textContent = String(clones.length);
  };

  const renderButtons = () => {
    const ids = pinned();
    for (const button of buttons) {
      const on = ids.has(button.dataset.toolId);
      button.hidden = false;
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('on', on);
      const mark = button.querySelector('.starmark');
      if (mark) mark.textContent = on ? '★' : '☆';
      const label = button.querySelector('[data-pin-label]');
      if (label) {
        label.textContent = on ? 'Pinned' : 'Pin';
      } else {
        const name = button.closest('[data-tool-row]')?.dataset.toolName ?? 'this tool';
        const hidden = button.querySelector('.visually-hidden');
        if (hidden) hidden.textContent = (on ? 'Unpin ' : 'Pin ') + name;
      }
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      state = toggleFavorite(state, button.dataset.toolId, new Date().toISOString());
      if (!adapter.write(state)) {
        for (const other of buttons) other.hidden = true;
        if (status) status.textContent = 'Pins are unavailable in this browser.';
        return;
      }
      renderButtons();
      renderRail();
      if (status) status.textContent = button.getAttribute('aria-pressed') === 'true' ? 'Pinned.' : 'Unpinned.';
      onChange?.();
    });
  }
  renderButtons();
  renderRail();
  return pinned;
}

function initHome(root, items, names) {
  const runs = root.querySelector('[data-stat-runs]');
  const body = root.querySelector('[data-resume-body]');
  if (!runs && !body) return;
  const summary = summarizeRuns(items);
  const set = (selector, text) => { const node = root.querySelector(selector); if (node) node.textContent = text; };
  set('[data-stat-runs]', String(summary.runs));
  set('[data-stat-runs-detail]', summary.succeeded + ' succeeded · ' + summary.failed + ' failed');
  if (summary.last) {
    set('[data-stat-last]', names.get(summary.last.toolId) ?? summary.last.toolId);
    set('[data-stat-last-detail]', formatRelativeTime(summary.last.createdAt) + ' · ' + truncate(summary.last.outcome || statusLabel(summary.last.status), 34));
  }
  if (summary.averageMs !== null) {
    set('[data-stat-average]', formatDuration(summary.averageMs));
    set('[data-stat-average-detail]', 'over ' + summary.timed + (summary.timed === 1 ? ' timed run' : ' timed runs'));
  }

  const table = root.querySelector('[data-resume-table]');
  const empty = root.querySelector('[data-resume-empty]');
  if (!body || !table) return;
  const recent = items.slice().reverse().slice(0, 6);
  body.replaceChildren(...recent.map((item) => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.setAttribute('scope', 'row');
    name.className = 'nm';
    name.textContent = names.get(item.toolId) ?? item.toolId;
    const args = document.createElement('td');
    args.className = 'mono';
    args.textContent = item.summary || '—';
    const outcome = document.createElement('td');
    outcome.className = 'mono';
    const outcomeText = document.createElement('span');
    if (item.status !== 'success') outcomeText.className = 'bad';
    outcomeText.textContent = truncate(item.outcome || statusLabel(item.status), 48);
    outcome.append(outcomeText);
    const when = document.createElement('td');
    when.className = 'mono';
    const time = document.createElement('time');
    time.dateTime = item.createdAt;
    time.textContent = formatRelativeTime(item.createdAt);
    when.append(time);
    const go = document.createElement('td');
    go.className = 'go';
    const link = document.createElement('a');
    link.href = '/tools/' + encodeURIComponent(item.toolId);
    link.textContent = (item.status === 'success' ? 'Open again' : 'Fix and open') + ' →';
    go.append(link);
    row.append(name, args, outcome, when, go);
    return row;
  }));
  table.hidden = recent.length === 0;
  if (empty) empty.hidden = recent.length !== 0;
}

function initToolsTable(root, items, pinned, applyRailSearch) {
  const table = root.querySelector('[data-tools-table]');
  if (!table) return;
  const tbody = table.querySelector('tbody');
  const rows = [...table.querySelectorAll('[data-tool-row]')];
  const lastUsed = lastRunByTool(items);
  for (const row of rows) {
    const cell = row.querySelector('[data-tool-lastused]');
    const entry = lastUsed.get(row.dataset.toolId);
    if (cell && entry) cell.textContent = formatRelativeTime(entry.createdAt);
  }
  const select = root.querySelector('[data-tools-sort]');
  const label = root.querySelector('[data-tools-sort-label]');
  if (!select || !tbody) return;
  select.hidden = false;
  if (label) label.hidden = false;
  select.addEventListener('change', () => {
    tbody.replaceChildren(...sortToolRows(rows, select.value, { pinned: pinned(), lastUsed }));
    applyRailSearch?.();
  });
}

function initCopyLink(root) {
  const button = root.querySelector('[data-copy-link]');
  const status = root.querySelector('[data-pin-status]');
  if (!button || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(globalThis.location?.href ?? '')
      .then(() => { if (status) status.textContent = 'Link copied.'; })
      .catch(() => { if (status) status.textContent = 'Copying the link failed.'; });
  });
}

export function initShell(root = document) {
  const applyRailSearch = initRailSearch(root);
  const history = historyAdapter();
  const items = history ? history.read(emptyHistory).items : [];
  const names = new Map([...root.querySelectorAll('[data-rail-item]')].map((item) => [item.dataset.toolId, item.dataset.toolName]));
  const pinned = initPins(root, { onChange: () => applyRailSearch?.() });
  initHome(root, items, names);
  initToolsTable(root, items, pinned, applyRailSearch);
  initCopyLink(root);
}

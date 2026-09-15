export const STATE_VERSION = 2;
export const HISTORY_LIMIT = 20;
export const INPUT_KEY_LIMIT = 12;
export const INPUT_VALUE_LIMIT = 40;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createStorageAdapter(storage, key, validate) {
  if (!storage) return null;
  try {
    const probe = key + ':probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    return null;
  }
  return {
    read(fallback) {
      try {
        const parsed = JSON.parse(storage.getItem(key));
        return validate(parsed) ? parsed : fallback();
      } catch {
        return fallback();
      }
    },
    write(value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
  };
}

const validTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

export function validRunInput(value) {
  if (!isObject(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > INPUT_KEY_LIMIT) return false;
  return entries.every(([key, entry]) => key.length <= INPUT_VALUE_LIMIT &&
    (typeof entry === 'boolean' || (typeof entry === 'string' && entry.length <= INPUT_VALUE_LIMIT)));
}

export function validHistoryItem(item) {
  if (!isObject(item)) return false;
  if (typeof item.toolId !== 'string' || typeof item.summary !== 'string') return false;
  if (!['success', 'validation-error', 'execution-error'].includes(item.status)) return false;
  if (!validTime(item.createdAt)) return false;
  if (item.toolName !== undefined && typeof item.toolName !== 'string') return false;
  if (item.outcome !== undefined && typeof item.outcome !== 'string') return false;
  if (item.durationMs !== undefined && (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0)) return false;
  if (item.input !== undefined && !validRunInput(item.input)) return false;
  return true;
}

export function validHistoryState(value) {
  return isObject(value) && value.version === STATE_VERSION && Array.isArray(value.items) && value.items.every(validHistoryItem);
}

export function validFavoriteState(value) {
  return isObject(value) && value.version === STATE_VERSION && Array.isArray(value.items) &&
    value.items.every((item) => isObject(item) && typeof item.toolId === 'string' && validTime(item.createdAt));
}

export const emptyHistory = () => ({ version: STATE_VERSION, items: [] });
export const emptyFavorites = () => ({ version: STATE_VERSION, items: [] });

export function addHistoryEntry(state, entry, limit = HISTORY_LIMIT) {
  return { version: STATE_VERSION, items: [...state.items, entry].slice(-limit) };
}

export function clearToolHistory(state, toolId) {
  return { version: STATE_VERSION, items: state.items.filter((item) => item.toolId !== toolId) };
}

export function toggleFavorite(state, toolId, createdAt) {
  const exists = state.items.some((item) => item.toolId === toolId);
  return {
    version: STATE_VERSION,
    items: exists ? state.items.filter((item) => item.toolId !== toolId) : [...state.items, { toolId, createdAt }]
  };
}

export function summarizeRuns(items) {
  const runs = items.length;
  const succeeded = items.filter((item) => item.status === 'success').length;
  const timed = items.filter((item) => typeof item.durationMs === 'number');
  const averageMs = timed.length === 0 ? null : timed.reduce((total, item) => total + item.durationMs, 0) / timed.length;
  return { runs, succeeded, failed: runs - succeeded, timed: timed.length, averageMs, last: items[items.length - 1] ?? null };
}

export function lastRunByTool(items) {
  const seen = new Map();
  for (const item of items) seen.set(item.toolId, item);
  return seen;
}

export function getBrowserStorage(kind) {
  try {
    return globalThis[kind];
  } catch {
    return null;
  }
}

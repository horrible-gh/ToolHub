export const STATE_VERSION = 1;
export const HISTORY_LIMIT = 20;

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

export function validHistoryState(value) {
  return isObject(value) && value.version === STATE_VERSION && Array.isArray(value.items) &&
    value.items.every((item) => isObject(item) && typeof item.toolId === 'string' &&
      ['success', 'validation-error', 'execution-error'].includes(item.status) &&
      typeof item.summary === 'string' && validTime(item.createdAt));
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

export function toggleFavorite(state, toolId, createdAt) {
  const exists = state.items.some((item) => item.toolId === toolId);
  return {
    version: STATE_VERSION,
    items: exists ? state.items.filter((item) => item.toolId !== toolId) : [...state.items, { toolId, createdAt }]
  };
}

export function getBrowserStorage(kind) {
  try {
    return globalThis[kind];
  } catch {
    return null;
  }
}
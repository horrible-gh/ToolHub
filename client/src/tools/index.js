import { initRandomNumber } from './random-number.js';
import {
  createStorageAdapter,
  emptyFavorites,
  getBrowserStorage,
  toggleFavorite,
  validFavoriteState
} from '../state-store.js';

const initializers = new Map([['random-number', initRandomNumber]]);
const initialized = new WeakSet();

function initFavorite(root) {
  const button = root.querySelector('[data-favorite-toggle]');
  const status = root.querySelector('[data-favorite-status]');
  if (!button || !status) return;
  const adapter = createStorageAdapter(getBrowserStorage('localStorage'), 'toolhub:favorites', validFavoriteState);
  if (!adapter) return;
  let state = adapter.read(emptyFavorites);
  const render = () => {
    const favorite = state.items.some((item) => item.toolId === root.dataset.toolId);
    button.setAttribute('aria-pressed', String(favorite));
    button.textContent = favorite ? 'Remove from favorites' : 'Add to favorites';
  };
  render();
  button.hidden = false;
  button.addEventListener('click', () => {
    state = toggleFavorite(state, root.dataset.toolId, new Date().toISOString());
    if (!adapter.write(state)) {
      button.hidden = true;
      status.textContent = 'Favorites are unavailable.';
      return;
    }
    render();
    status.textContent = button.getAttribute('aria-pressed') === 'true'
      ? 'Added to favorites.' : 'Removed from favorites.';
  });
}

export function initTools(root = document) {
  const elements = [];
  if (root instanceof Element && root.matches('[data-tool-id]')) elements.push(root);
  elements.push(...root.querySelectorAll('[data-tool-id]'));
  for (const element of elements) {
    if (initialized.has(element)) continue;
    initialized.add(element);
    initFavorite(element);
    initializers.get(element.dataset.toolId)?.(element);
  }
}
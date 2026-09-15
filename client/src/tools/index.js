import { initRandomNumber } from './random-number.js';

const initializers = new Map([['random-number', initRandomNumber]]);
const initialized = new WeakSet();

export function initTools(root = document) {
  const elements = [];
  if (root instanceof Element && root.matches('[data-tool-id]')) elements.push(root);
  elements.push(...root.querySelectorAll('[data-tool-id]'));
  for (const element of elements) {
    const initialize = initializers.get(element.dataset.toolId);
    if (!initialize || initialized.has(element)) continue;
    initialized.add(element);
    initialize(element);
  }
}
import { initRandomNumber } from './random-number.js';
import { initPdfMaker } from './pdf-maker.js';

const initializers = new Map([['random-number', initRandomNumber], ['pdf-maker', initPdfMaker]]);
const initialized = new WeakSet();

export function initTools(root = document) {
  const surfaces = [];
  if (root instanceof Element && root.matches('[data-tool-surface]')) surfaces.push(root);
  surfaces.push(...root.querySelectorAll('[data-tool-surface]'));
  for (const surface of surfaces) {
    if (initialized.has(surface)) continue;
    initialized.add(surface);
    initializers.get(surface.dataset.toolId)?.(surface);
  }
}

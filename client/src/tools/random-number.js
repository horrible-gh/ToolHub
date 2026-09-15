import { generateRandomNumbers } from '../../../tools/random-number/random.js';

function cryptoUint32() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0];
}

function parseInteger(value) {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

export function initRandomNumber(root) {
  const form = root.querySelector('[data-random-form]');
  const error = root.querySelector('[data-random-error]');
  const panel = root.querySelector('[data-random-result]');
  const heading = root.querySelector('[data-random-heading]');
  const summary = root.querySelector('[data-random-summary]');
  const list = root.querySelector('[data-random-list]');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.hidden = true;
    try {
      const data = new FormData(form);
      const min = parseInteger(String(data.get('minimum') ?? ''));
      const max = parseInteger(String(data.get('maximum') ?? ''));
      const count = parseInteger(String(data.get('count') ?? ''));
      const values = generateRandomNumbers({ min, max, count, unique: data.has('unique') }, cryptoUint32);
      list.replaceChildren(...values.map((value) => {
        const item = document.createElement('li');
        item.textContent = String(value);
        return item;
      }));
      heading.textContent = values.length === 1 ? 'Result' : 'Results';
      summary.textContent = values.length + ' generated · inclusive range ' + min + ' to ' + max;
      panel.hidden = false;
    } catch (caught) {
      panel.hidden = true;
      error.textContent = caught instanceof Error ? caught.message : 'Unable to generate numbers';
      error.hidden = false;
    }
  });
}
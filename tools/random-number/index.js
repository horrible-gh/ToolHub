import { MAX_COUNT, MAX_INTEGER, MIN_INTEGER } from './random.js';

export default {
  render() {
    return '<section class="random-number-tool" data-tool-id="random-number">' +
      '<form class="random-number-form" data-random-form>' +
      '<div class="random-number-fields">' +
      '<label>Minimum<input name="minimum" type="number" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="1" required></label>' +
      '<label>Maximum<input name="maximum" type="number" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="100" required></label>' +
      '<label>Count<input name="count" type="number" step="1" min="1" max="' + MAX_COUNT + '" value="1" required></label>' +
      '</div><label class="random-number-check"><input name="unique" type="checkbox"> Unique only</label>' +
      '<button class="primary-action" type="submit">Generate</button></form>' +
      '<p class="validation-message" data-random-error role="alert" hidden></p>' +
      '<section class="result-panel" data-random-result hidden aria-live="polite">' +
      '<h2 data-random-heading>Result</h2><p class="result-summary" data-random-summary></p>' +
      '<ol class="result-list" data-random-list></ol></section></section>';
  }
};
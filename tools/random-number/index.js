import { MAX_COUNT, MAX_INTEGER, MIN_INTEGER } from './random.js';

export default {
  render() {
    return '<section class="random-number-tool">' +
      '<div class="random-number-workspace">' +
      '<section class="random-number-panel input-panel" aria-labelledby="random-input-heading">' +
      '<div class="panel-heading"><p class="panel-kicker">Input</p><h2 id="random-input-heading">Generation settings</h2><p>Choose an inclusive integer range and how many values to generate.</p></div>' +
      '<form class="random-number-form" data-random-form aria-describedby="random-input-help">' +
      '<p id="random-input-help" class="field-help">Minimum and Maximum accept integers from ' + MIN_INTEGER + ' through ' + MAX_INTEGER + '. Count accepts 1 through ' + MAX_COUNT + '.</p>' +
      '<div class="random-number-fields">' +
      '<label for="random-minimum">Minimum</label><input id="random-minimum" name="minimum" type="number" inputmode="numeric" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="1" required>' +
      '<label for="random-maximum">Maximum</label><input id="random-maximum" name="maximum" type="number" inputmode="numeric" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="100" required>' +
      '<label for="random-count">Count</label><input id="random-count" name="count" type="number" inputmode="numeric" step="1" min="1" max="' + MAX_COUNT + '" value="1" required>' +
      '</div><label class="random-number-check"><input name="unique" type="checkbox"> <span><strong>Unique only</strong><small>Do not repeat values. Count cannot exceed the inclusive range size.</small></span></label>' +
      '<button class="primary-action" type="submit">Generate</button></form></section>' +
      '<section class="random-number-panel result-panel" aria-labelledby="random-result-panel-heading">' +
      '<div class="panel-heading"><p class="panel-kicker">Output</p><h2 id="random-result-panel-heading">Generated numbers</h2><p>Results stay on this page and are not saved.</p></div>' +
      '<p class="result-status result-ready" data-random-ready role="status">Set the options, then select Generate. Your results will appear here.</p>' +
      '<p class="validation-message" data-random-error role="alert" hidden></p>' +
      '<div data-random-result hidden aria-live="polite" aria-atomic="true">' +
      '<h3 data-random-heading>Result</h3><p class="result-summary" data-random-summary></p>' +
      '<ol class="result-list" data-random-list></ol></div></section></div>' +
      '<section class="history-drawer" aria-labelledby="history-heading"><h2 id="history-heading">Session run history</h2>' +
      '<button type="button" data-history-toggle aria-expanded="false" aria-controls="session-run-history" hidden>Show session run history</button>' +
      '<div id="session-run-history" data-history-panel hidden><p data-history-empty>No runs in this tab yet.</p><ol data-history-list></ol></div>' +
      '<p class="visually-hidden" data-history-status aria-live="polite"></p></section></section>';
  }
};

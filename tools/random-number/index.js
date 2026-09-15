import { MAX_COUNT, MAX_INTEGER, MIN_INTEGER } from './random.js';

const FORM_ID = 'random-number-form';

const inputPanel = () => '<section class="card" aria-labelledby="random-input-heading">' +
  '<h2 id="random-input-heading">Input</h2><div class="cb">' +
  `<form id="${FORM_ID}" class="random-form" data-random-form aria-describedby="random-input-help">` +
  '<p id="random-input-help" class="field-help">Minimum and Maximum accept integers from ' + MIN_INTEGER + ' through ' + MAX_INTEGER + '. Count accepts 1 through ' + MAX_COUNT + '.</p>' +
  '<div class="two">' +
  '<p class="field"><label for="random-minimum">Minimum</label><input id="random-minimum" name="minimum" type="number" inputmode="numeric" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="1" required></p>' +
  '<p class="field"><label for="random-maximum">Maximum</label><input id="random-maximum" name="maximum" type="number" inputmode="numeric" step="1" min="' + MIN_INTEGER + '" max="' + MAX_INTEGER + '" value="100" required></p>' +
  '</div>' +
  '<p class="field"><label for="random-count">Count <span class="help">1&ndash;' + MAX_COUNT + '</span></label><input id="random-count" name="count" type="number" inputmode="numeric" step="1" min="1" max="' + MAX_COUNT + '" value="1" required></p>' +
  '<label class="check"><input name="unique" type="checkbox"> <span><strong>Unique only</strong><small>Never repeat a value. Count cannot exceed the inclusive range size.</small></span></label>' +
  '<button class="cta" type="submit">Generate</button></form>' +
  '<p class="summary">Change the inputs and the result panel refreshes in place. The page never navigates.</p>' +
  '</div></section>';

const resultPanel = () => '<section class="card" aria-labelledby="random-result-heading">' +
  '<h2 id="random-result-heading">Result</h2><div class="cb">' +
  '<p class="result-ready" data-random-ready role="status">Set the options, then select Generate. Values appear here without leaving the page.</p>' +
  '<p class="alert" data-random-error role="alert" hidden></p>' +
  '<div data-random-result hidden aria-live="polite" aria-atomic="true">' +
  '<h3 class="visually-hidden" data-random-heading>Result</h3>' +
  '<ol class="resnums" data-random-list></ol>' +
  '<p class="summary" data-random-summary></p>' +
  '<div class="acts">' +
  '<button type="button" class="ghost" data-random-copy="values" hidden>Copy values</button>' +
  '<button type="button" class="ghost" data-random-copy="csv" hidden>Copy CSV</button>' +
  '<button type="button" class="ghost" data-random-json-toggle aria-expanded="false" aria-controls="random-json" hidden>Show JSON</button>' +
  '</div><pre class="jsonbox" id="random-json" data-random-json hidden></pre></div>' +
  '<p class="visually-hidden" data-random-copy-status aria-live="polite"></p>' +
  '</div></section>';

const drawer = () => '<section class="drawer" aria-labelledby="run-history-heading" data-history-drawer hidden>' +
  '<div class="dhead"><h2 id="run-history-heading">Run history</h2>' +
  '<span class="dmeta" data-history-meta>this session only</span><span class="spacer"></span>' +
  '<button type="button" class="iconbtn" data-history-clear>Clear all</button>' +
  '<button type="button" class="iconbtn" data-history-toggle aria-expanded="true" aria-controls="run-history-body">Collapse</button></div>' +
  '<div class="dbody" id="run-history-body" data-history-panel>' +
  '<p class="drow-empty" data-history-empty>No runs in this tab yet.</p>' +
  '<ol class="drows" data-history-list></ol></div>' +
  '<p class="visually-hidden" data-history-status aria-live="polite"></p></section>';

export default {
  formId: FORM_ID,
  render() {
    return `<div class="split">${inputPanel()}${resultPanel()}</div>${drawer()}`;
  }
};

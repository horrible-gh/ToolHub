import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { describeRandomNumberResult, initRandomNumber } from '../client/src/tools/random-number.js';
import { registrations, validateRegistry } from '../tools/registry.js';
import {
  MAX_COUNT,
  MAX_INTEGER,
  MIN_INTEGER,
  generateRandomNumbers,
  randomIntInclusive
} from '../tools/random-number/random.js';

test('routes, assets, headers and safe errors', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const route of ['/', '/dashboard', '/tools', '/tools/sample-tool', '/tools/random-number']) {
    const r = await fetch(base + route);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  }
  const dashboard = await (await fetch(base + '/')).text();
  const tools = await (await fetch(base + '/tools')).text();
  const random = await (await fetch(base + '/tools/random-number')).text();
  assert.match(dashboard, /Sample Tool/);
  assert.match(dashboard, /Random Number/);
  assert.match(tools, /Random Number/);
  for (const html of [dashboard, tools, random]) {
    assert.match(html, /<aside class="tool-rail" aria-label="ToolHub navigation">/);
    assert.match(html, /href="\/tools\/sample-tool"/);
    assert.match(html, /href="\/tools\/random-number"/);
  }
  assert.match(dashboard, /href="\/dashboard" aria-current="page"/);
  assert.match(tools, /href="\/tools" aria-current="page">All Tools/);
  assert.match(random, /href="\/tools\/random-number" aria-current="page"/);
  assert.match(random, /data-tool-id="random-number"/);
  assert.match(random, /name="minimum"/);
  assert.match(random, /name="maximum"/);
  assert.match(random, /name="count"/);
  assert.match(random, /class="random-number-workspace"/);
  assert.match(random, /aria-labelledby="random-input-heading"/);
  assert.match(random, /aria-labelledby="random-result-panel-heading"/);
  assert.match(random, /data-random-ready role="status"/);
  assert.match(random, /data-random-error role="alert" hidden/);
  assert.match(random, /data-random-result hidden aria-live="polite" aria-atomic="true"/);
  assert.match(random, /name="minimum"[^>]*step="1" min="-2147483648" max="2147483647"/);
  assert.match(random, /name="maximum"[^>]*step="1" min="-2147483648" max="2147483647"/);
  assert.match(random, /name="count"[^>]*step="1" min="1" max="1000"/);
  assert.match(random, /name="unique"/);
  assert.match(random, /Unique only/);
  assert.match(random, /Count cannot exceed the inclusive range size/);
  assert.match(random, />Generate<\/button>/);
  assert.doesNotMatch(random, /onclick=|<script(?![^>]* src=)/i);
  assert.match(await (await fetch(base + '/tools/sample-tool')).text(), /Read-only example/);
  for (const route of ['/tools/missing', '/tools/bad--id', '/assets/missing.css', '/assets/%252e%252e/server/app.js']) {
    const r = await fetch(base + route); assert.equal(r.status, 404); const html = await r.text(); assert.doesNotMatch(html, /server\/app|Error:|node_modules/); assert.match(html, /class="tool-rail"/);
  }
  assert.equal((await fetch(base + '/tools/%73ample-tool')).status, 200);
  assert.equal((await fetch(base + '/tools/%2573ample-tool')).status, 404);
  const cssPath = dashboard.match(/href="\/(assets\/[^"]+\.css)"/)[1];
  const css = await fetch(base + '/' + cssPath); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const favicon = await fetch(base + '/favicon.ico'); assert.equal(favicon.status, 200); assert.match(favicon.headers.get('content-type'), /image\/x-icon/);
  const assetsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/client/assets');
  const outsideFile = path.resolve(assetsRoot, '../outside-root-secret.css');
  const outsideLink = path.join(assetsRoot, 'outside-root-link.css');
  fs.rmSync(outsideLink, { force: true }); fs.writeFileSync(outsideFile, 'secret'); fs.symlinkSync(outsideFile, outsideLink, 'file');
  t.after(() => { fs.rmSync(outsideLink, { force: true }); fs.rmSync(outsideFile, { force: true }); });
  assert.equal((await fetch(base + '/assets/outside-root-link.css')).status, 404);
});

test('workbench rail only exposes active registry tools', async (t) => {
  const inactive = { id: 'hidden-tool', name: 'Hidden Tool', description: 'Inactive.', tags: [], active: false, module: { render() { return ''; } } };
  const server = createApp({ tools: [...registrations, inactive], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const dashboard = await (await fetch(base + '/')).text();
  const allTools = await (await fetch(base + '/tools?q=hidden')).text();
  const notFound = await (await fetch(base + '/missing')).text();
  assert.doesNotMatch(dashboard, /Hidden Tool|hidden-tool/);
  assert.doesNotMatch(allTools, /Hidden Tool|hidden-tool/);
  assert.match(allTools, /No tools match your search/);
  assert.doesNotMatch(notFound, /Hidden Tool|hidden-tool/);
});

test('dashboard and all-tools share normalized registry search and render distinct views', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await (await fetch(base + '/')).text();
  const dashboard = await (await fetch(base + '/dashboard')).text();
  const tools = await (await fetch(base + '/tools')).text();
  assert.match(home, /<strong>2<\/strong> active tools available/);
  assert.match(home, /href="\/tools">Browse all tools/);
  assert.match(home, /class="tool-results"/);
  assert.match(dashboard, /class="tool-results"/);
  assert.match(tools, /<table class="tool-table">/);
  for (const heading of ['Name', 'Description', 'Tags', 'ID']) assert.match(tools, new RegExp(`<th scope="col">${heading}<\\/th>`));
  assert.match(tools, /<code>random-number<\/code>/);

  for (const query of ['random', 'SELECTED RANGE', ' utility ', 'ＲＡＮＤＯＭ']) {
    for (const route of ['/', '/tools']) {
      const html = await (await fetch(base + route + '?q=' + encodeURIComponent(query))).text();
      assert.match(html, /Random Number/);
      assert.doesNotMatch(html, /<li><a href="\/tools\/sample-tool"|<tr><th scope="row"><a href="\/tools\/sample-tool"/);
    }
  }
});

test('search and registry empty states are distinct and recoverable', async (t) => {
  const running = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(running, 'listening'); t.after(() => running.close());
  const base = 'http://127.0.0.1:' + running.address().port;
  for (const route of ['/', '/tools']) {
    const html = await (await fetch(base + route + '?q=missing')).text();
    assert.match(html, /role="status"/);
    assert.match(html, /No tools match your search/);
    assert.match(html, new RegExp(`href="${route}">Clear search and show all tools`));
    assert.doesNotMatch(html, /No active tools are registered/);
  }

  const empty = createApp({ tools: [], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(empty, 'listening'); t.after(() => empty.close());
  const emptyBase = 'http://127.0.0.1:' + empty.address().port;
  for (const route of ['/', '/tools?q=anything']) {
    const html = await (await fetch(emptyBase + route)).text();
    assert.match(html, /role="status">No active tools are registered/);
    assert.doesNotMatch(html, /No tools match your search/);
  }
});

test('search values and registry display metadata stay escaped', async (t) => {
  const hostile = { id: 'safe-id', name: '<img src=x onerror=alert(1)>', description: 'Use <script>alert(1)</script>', tags: ['<b>tag</b>'], active: true, module: { render() { return ''; } } };
  const server = createApp({ tools: [hostile], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const route of ['/?q=%3Cscript%3E', '/tools?q=%3Cscript%3E']) {
    const html = await (await fetch(base + route)).text();
    assert.match(html, /value="&lt;script&gt;"/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /&lt;b&gt;tag&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<img src=x|<script>alert|<b>tag<\/b>/);
  }
});

test('random number registry metadata is active', () => {
  const tool = registrations.find(({ id }) => id === 'random-number');
  assert.deepEqual(
    { id: tool.id, name: tool.name, description: tool.description, tags: tool.tags, active: tool.active },
    { id: 'random-number', name: 'Random Number', description: 'Generate random integers inside a selected range.', tags: ['random', 'number', 'utility'], active: true }
  );
});

test('random integer generation is inclusive, deterministic and count-aware', () => {
  assert.equal(randomIntInclusive(7, 7, () => 0), 7);
  assert.equal(randomIntInclusive(1, 3, () => 2), 3);
  assert.deepEqual(generateRandomNumbers({ min: -2, max: 2, count: 3 }, () => 0), [-2, -2, -2]);
  assert.deepEqual(generateRandomNumbers({ min: MIN_INTEGER, max: MAX_INTEGER, count: 2 }, (() => {
    const values = [0, 0xffffffff]; return () => values.shift();
  })()), [MIN_INTEGER, MAX_INTEGER]);
});

test('non-unique mode permits duplicates and unique mode never repeats', () => {
  assert.deepEqual(generateRandomNumbers({ min: 1, max: 2, count: 3, unique: false }, () => 0), [1, 1, 1]);
  const unique = generateRandomNumbers({ min: 10, max: 14, count: 5, unique: true }, () => 0);
  assert.equal(new Set(unique).size, 5);
  assert.deepEqual(unique, [10, 11, 12, 13, 14]);
});

test('random option validation rejects invalid contracts', () => {
  const source = () => 0;
  assert.throws(() => generateRandomNumbers({ min: 2, max: 1, count: 1 }, source), /less than or equal/);
  assert.throws(() => generateRandomNumbers({ min: 1.5, max: 2, count: 1 }, source), /integer/);
  assert.throws(() => generateRandomNumbers({ min: 1, max: 2.5, count: 1 }, source), /integer/);
  assert.throws(() => generateRandomNumbers({ min: 1, max: 2, count: 1.5 }, source), /integer/);
  assert.throws(() => generateRandomNumbers({ min: 1, max: 2, count: 0 }, source), /at least 1/);
  assert.throws(() => generateRandomNumbers({ min: 1, max: 2000, count: MAX_COUNT + 1 }, source), /not exceed/);
  assert.throws(() => generateRandomNumbers({ min: 1, max: 2, count: 3, unique: true }, source), /available range/);
  assert.throws(() => generateRandomNumbers({ min: MIN_INTEGER - 1, max: 0, count: 1 }, source), /between/);
  assert.throws(() => generateRandomNumbers({ min: 0, max: MAX_INTEGER + 1, count: 1 }, source), /between/);
});

test('rejection sampling discards the modulo-bias region', () => {
  let calls = 0;
  const values = [0xffffffff, 2];
  const result = randomIntInclusive(1, 3, () => { calls += 1; return values.shift(); });
  assert.equal(result, 3);
  assert.equal(calls, 2);
});

test('default port is 6412 and PORT remains overridable', () => {
  assert.equal(loadConfig({}).port, 6412);
  assert.equal(loadConfig({ PORT: '7000' }).port, 7000);
});

test('search input is escaped', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0); await once(server, 'listening'); t.after(() => server.close());
  const html = await (await fetch('http://127.0.0.1:' + server.address().port + '/?q=' + encodeURIComponent('<script>x</script>'))).text();
  assert.doesNotMatch(html, /<script>x<\/script>/); assert.match(html, /&lt;script&gt;/);
});

test('registry rejects invalid, duplicate and incomplete tools', () => {
  const module = { render() { return ''; } };
  assert.throws(() => validateRegistry([{ id: 'Bad', name: 'x', description: 'x', tags: [], active: true, module }]));
  assert.throws(() => validateRegistry([{ id: 'a', name: 'x', description: 'x', tags: [], active: true, module }, { id: 'a', name: 'x', description: 'x', tags: [], active: true, module }]));
  assert.throws(() => validateRegistry([{ id: 'a', active: true, module }]));
});

test('random result description distinguishes singular and plural output', () => {
  assert.deepEqual(describeRandomNumberResult([7], 7, 7), {
    heading: 'Result',
    summary: '1 generated · inclusive range 7 to 7'
  });
  assert.deepEqual(describeRandomNumberResult([1, 2], 1, 2), {
    heading: 'Results',
    summary: '2 generated · inclusive range 1 to 2'
  });
});

test('random work surface transitions from ready to success and then current error', () => {
  const originalFormData = globalThis.FormData;
  const originalDocument = globalThis.document;
  const nodes = {
    form: { values: new Map([['minimum', '7'], ['maximum', '7'], ['count', '1']]), addEventListener(type, listener) { assert.equal(type, 'submit'); this.submit = listener; } },
    ready: { hidden: false },
    error: { hidden: true, textContent: '' },
    panel: { hidden: true },
    heading: { textContent: '' },
    summary: { textContent: '' },
    list: { children: [], replaceChildren(...children) { this.children = children; } }
  };
  const selectors = new Map([
    ['[data-random-form]', nodes.form],
    ['[data-random-ready]', nodes.ready],
    ['[data-random-error]', nodes.error],
    ['[data-random-result]', nodes.panel],
    ['[data-random-heading]', nodes.heading],
    ['[data-random-summary]', nodes.summary],
    ['[data-random-list]', nodes.list]
  ]);
  class FakeFormData {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values.get(name) ?? null; }
    has(name) { return this.values.has(name); }
  }
  globalThis.FormData = FakeFormData;
  globalThis.document = { createElement() { return { textContent: '' }; } };
  try {
    initRandomNumber({ querySelector(selector) { return selectors.get(selector); } });
    const event = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };
    nodes.form.submit(event);
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(nodes.ready.hidden, true);
    assert.equal(nodes.error.hidden, true);
    assert.equal(nodes.panel.hidden, false);
    assert.equal(nodes.heading.textContent, 'Result');
    assert.match(nodes.summary.textContent, /1 generated · inclusive range 7 to 7/);
    assert.deepEqual(nodes.list.children.map((item) => item.textContent), ['7']);

    nodes.form.values.set('count', '0');
    nodes.form.submit({ preventDefault() {} });
    assert.equal(nodes.panel.hidden, true);
    assert.equal(nodes.error.hidden, false);
    assert.match(nodes.error.textContent, /Count must be at least 1/);
    assert.equal(nodes.list.children.length, 0);
    assert.equal(nodes.summary.textContent, '');
  } finally {
    globalThis.FormData = originalFormData;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
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
  assert.match(random, /name="unique"/);
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
  const notFound = await (await fetch(base + '/missing')).text();
  assert.doesNotMatch(dashboard, /Hidden Tool|hidden-tool/);
  assert.doesNotMatch(notFound, /Hidden Tool|hidden-tool/);
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
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp, describeMissingPath, filterTools } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { describeRandomNumberArguments, describeRandomNumberResult, initRandomNumber } from '../client/src/tools/random-number.js';
import { formatBytes, initPdfMaker, validatePdfMakerFiles } from '../client/src/tools/pdf-maker.js';
import { MAX_FILE_BYTES, initMdViewer, renderMarkdownToSafeHtml, validateMdViewerFile } from '../client/src/tools/md-viewer.js';
import mdViewerModule from '../tools/md-viewer/index.js';
import { JSDOM } from 'jsdom';
import { formatDuration, formatRelativeTime, truncate } from '../client/src/format.js';
import { sortToolRows, statusLabel } from '../client/src/shell.js';
import { closestToolId, groupTools, registrations, tagCounts, toolIcon, validateRegistry } from '../tools/registry.js';
import {
  MAX_COUNT,
  MAX_INTEGER,
  MIN_INTEGER,
  generateRandomNumbers,
  randomIntInclusive
} from '../tools/random-number/random.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relative) => fs.promises.readFile(path.join(sourceRoot, relative), 'utf8');

test('routes, assets, headers and safe errors', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const expectedCsp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'";
  const assertSecurityHeaders = (response) => {
    assert.equal(response.headers.get('content-security-policy'), expectedCsp);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('x-request-id'), /^[A-Za-z0-9_-]{1,80}$/);
  };
  for (const route of ['/', '/dashboard', '/tools', '/tools/sample-tool', '/tools/random-number', '/tools/pdf-maker', '/tools/md-viewer']) {
    const r = await fetch(base + route);
    assert.equal(r.status, 200);
    assertSecurityHeaders(r);
  }
  const home = await (await fetch(base + '/')).text();
  const tools = await (await fetch(base + '/tools')).text();
  const random = await (await fetch(base + '/tools/random-number')).text();
  const sample = await (await fetch(base + '/tools/sample-tool')).text();
  for (const html of [home, tools, random, sample]) {
    assert.match(html, /<aside class="rail" aria-label="ToolHub navigation">/);
    assert.match(html, /href="\/tools\/sample-tool"/);
    assert.match(html, /href="\/tools\/random-number"/);
    assert.ok(html.indexOf('<a class="skip" href="#main">') < html.indexOf('<aside class="rail"'));
    assert.match(html, /<main id="main" class="pane">/);
    assert.match(html, /<nav class="crumb" aria-label="Breadcrumb">/);
    assert.match(html, /<p class="railfoot">Request ID: <code>/);
    assert.match(html, /4 registered &middot; 4 active/);
    assert.doesNotMatch(html, /tabindex="[1-9][0-9]*"/i);
  }
  assert.match(home, /href="\/dashboard" aria-current="page"/);
  assert.match(tools, /href="\/tools" aria-current="page"/);
  assert.match(random, /href="\/tools\/random-number" aria-current="page"/);
  assert.match(sample, /href="\/tools\/sample-tool" aria-current="page"/);
  assert.match(random, /data-tool-surface data-tool-id="random-number"/);
  assert.match(random, /class="split"/);
  assert.match(random, /name="minimum"/);
  assert.match(random, /name="maximum"/);
  assert.match(random, /name="count"/);
  assert.match(random, /aria-labelledby="random-input-heading"/);
  assert.match(random, /aria-labelledby="random-result-heading"/);
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
  assert.match(sample, /Read-only example/);
  assert.doesNotMatch(sample, /data-history-drawer/);
  for (const route of ['/tools/missing', '/tools/bad--id', '/assets/missing.css', '/assets/%252e%252e/server/app.js']) {
    const r = await fetch(base + route);
    assert.equal(r.status, 404);
    assertSecurityHeaders(r);
    const html = await r.text();
    assert.doesNotMatch(html, /server\/app|Error:|node_modules/);
    assert.match(html, /class="rail"/);
    assert.match(html, /<a class="skip" href="#main">/);
    assert.match(html, /<main id="main" class="pane">/);
    assert.match(html, /Nothing is registered at that path/);
    assert.doesNotMatch(html, /tabindex="[1-9][0-9]*"/i);
  }
  assert.equal((await fetch(base + '/tools/%73ample-tool')).status, 200);
  assert.equal((await fetch(base + '/tools/%2573ample-tool')).status, 404);
  const cssPath = home.match(/href="\/(assets\/[^"]+\.css)"/)[1];
  const css = await fetch(base + '/' + cssPath); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const favicon = await fetch(base + '/favicon.ico'); assert.equal(favicon.status, 200); assert.match(favicon.headers.get('content-type'), /image\/x-icon/);
  const assetsRoot = path.join(sourceRoot, 'build/client/assets');
  const outsideFile = path.resolve(assetsRoot, '../outside-root-secret.css');
  const outsideLink = path.join(assetsRoot, 'outside-root-link.css');
  fs.rmSync(outsideLink, { force: true }); fs.writeFileSync(outsideFile, 'secret'); fs.symlinkSync(outsideFile, outsideLink, 'file');
  t.after(() => { fs.rmSync(outsideLink, { force: true }); fs.rmSync(outsideFile, { force: true }); });
  assert.equal((await fetch(base + '/assets/outside-root-link.css')).status, 404);
});

test('the workbench rail groups active tools and keeps its shape on every route', async (t) => {
  const inactive = { id: 'hidden-tool', name: 'Hidden Tool', description: 'Inactive.', tags: [], active: false, module: { render() { return ''; } } };
  const server = createApp({ tools: [...registrations, inactive], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await (await fetch(base + '/')).text();
  const allTools = await (await fetch(base + '/tools?q=hidden')).text();
  const notFound = await (await fetch(base + '/missing')).text();
  for (const html of [home, allTools, notFound]) {
    assert.doesNotMatch(html, /Hidden Tool|hidden-tool/);
    assert.match(html, /<h2 class="rgroup" id="rail-group-0">Document <span class="n">2<\/span><\/h2>/);
    assert.match(html, /<h2 class="rgroup" id="rail-group-1">Sample <span class="n">1<\/span><\/h2>/);
    assert.match(html, /<h2 class="rgroup" id="rail-group-2">Utility <span class="n">1<\/span><\/h2>/);
    assert.match(html, /<h2 class="rgroup" id="rail-group-pinned" data-rail-pinned-heading hidden>/);
    assert.match(html, /<ul class="rail-list" aria-labelledby="rail-group-pinned" data-rail-pinned hidden><\/ul>/);
    assert.match(html, /data-rail-item data-tool-id="random-number" data-tool-name="Random Number"/);
    assert.match(html, /<form class="railsearch" role="search" action="\/tools" method="get">/);
    assert.match(html, /5 registered &middot; 4 active/);
  }
  assert.match(allTools, /No tools match your search/);
});

test('home is a workbench summary and all-tools is a filterable table', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await (await fetch(base + '/')).text();
  const dashboard = await (await fetch(base + '/dashboard')).text();
  const tools = await (await fetch(base + '/tools')).text();

  assert.match(home, /<h1>Workbench<\/h1>/);
  assert.match(home, /class="statrow"/);
  for (const label of ['Registered tools', 'Runs this session', 'Last run', 'Average run']) assert.match(home, new RegExp('<p class="k">' + label + '</p>'));
  assert.match(home, /data-stat-runs>0<\/p>/);
  assert.match(home, /Pick up where you left off/);
  assert.match(home, /<table class="tbl" aria-labelledby="resume-heading" data-resume-table hidden>/);
  assert.match(home, /data-resume-empty>No runs recorded in this browser session yet/);
  const withoutRequestId = (html) => html.replace(/<code>[^<]*<\/code>/g, '<code>id</code>');
  assert.equal(withoutRequestId(home), withoutRequestId(dashboard), '/ and /dashboard render the same workbench');
  assert.doesNotMatch(home, /<table class="tbl" data-tools-table>/);

  assert.match(tools, /<h1>All tools<\/h1>/);
  assert.match(tools, /<table class="tbl" data-tools-table>/);
  for (const heading of ['Tool', 'Tags', 'ID', 'Last used']) assert.match(tools, new RegExp(`<th scope="col">${heading}<\\/th>`));
  assert.match(tools, /data-tool-row data-tool-id="random-number"/);
  assert.match(tools, /<td class="mono">random-number<\/td>/);
  assert.match(tools, /<td class="mono" data-tool-lastused>&mdash;<\/td>/);
  assert.match(tools, /data-pin-toggle data-tool-id="random-number" aria-pressed="false" hidden/);
  assert.match(tools, /<select id="tools-sort" data-tools-sort hidden>/);
  assert.match(tools, /<a class="chip on" href="\/tools">All 4<\/a>/);
  assert.match(tools, /<a class="chip" href="\/tools\?tag=utility">#utility 1<\/a>/);
});

test('all-tools combines the search box and tag chips with AND', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const query of ['random', 'SELECTED RANGE', ' utility ', 'ＲＡＮＤＯＭ']) {
    const html = await (await fetch(base + '/tools?q=' + encodeURIComponent(query))).text();
    assert.match(html, /data-tool-row data-tool-id="random-number"/);
    assert.doesNotMatch(html, /data-tool-row data-tool-id="sample-tool"/);
  }
  const tagged = await (await fetch(base + '/tools?tag=sample')).text();
  assert.match(tagged, /data-tool-row data-tool-id="sample-tool"/);
  assert.doesNotMatch(tagged, /data-tool-row data-tool-id="random-number"/);
  assert.match(tagged, /<a class="chip on" href="\/tools\?tag=sample" aria-current="page">#sample 1<\/a>/);

  const contradiction = await (await fetch(base + '/tools?q=random&tag=sample')).text();
  assert.match(contradiction, /No tools match your search/);
  assert.match(contradiction, /href="\/tools">Clear search and show all tools/);
  const combined = await (await fetch(base + '/tools?q=random&tag=utility')).text();
  assert.match(combined, /data-tool-row data-tool-id="random-number"/);
  assert.match(combined, /1 of 4 tools match/);
  assert.match(combined, /href="\/tools\?q=random&amp;tag=number"/);

  const { matches } = filterTools(validateRegistry(registrations), { q: ' NUMBER ', tag: 'Utility' });
  assert.deepEqual(matches.map(({ id }) => id), ['random-number']);
});

test('the rail search box round-trips its value and stays escaped on every route', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const route of ['/', '/tools', '/tools/random-number']) {
    const html = await (await fetch(base + route + '?q=' + encodeURIComponent('<script>x</script>'))).text();
    assert.doesNotMatch(html, /<script>x<\/script>/);
    assert.match(html, /id="rail-search" name="q"[^>]*value="&lt;script&gt;x&lt;\/script&gt;"/);
  }
  const plain = await (await fetch(base + '/tools?q=random')).text();
  assert.match(plain, /id="rail-search" name="q"[^>]*value="random"/);
});

test('registry empty state is distinct from a search miss', async (t) => {
  const empty = createApp({ tools: [], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(empty, 'listening'); t.after(() => empty.close());
  const base = 'http://127.0.0.1:' + empty.address().port;
  for (const route of ['/tools', '/tools?q=anything']) {
    const html = await (await fetch(base + route)).text();
    assert.match(html, /role="status">No active tools are registered/);
    assert.doesNotMatch(html, /No tools match your search/);
  }
  const home = await (await fetch(base + '/')).text();
  assert.match(home, /<p class="rail-empty">No active tools are registered\.<\/p>/);
  assert.match(home, /0 registered &middot; 0 active/);
});

test('registry display metadata and reflected paths stay escaped', async (t) => {
  const hostile = { id: 'safe-id', name: '<img src=x onerror=alert(1)>', description: 'Use <script>alert(1)</script>', tags: ['<b>tag</b>'], active: true, module: { render() { return ''; } } };
  const server = createApp({ tools: [hostile], logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const tools = await (await fetch(base + '/tools')).text();
  assert.match(tools, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(tools, /&lt;b&gt;tag&lt;\/b&gt;/);
  assert.doesNotMatch(tools, /<img src=x|<script>alert|<b>tag<\/b>/);
  const notFound = await (await fetch(base + '/%3Cimg%20src=x%20onerror=alert(1)%3E')).text();
  assert.match(notFound, /That address is not a ToolHub page\./);
  assert.doesNotMatch(notFound, /<img src=x/);
  assert.doesNotMatch(notFound, /<script(?![^>]* src=)/i);
});

test('the not-found page only reflects a plausible tool path', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.deepEqual(describeMissingPath('/tools/randon-number'), { label: '/tools/randon-number', toolId: 'randon-number' });
  for (const unsafe of ['/assets/%252e%252e/server/app.js', '/tools/' + 'a'.repeat(400), '/tools/a/b', '/etc/passwd', '/']) {
    assert.deepEqual(describeMissingPath(unsafe), { label: null, toolId: null }, unsafe + ' must not be echoed');
  }
  for (const route of ['/assets/%252e%252e/server/app.js', '/tools/' + 'a'.repeat(400), '/nope']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404);
    const html = await response.text();
    assert.match(html, /That address is not a ToolHub page\./);
    assert.doesNotMatch(html, /server\/app|node_modules|Error:/);
    assert.doesNotMatch(html, new RegExp('a'.repeat(80)));
  }
  const echoed = await (await fetch(base + '/tools/randon-number')).text();
  assert.match(echoed, /<p class="mono empty-path">\/tools\/randon-number<\/p>/);
});

test('a missing tool path suggests the closest registered tool', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const typo = await fetch(base + '/tools/randon-number');
  assert.equal(typo.status, 404);
  const html = await typo.text();
  assert.match(html, /Closest match: <a href="\/tools\/random-number">Random Number<\/a>/);
  assert.match(html, /<p class="mono empty-path">\/tools\/randon-number<\/p>/);
  const unrelated = await (await fetch(base + '/tools/zzzzzzzzzzzz')).text();
  assert.doesNotMatch(unrelated, /Closest match/);
  const active = validateRegistry(registrations);
  assert.equal(closestToolId('randon-number', active)?.id, 'random-number');
  assert.equal(closestToolId('random-number', active), null);
  assert.equal(closestToolId('', active), null);
});

test('rail grouping, tag counts and icons come from registry metadata', () => {
  const active = validateRegistry(registrations);
  assert.deepEqual(groupTools(active).map(({ group, items }) => [group, items.map(({ id }) => id)]),
    [['Document', ['md-viewer', 'pdf-maker']], ['Sample', ['sample-tool']], ['Utility', ['random-number']]]);
  assert.deepEqual(tagCounts(active), [
    { tag: 'converter', count: 1 }, { tag: 'document', count: 2 }, { tag: 'markdown', count: 1 }, { tag: 'number', count: 1 },
    { tag: 'pdf', count: 1 }, { tag: 'random', count: 1 }, { tag: 'read-only', count: 1 },
    { tag: 'sample', count: 1 }, { tag: 'utility', count: 1 }, { tag: 'viewer', count: 1 }
  ]);
  assert.equal(toolIcon(active.find(({ id }) => id === 'random-number')), '#');
  assert.equal(toolIcon({ name: 'ungrouped tool' }), 'U');
  assert.deepEqual(groupTools([{ id: 'x', name: 'X', tags: [] }]).map(({ group }) => group), ['Tools']);
});

test('PDF-Maker is registered with an accessible server-rendered upload surface', async (t) => {
  const tool = registrations.find(({ id }) => id === 'pdf-maker');
  assert.deepEqual({ group: tool.group, tags: tool.tags, active: tool.active }, { group: 'Document', tags: ['pdf', 'document', 'converter'], active: true });
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const html = await (await fetch('http://127.0.0.1:' + server.address().port + '/tools/pdf-maker')).text();
  assert.match(html, /data-tool-id="pdf-maker"/);
  assert.match(html, /data-pdf-drop/);
  assert.match(html, /type="file" accept=".docx,.pptx" multiple/);
  assert.match(html, /data-pdf-live aria-live="polite"/);
  assert.match(html, /data-pdf-convert disabled/);
  assert.doesNotMatch(html, /onclick=|<script(?![^>]* src=)/i);
});

test('PDF-Maker client validation mirrors the documented browser limits', () => {
  const files = [
    { name: 'report.docx', size: 1024 },
    { name: 'slides.PPTX', size: 2 * 1024 * 1024 },
    { name: 'notes.txt', size: 5 },
    { name: 'large.docx', size: 25 * 1024 * 1024 + 1 }
  ];
  const result = validatePdfMakerFiles(files);
  assert.deepEqual(result.accepted.map(({ name }) => name), ['report.docx', 'slides.PPTX']);
  assert.equal(result.rejected.length, 2);
  assert.equal(validatePdfMakerFiles([{ name: 'extra.docx', size: 1 }], 10).accepted.length, 0);
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(25 * 1024 * 1024), '25.0 MB');
});

test('MD Viewer is registered with an accessible server-rendered upload surface', async (t) => {
  const tool = registrations.find(({ id }) => id === 'md-viewer');
  assert.deepEqual({ group: tool.group, tags: tool.tags, active: tool.active }, { group: 'Document', tags: ['markdown', 'viewer', 'document'], active: true });
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const html = await (await fetch('http://127.0.0.1:' + server.address().port + '/tools/md-viewer')).text();
  assert.match(html, /data-tool-id="md-viewer"/);
  assert.match(html, /data-md-drop/);
  assert.match(html, /type="file" accept=".md,.markdown"/);
  assert.match(html, /data-md-live aria-live="polite"/);
  assert.match(html, /data-md-error role="alert" hidden/);
  assert.match(html, /data-md-render/);
  assert.match(html, /data-md-empty/);
  assert.match(html, /data-md-remove/);
  assert.doesNotMatch(html, /onclick=|<script(?![^>]* src=)/i);
});

test('MD Viewer client validation mirrors the documented browser limits', () => {
  assert.equal(validateMdViewerFile({ name: 'notes.md', size: 10 }).ok, true);
  assert.equal(validateMdViewerFile({ name: 'notes.MARKDOWN', size: 10 }).ok, true);
  const badExt = validateMdViewerFile({ name: 'notes.txt', size: 10 });
  assert.equal(badExt.ok, false);
  assert.match(badExt.message, /only \.md and \.markdown/);
  const emptyFile = validateMdViewerFile({ name: 'empty.md', size: 0 });
  assert.equal(emptyFile.ok, false);
  assert.match(emptyFile.message, /empty/);
  assert.equal(validateMdViewerFile({ name: 'limit.md', size: MAX_FILE_BYTES }).ok, true);
  const overLimit = validateMdViewerFile({ name: 'big.md', size: MAX_FILE_BYTES + 1 });
  assert.equal(overLimit.ok, false);
  assert.match(overLimit.message, /exceeds/);
  assert.equal(validateMdViewerFile(null).ok, false);
});

test('random number registry metadata is active', () => {
  const tool = registrations.find(({ id }) => id === 'random-number');
  assert.deepEqual(
    { id: tool.id, name: tool.name, description: tool.description, tags: tool.tags, group: tool.group, active: tool.active },
    { id: 'random-number', name: 'Random Number', description: 'Generate random integers inside a selected range.', tags: ['random', 'number', 'utility'], group: 'Utility', active: true }
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

test('registry rejects invalid, duplicate and incomplete tools', () => {
  const module = { render() { return ''; } };
  assert.throws(() => validateRegistry([{ id: 'Bad', name: 'x', description: 'x', tags: [], active: true, module }]));
  assert.throws(() => validateRegistry([{ id: 'a', name: 'x', description: 'x', tags: [], active: true, module }, { id: 'a', name: 'x', description: 'x', tags: [], active: true, module }]));
  assert.throws(() => validateRegistry([{ id: 'a', active: true, module }]));
  assert.throws(() => validateRegistry([{ id: 'a', name: 'x', description: 'x', tags: [], group: '  ', active: true, module }]), /rail group/);
  assert.throws(() => validateRegistry([{ id: 'a', name: 'x', description: 'x', tags: [], icon: 'abc', active: true, module }]), /rail icon/);
});

test('result and argument descriptions read the way the run history renders them', () => {
  assert.deepEqual(describeRandomNumberResult([7], 7, 7), {
    heading: 'Result',
    summary: '1 generated · inclusive range 7 to 7'
  });
  assert.deepEqual(describeRandomNumberResult([1, 2], 1, 2, true, 2.4), {
    heading: 'Results',
    summary: '2 generated · inclusive range 1 to 2 · unique · 2ms'
  });
  assert.equal(describeRandomNumberArguments({ minimum: '1', maximum: '100', count: '3', unique: true }), '1–100 ×3 unique');
  assert.equal(describeRandomNumberArguments({ minimum: '50', maximum: '10', count: '3', unique: false }), '50–10 ×3');
});

test('relative time, duration and truncation formatting stay stable', () => {
  const base = Date.parse('2026-01-01T12:00:00.000Z');
  const ago = (seconds) => formatRelativeTime(new Date(base - seconds * 1000).toISOString(), base);
  assert.equal(ago(5), 'just now');
  assert.equal(ago(60), '1 min ago');
  assert.equal(ago(600), '10 mins ago');
  assert.equal(ago(3600), '1 hour ago');
  assert.equal(ago(7200), '2 hours ago');
  assert.equal(ago(86400), '1 day ago');
  assert.equal(formatRelativeTime('not a date'), '');
  assert.equal(formatDuration(2.4), '2ms');
  assert.equal(formatDuration(1500), '1.50s');
  assert.equal(formatDuration(Number.NaN), '');
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
  assert.equal(statusLabel('success'), 'Success');
  assert.equal(statusLabel('validation-error'), 'Validation error');
  assert.equal(statusLabel('execution-error'), 'Execution error');
});

test('all-tools sorting orders by name, recency and pinned state', () => {
  const rows = [
    { dataset: { toolId: 'sample-tool', toolName: 'Sample Tool' } },
    { dataset: { toolId: 'random-number', toolName: 'Random Number' } },
    { dataset: { toolId: 'zeta-tool', toolName: 'Zeta Tool' } }
  ];
  const lastUsed = new Map([
    ['sample-tool', { createdAt: '2026-01-01T00:00:00.000Z' }],
    ['random-number', { createdAt: '2026-01-02T00:00:00.000Z' }]
  ]);
  const ids = (list) => list.map((row) => row.dataset.toolId);
  assert.deepEqual(ids(sortToolRows(rows, 'name')), ['random-number', 'sample-tool', 'zeta-tool']);
  assert.deepEqual(ids(sortToolRows(rows, 'recent', { lastUsed })), ['random-number', 'sample-tool', 'zeta-tool']);
  assert.deepEqual(ids(sortToolRows(rows, 'pinned', { pinned: new Set(['zeta-tool']) })), ['zeta-tool', 'random-number', 'sample-tool']);
  assert.deepEqual(ids(rows), ['sample-tool', 'random-number', 'zeta-tool']);
});

test('random work surface reports success, keeps the last result on a validation error and logs both', () => {
  const originalFormData = globalThis.FormData;
  const originalDocument = globalThis.document;
  const recorded = [];
  const nodes = {
    form: { values: new Map([['minimum', '7'], ['maximum', '7'], ['count', '1']]), addEventListener(type, listener) { assert.equal(type, 'submit'); this.submit = listener; }, querySelector() { return null; } },
    ready: { hidden: false },
    error: { hidden: true, textContent: '' },
    panel: { hidden: true },
    heading: { textContent: '' },
    summary: { textContent: '' },
    list: { children: [], replaceChildren(...children) { this.children = children; } },
    historyStatus: { textContent: '' }
  };
  const selectors = new Map([
    ['[data-random-form]', nodes.form],
    ['[data-random-ready]', nodes.ready],
    ['[data-random-error]', nodes.error],
    ['[data-random-result]', nodes.panel],
    ['[data-random-heading]', nodes.heading],
    ['[data-random-summary]', nodes.summary],
    ['[data-random-list]', nodes.list],
    ['[data-history-status]', nodes.historyStatus]
  ]);
  class FakeFormData {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values.get(name) ?? null; }
    has(name) { return this.values.has(name); }
  }
  globalThis.FormData = FakeFormData;
  globalThis.document = { createElement() { return { textContent: '' }; } };
  const memory = new Map();
  const storage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, value); recorded.push(value); },
    removeItem(key) { memory.delete(key); }
  };
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true, writable: true });
  try {
    initRandomNumber({
      dataset: { toolId: 'random-number' },
      querySelector(selector) { return selectors.get(selector) ?? null; },
      querySelectorAll() { return []; }
    });
    const event = { preventDefaultCalled: false, preventDefault() { this.preventDefaultCalled = true; } };
    nodes.form.submit(event);
    assert.equal(event.preventDefaultCalled, true);
    assert.equal(nodes.ready.hidden, true);
    assert.equal(nodes.error.hidden, true);
    assert.equal(nodes.panel.hidden, false);
    assert.equal(nodes.heading.textContent, 'Result');
    assert.match(nodes.summary.textContent, /1 generated · inclusive range 7 to 7/);
    assert.deepEqual(nodes.list.children.map((item) => item.textContent), ['7']);
    assert.equal(nodes.historyStatus.textContent, 'Run added to session history.');

    nodes.form.values.set('count', '0');
    nodes.form.submit({ preventDefault() {} });
    assert.equal(nodes.error.hidden, false);
    assert.match(nodes.error.textContent, /Count must be at least 1/);
    assert.equal(nodes.panel.hidden, false, 'the previous result stays visible beside the error');
    assert.deepEqual(nodes.list.children.map((item) => item.textContent), ['7']);
    assert.equal(nodes.historyStatus.textContent, 'Validation error added to session history.');

    const stored = JSON.parse(memory.get('toolhub:session-history'));
    assert.equal(stored.version, 2);
    assert.equal(stored.items[0].status, 'success');
    assert.equal(stored.items[0].summary, '7–7 ×1');
    assert.match(stored.items[0].outcome, /^1 generated · inclusive range 7 to 7/);
    assert.equal(stored.items[1].status, 'validation-error');
    assert.equal(stored.items[1].summary, '7–7 ×0');
    assert.equal(stored.items[1].outcome, 'Count must be at least 1');
    assert.equal(typeof stored.items[0].durationMs, 'number');
    assert.equal('input' in stored.items[0], false, 'raw input must not be retained in session history');
    assert.equal('input' in stored.items[1], false, 'raw input must not be retained in session history');
  } finally {
    globalThis.FormData = originalFormData;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
    else delete globalThis.sessionStorage;
  }
});

test('random work surface falls back to in-memory history and warns when sessionStorage is unavailable', () => {
  const originalFormData = globalThis.FormData;
  const originalDocument = globalThis.document;
  const nodes = {
    form: { values: new Map([['minimum', '1'], ['maximum', '10'], ['count', '1']]), addEventListener(type, listener) { this.submit = listener; }, querySelector() { return null; } },
    ready: { hidden: false },
    error: { hidden: true, textContent: '' },
    panel: { hidden: true },
    heading: { textContent: '' },
    summary: { textContent: '' },
    list: { children: [], replaceChildren(...children) { this.children = children; } },
    drawer: { hidden: true },
    historyList: { children: [], replaceChildren(...children) { this.children = children; } },
    historyEmpty: { hidden: false },
    historyMeta: { textContent: '' },
    historyPanel: { hidden: false },
    historyToggle: { addEventListener() {}, getAttribute() { return 'true'; }, setAttribute() {}, textContent: '' },
    historyClear: { addEventListener() {} },
    historyStatus: { textContent: '' }
  };
  const selectors = new Map([
    ['[data-random-form]', nodes.form],
    ['[data-random-ready]', nodes.ready],
    ['[data-random-error]', nodes.error],
    ['[data-random-result]', nodes.panel],
    ['[data-random-heading]', nodes.heading],
    ['[data-random-summary]', nodes.summary],
    ['[data-random-list]', nodes.list],
    ['[data-history-drawer]', nodes.drawer],
    ['[data-history-list]', nodes.historyList],
    ['[data-history-empty]', nodes.historyEmpty],
    ['[data-history-meta]', nodes.historyMeta],
    ['[data-history-panel]', nodes.historyPanel],
    ['[data-history-toggle]', nodes.historyToggle],
    ['[data-history-clear]', nodes.historyClear],
    ['[data-history-status]', nodes.historyStatus]
  ]);
  class FakeFormData {
    constructor(form) { this.values = form.values; }
    get(name) { return this.values.get(name) ?? null; }
    has(name) { return this.values.has(name); }
  }
  globalThis.FormData = FakeFormData;
  globalThis.document = {
    createElement() {
      return { className: '', textContent: '', dateTime: '', append() {}, addEventListener() {}, setAttribute() {} };
    }
  };
  const blockedStorage = { getItem() { return null; }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { value: blockedStorage, configurable: true, writable: true });
  try {
    initRandomNumber({
      dataset: { toolId: 'random-number' },
      querySelector(selector) { return selectors.get(selector) ?? null; },
      querySelectorAll() { return []; }
    });
    assert.equal(nodes.drawer.hidden, false, 'the drawer still appears with an in-memory fallback');
    assert.match(nodes.historyStatus.textContent, /memory|lost/i);

    nodes.form.submit({ preventDefault() {} });
    assert.equal(nodes.historyList.children.length, 1, 'the run is recorded in memory even though sessionStorage is blocked');
    assert.match(nodes.historyMeta.textContent, /memory|lost/i);
  } finally {
    globalThis.FormData = originalFormData;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
    else delete globalThis.sessionStorage;
  }
});

test('mobile rail and keyboard-safe enhancement contracts stay explicit', async () => {
  const css = await readSource('client/src/style.css');
  const randomSource = await readSource('client/src/tools/random-number.js');
  const toolsIndexSource = await readSource('client/src/tools/index.js');
  const shellSource = await readSource('client/src/shell.js');
  assert.match(css, /@media\(max-width:900px\)\{\s*\.app\{grid-template-columns:1fr\}\s*\.rail\{position:static;height:auto;overflow:visible\}/);
  assert.match(css, /\.split\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.doesNotMatch(randomSource, /\.focus\s*\(/);
  assert.doesNotMatch(toolsIndexSource, /\.focus\s*\(/);
  const focusCalls = shellSource.match(/\.focus\s*\(/g) ?? [];
  assert.equal(focusCalls.length, 1, 'the rail search shortcut is the only place that moves focus');
  assert.match(shellSource, /event\.preventDefault\(\);\s*input\.focus\(\);/);
  assert.match(randomSource, /historyStatus\.textContent\s*=/);
  assert.match(shellSource, /button\.addEventListener\('click'/);
});

test('detail enhancements ship hidden and announce politely', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const route of ['/tools/random-number', '/tools/sample-tool']) {
    const html = await (await fetch(base + route)).text();
    assert.match(html, /<button type="button" class="iconbtn" data-pin-toggle data-tool-id="[a-z-]+" aria-pressed="false" hidden>/);
    assert.match(html, /<button type="button" class="iconbtn" data-copy-link hidden>Copy link<\/button>/);
    assert.match(html, /data-pin-status aria-live="polite"/);
    assert.doesNotMatch(html, /aria-live="assertive"/);
  }
  const random = await (await fetch(base + '/tools/random-number')).text();
  assert.match(random, /<button type="reset" class="iconbtn" form="random-number-form">Reset<\/button>/);
  assert.match(random, /<form id="random-number-form" class="random-form" data-random-form/);
  assert.match(random, /<section class="drawer" aria-labelledby="run-history-heading" data-history-drawer hidden>/);
  assert.match(random, /data-history-toggle aria-expanded="true" aria-controls="run-history-body"/);
  assert.match(random, /data-history-empty>No runs in this tab yet/);
  assert.match(random, /data-history-status aria-live="polite"/);
  assert.match(random, /data-random-copy="values" hidden/);
  assert.match(random, /data-random-json-toggle aria-expanded="false" aria-controls="random-json" hidden/);
  assert.doesNotMatch(random, /onclick=|<script(?![^>]* src=)/i);
  const sample = await (await fetch(base + '/tools/sample-tool')).text();
  assert.doesNotMatch(sample, /type="reset"/);
});

test('versioned state adapters recover safely, cap history, and preserve inactive favorites', async () => {
  const {
    HISTORY_LIMIT,
    STATE_VERSION,
    addHistoryEntry,
    clearToolHistory,
    createStorageAdapter,
    emptyFavorites,
    emptyHistory,
    lastRunByTool,
    summarizeRuns,
    toggleFavorite,
    validFavoriteState,
    validHistoryState
  } = await import('../client/src/state-store.js');
  assert.equal(STATE_VERSION, 2);
  const memory = new Map();
  const storage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, value); },
    removeItem(key) { memory.delete(key); }
  };
  const historyStore = createStorageAdapter(storage, 'history', validHistoryState);
  const favoriteStore = createStorageAdapter(storage, 'favorites', validFavoriteState);
  assert.deepEqual(historyStore.read(emptyHistory), emptyHistory());
  for (const stale of ['{"version":1,"items":[]}', '{"version":999,"items":[]}', '{broken']) {
    memory.set('history', stale);
    assert.deepEqual(historyStore.read(emptyHistory), emptyHistory());
  }
  memory.set('favorites', '{"version":2,"items":[{"toolId":"sample-tool","createdAt":"2026-01-01T00:00:00.000Z"}]}');
  assert.deepEqual(favoriteStore.read(emptyFavorites).items.map(({ toolId }) => toolId), ['sample-tool']);
  memory.set('history', '{"version":2,"items":[]}');
  memory.set('favorites', '{"version":2,"items":"wrong"}');
  assert.deepEqual(historyStore.read(emptyHistory), emptyHistory());
  assert.deepEqual(favoriteStore.read(emptyFavorites), emptyFavorites());

  const base = { toolId: 'random-number', status: 'success', summary: '1–10 ×1', createdAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(validHistoryState({ version: 2, items: [base] }), true);
  assert.equal(validHistoryState({ version: 2, items: [{ ...base, durationMs: -1 }] }), false);
  assert.equal(validHistoryState({ version: 2, items: [{ ...base, durationMs: Number.POSITIVE_INFINITY }] }), false);
  assert.equal(validHistoryState({ version: 2, items: [{ ...base, outcome: 7 }] }), false);

  let history = emptyHistory();
  for (let index = 0; index < HISTORY_LIMIT + 2; index += 1) {
    history = addHistoryEntry(history, {
      toolId: index % 2 === 0 ? 'random-number' : 'sample-tool',
      status: index % 3 === 0 ? 'success' : index % 3 === 1 ? 'validation-error' : 'execution-error',
      summary: 'safe summary ' + index,
      outcome: 'outcome ' + index,
      durationMs: index,
      createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString()
    });
  }
  assert.equal(history.items.length, HISTORY_LIMIT);
  assert.equal(history.items[0].summary, 'safe summary 2');
  assert.equal(validHistoryState(history), true);
  assert.equal(historyStore.write(history), true);
  assert.deepEqual(historyStore.read(emptyHistory), history);

  const summary = summarizeRuns(history.items);
  assert.equal(summary.runs, HISTORY_LIMIT);
  assert.equal(summary.runs, summary.succeeded + summary.failed);
  assert.equal(summary.timed, HISTORY_LIMIT);
  assert.equal(summary.last, history.items[HISTORY_LIMIT - 1]);
  assert.equal(summarizeRuns([]).averageMs, null);
  assert.deepEqual([...lastRunByTool(history.items).keys()].sort(), ['random-number', 'sample-tool']);
  assert.equal(lastRunByTool(history.items).get('random-number').summary, 'safe summary 20');
  const cleared = clearToolHistory(history, 'random-number');
  assert.equal(cleared.items.every(({ toolId }) => toolId === 'sample-tool'), true);
  assert.equal(validHistoryState(cleared), true);

  let favorites = emptyFavorites();
  favorites = toggleFavorite(favorites, 'random-number', '2026-01-01T00:00:00.000Z');
  favorites = toggleFavorite(favorites, 'inactive-tool', '2026-01-02T00:00:00.000Z');
  assert.equal(validFavoriteState(favorites), true);
  assert.equal(favorites.items.some(({ toolId }) => toolId === 'inactive-tool'), true);
  favorites = toggleFavorite(favorites, 'random-number', '2026-01-03T00:00:00.000Z');
  assert.deepEqual(favorites.items.map(({ toolId }) => toolId), ['inactive-tool']);
  assert.equal(favoriteStore.write(favorites), true);

  const blockedSet = { getItem() { return null; }, setItem() { throw new Error('blocked'); }, removeItem() {} };
  const blockedGet = { getItem() { throw new Error('blocked'); }, setItem() {}, removeItem() {} };
  assert.equal(createStorageAdapter(blockedSet, 'history', validHistoryState), null);
  assert.equal(createStorageAdapter(blockedSet, 'favorites', validFavoriteState), null);

  const historyWithBlockedReads = createStorageAdapter(blockedGet, 'history', validHistoryState);
  const favoritesWithBlockedReads = createStorageAdapter(blockedGet, 'favorites', validFavoriteState);
  assert.deepEqual(historyWithBlockedReads.read(emptyHistory), emptyHistory());
  assert.deepEqual(favoritesWithBlockedReads.read(emptyFavorites), emptyFavorites());

  const availableHistoryAlongsideBlockedFavorites = createStorageAdapter(storage, 'history', validHistoryState);
  const blockedFavoritesAlongsideAvailableHistory = createStorageAdapter(blockedSet, 'favorites', validFavoriteState);
  assert.notEqual(availableHistoryAlongsideBlockedFavorites, null);
  assert.equal(blockedFavoritesAlongsideAvailableHistory, null);
  assert.deepEqual(availableHistoryAlongsideBlockedFavorites.read(emptyHistory), history);

  const blockedHistoryAlongsideAvailableFavorites = createStorageAdapter(blockedSet, 'history', validHistoryState);
  const availableFavoritesAlongsideBlockedHistory = createStorageAdapter(storage, 'favorites', validFavoriteState);
  assert.equal(blockedHistoryAlongsideAvailableFavorites, null);
  assert.notEqual(availableFavoritesAlongsideBlockedHistory, null);
  assert.deepEqual(availableFavoritesAlongsideBlockedHistory.read(emptyFavorites).items.map(({ toolId }) => toolId), ['inactive-tool']);
});

test('state rendering sources use safe DOM APIs without innerHTML', async () => {
  const sources = await Promise.all([
    'client/src/state-store.js',
    'client/src/format.js',
    'client/src/shell.js',
    'client/src/tools/random-number.js',
    'client/src/tools/index.js'
  ].map(readSource));
  for (const source of sources) assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|document\.write/);
  const [, , shellSource, toolSource] = sources;
  for (const source of [shellSource, toolSource]) {
    assert.match(source, /textContent/);
    assert.match(source, /replaceChildren/);
  }
});


function createFakeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    _attrs: new Map(),
    children: [],
    parentNode: null,
    _listeners: {},
    hidden: false,
    disabled: false,
    value: '',
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this.children.forEach((c) => { c.parentNode = null; }); this.children = []; },
    get className() { return this._attrs.get('class') || ''; },
    set className(v) { this._attrs.set('class', v); },
    classList: {
      add(...cls) { const set = new Set((el._attrs.get('class') || '').split(' ').filter(Boolean)); cls.forEach((c) => set.add(c)); el._attrs.set('class', [...set].join(' ')); },
      remove(...cls) { const set = new Set((el._attrs.get('class') || '').split(' ').filter(Boolean)); cls.forEach((c) => set.delete(c)); el._attrs.set('class', [...set].join(' ')); },
      contains(c) { return (el._attrs.get('class') || '').split(' ').includes(c); }
    },
    setAttribute(name, value) { this._attrs.set(name, String(value)); },
    getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; },
    hasAttribute(name) { return this._attrs.has(name); },
    append(...nodes) { nodes.forEach((n) => this.appendChild(n)); },
    appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this.children.push(node); node.parentNode = this; return node; },
    removeChild(node) { this.children = this.children.filter((c) => c !== node); node.parentNode = null; return node; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    insertBefore(node, ref) {
      if (node.parentNode) node.parentNode.removeChild(node);
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) this.children.push(node); else this.children.splice(idx, 0, node);
      node.parentNode = this;
      return node;
    },
    replaceChildren(...nodes) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; nodes.forEach((n) => this.appendChild(n)); },
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); },
    contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; },
    querySelector(selector) {
      const match = /^\[([a-zA-Z0-9-]+)\]$/.exec(selector.trim());
      if (!match) throw new Error('unsupported selector in test fake DOM: ' + selector);
      const attr = match[1];
      const search = (node) => {
        for (const child of node.children) {
          if (child.hasAttribute(attr)) return child;
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(this);
    },
    querySelectorAll(selector) {
      const match = /^\[([a-zA-Z0-9-]+)\]$/.exec(String(selector).trim());
      const attr = match ? match[1] : null;
      const results = [];
      const walk = (node) => {
        for (const child of node.children) {
          if (attr && child.hasAttribute(attr)) results.push(child);
          walk(child);
        }
      };
      walk(this);
      return results;
    }
  };
  return el;
}

function createFakeDocument() {
  const doc = createFakeElement('#document');
  doc.body = createFakeElement('body');
  doc.createElement = (tag) => createFakeElement(tag);
  return doc;
}

async function fire(el, type, evt = {}) {
  const handlers = el._listeners[type] || [];
  const event = { preventDefault() {}, target: el, ...evt };
  await Promise.all(handlers.map((fn) => fn(event)));
}

function buildPdfMakerSurface() {
  const surface = createFakeElement('section');
  const input = createFakeElement('input'); input.setAttribute('data-pdf-input', '');
  const drop = createFakeElement('div'); drop.setAttribute('data-pdf-drop', '');
  const work = createFakeElement('section'); work.setAttribute('data-pdf-work', ''); work.hidden = true;
  const body = createFakeElement('tbody'); body.setAttribute('data-pdf-files', '');
  const summary = createFakeElement('p'); summary.setAttribute('data-pdf-summary', '');
  const error = createFakeElement('div'); error.setAttribute('data-pdf-error', ''); error.hidden = true;
  const live = createFakeElement('p'); live.setAttribute('data-pdf-live', '');
  const convert = createFakeElement('button'); convert.setAttribute('data-pdf-convert', ''); convert.disabled = true;
  const clear = createFakeElement('button'); clear.setAttribute('data-pdf-clear', '');
  const results = createFakeElement('div'); results.setAttribute('data-pdf-results', ''); results.hidden = true;
  const resultSummary = createFakeElement('p'); resultSummary.setAttribute('data-pdf-result-summary', '');
  const zip = createFakeElement('button'); zip.setAttribute('data-pdf-zip', ''); zip.hidden = true;
  const finish = createFakeElement('button'); finish.setAttribute('data-pdf-finish', '');
  work.append(body, summary, error, live, convert, clear, results, resultSummary, zip, finish);
  surface.append(input, drop, work);
  return { surface, input, drop, work, body, summary, error, live, convert, clear, results, resultSummary, zip, finish };
}

const PDF_MAKER_ACCEPTED = {
  jobId: 'job-1',
  accessToken: 'token-1',
  status: 'queued',
  counts: { succeeded: 0, failed: 0 },
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  files: [
    { id: 'f1', name: 'alpha.docx', status: 'queued' },
    { id: 'f2', name: 'beta.pptx', status: 'queued' }
  ]
};

const PDF_MAKER_TICK1 = {
  ...PDF_MAKER_ACCEPTED,
  status: 'converting',
  counts: { succeeded: 1, failed: 0 },
  files: [
    { id: 'f1', name: 'alpha.docx', status: 'succeeded', downloadable: true },
    { id: 'f2', name: 'beta.pptx', status: 'converting' }
  ]
};

const PDF_MAKER_TICK2_TERMINAL = {
  ...PDF_MAKER_ACCEPTED,
  status: 'partial',
  counts: { succeeded: 1, failed: 1 },
  files: [
    { id: 'f1', name: 'alpha.docx', status: 'succeeded', downloadable: true },
    { id: 'f2', name: 'beta.pptx', status: 'failed', error: 'CONVERTER_FAILED' }
  ]
};

async function withPdfMakerDocument(run) {
  const previous = globalThis.document;
  globalThis.document = createFakeDocument();
  try {
    await run();
  } finally {
    globalThis.document = previous;
  }
}

test('pdf-maker keeps a succeeded row\'s download control stable across a later status-poll tick', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildPdfMakerSurface();
    let getCalls = 0;
    let midPollDownloadBtn = null;
    const fetchMock = async (url, opts) => {
      const method = opts?.method || 'GET';
      if (method === 'POST' && url === '/api/pdf-maker/jobs') return { ok: true, status: 200, json: async () => PDF_MAKER_ACCEPTED };
      if (method === 'GET' && url === '/api/pdf-maker/jobs/job-1') {
        getCalls += 1;
        if (getCalls === 1) return { ok: true, status: 200, json: async () => PDF_MAKER_TICK1 };
        midPollDownloadBtn = h.body.children[0].children[4].children[0];
        return { ok: true, status: 200, json: async () => PDF_MAKER_TICK2_TERMINAL };
      }
      throw new Error('unexpected fetch ' + method + ' ' + url);
    };
    initPdfMaker(h.surface, { fetch: fetchMock, delay: () => Promise.resolve() });
    h.input.files = [new File(['a'], 'alpha.docx'), new File(['b'], 'beta.pptx')];
    await fire(h.input, 'change');
    await fire(h.convert, 'click');

    assert.equal(getCalls, 2);
    assert.ok(midPollDownloadBtn, 'expected the first poll tick to have rendered a download control');
    assert.equal(h.body.children.length, 2);
    const f1Actions = h.body.children[0].children[4];
    assert.equal(f1Actions.children[0], midPollDownloadBtn, 'the download control for an already-succeeded file must not be recreated by a later poll tick');
    assert.equal(h.results.hidden, false);
    assert.match(h.resultSummary.textContent, /1 converted - 1 failed/);
  });
});

test('pdf-maker remove control exposes an accessible name that includes the file name', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildPdfMakerSurface();
    initPdfMaker(h.surface, { fetch: async () => { throw new Error('fetch should not be called'); }, delay: () => Promise.resolve() });
    h.input.files = [new File(['a'], 'alpha.docx'), new File(['b'], 'beta.pptx')];
    await fire(h.input, 'change');

    assert.equal(h.body.children.length, 2);
    const removeButtons = h.body.children.map((row) => row.children[4].children[0]);
    assert.equal(removeButtons[0].getAttribute('aria-label'), 'Remove alpha.docx');
    assert.equal(removeButtons[1].getAttribute('aria-label'), 'Remove beta.pptx');
  });
});

test('pdf-maker closes download actions once a job is reported expired mid-poll', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildPdfMakerSurface();
    let getCalls = 0;
    const fetchMock = async (url, opts) => {
      const method = opts?.method || 'GET';
      if (method === 'POST' && url === '/api/pdf-maker/jobs') return { ok: true, status: 200, json: async () => PDF_MAKER_ACCEPTED };
      if (method === 'GET' && url === '/api/pdf-maker/jobs/job-1') {
        getCalls += 1;
        if (getCalls === 1) return { ok: true, status: 200, json: async () => PDF_MAKER_TICK1 };
        return { ok: false, status: 410, json: async () => ({}) };
      }
      throw new Error('unexpected fetch ' + method + ' ' + url);
    };
    initPdfMaker(h.surface, { fetch: fetchMock, delay: () => Promise.resolve() });
    h.input.files = [new File(['a'], 'alpha.docx'), new File(['b'], 'beta.pptx')];
    await fire(h.input, 'change');
    await fire(h.convert, 'click');

    assert.equal(getCalls, 2);
    assert.equal(h.error.hidden, false);
    assert.match(h.error.textContent, /expired/i);
    assert.equal(h.results.hidden, true, 'result/download actions must close once the job is reported expired');
    for (const row of h.body.children) {
      for (const btn of row.children[4].children) {
        assert.notEqual(btn.textContent, 'Download PDF', 'no stale download control should remain visible after expiry');
      }
    }
    assert.equal(h.convert.disabled, false, 'the user must be able to retry conversion after an expired job is closed');
  });
});

function buildMdViewerSurface() {
  const surface = createFakeElement('section');
  const input = createFakeElement('input'); input.setAttribute('data-md-input', '');
  const drop = createFakeElement('div'); drop.setAttribute('data-md-drop', '');
  const error = createFakeElement('div'); error.setAttribute('data-md-error', ''); error.hidden = true;
  const live = createFakeElement('p'); live.setAttribute('data-md-live', '');
  const work = createFakeElement('section'); work.setAttribute('data-md-work', ''); work.hidden = true;
  const summary = createFakeElement('p'); summary.setAttribute('data-md-summary', '');
  const removeButton = createFakeElement('button'); removeButton.setAttribute('data-md-remove', '');
  const renderEl = createFakeElement('article'); renderEl.setAttribute('data-md-render', '');
  const backToTopButton = createFakeElement('button'); backToTopButton.setAttribute('data-md-back-to-top', '');
  const empty = createFakeElement('div'); empty.setAttribute('data-md-empty', '');
  work.append(summary, removeButton, renderEl, backToTopButton);
  surface.append(input, drop, error, live, work, empty);
  return { surface, input, drop, error, live, work, summary, removeButton, renderEl, backToTopButton, empty };
}

test('md-viewer reads a selected file immediately, without any network calls', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    initMdViewer(h.surface, { renderMarkdown: (text) => '<p>' + text + '</p>' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('md-viewer must not perform network requests'); };
    try {
      const file = new File(['# hello'], 'notes.md', { type: 'text/markdown' });
      h.input.files = [file];
      await fire(h.input, 'change');
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(h.work.hidden, false);
    assert.equal(h.empty.hidden, true);
    assert.equal(h.error.hidden, true);
    assert.match(h.summary.textContent, /notes\.md/);
    assert.match(h.live.textContent, /notes\.md rendered/);
  });
});

test('md-viewer rejects unsupported, empty and oversized files with a recoverable error', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    initMdViewer(h.surface, { renderMarkdown: (text) => '<p>' + text + '</p>' });

    h.input.files = [new File(['hi'], 'notes.txt')];
    await fire(h.input, 'change');
    assert.equal(h.error.hidden, false);
    assert.match(h.error.textContent, /only \.md and \.markdown/);
    assert.equal(h.work.hidden, true);
    assert.equal(h.empty.hidden, false);

    h.input.files = [new File([], 'empty.md')];
    await fire(h.input, 'change');
    assert.match(h.error.textContent, /empty/);

    h.input.files = [new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.md')];
    await fire(h.input, 'change');
    assert.match(h.error.textContent, /exceeds/);

    h.input.files = [new File(['# ok'], 'ok.md')];
    await fire(h.input, 'change');
    assert.equal(h.error.hidden, true);
    assert.equal(h.work.hidden, false);
    assert.match(h.summary.textContent, /ok\.md/);
  });
});

test('md-viewer surfaces a read failure and lets the user try another file', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    const readFile = () => Promise.reject(new Error('boom'));
    initMdViewer(h.surface, { readFile, renderMarkdown: (text) => '<p>' + text + '</p>' });
    h.input.files = [new File(['# hi'], 'notes.md')];
    await fire(h.input, 'change');
    assert.equal(h.error.hidden, false);
    assert.match(h.error.textContent, /could not be read/);
    assert.equal(h.work.hidden, true);
    assert.equal(h.empty.hidden, false);
  });
});

test('md-viewer discards a stale read when a newer file is selected before the old one resolves', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    const pending = [];
    const readFile = (file) => new Promise((resolve) => pending.push({ file, resolve }));
    initMdViewer(h.surface, { readFile, renderMarkdown: (text) => '<p>' + text + '</p>' });

    h.input.files = [new File(['first'], 'first.md')];
    const firstChange = fire(h.input, 'change');
    h.input.files = [new File(['second'], 'second.md')];
    const secondChange = fire(h.input, 'change');

    assert.equal(pending.length, 2);
    pending[1].resolve('second content');
    await secondChange;
    assert.match(h.summary.textContent, /second\.md/);

    pending[0].resolve('first content');
    await firstChange;
    assert.match(h.summary.textContent, /second\.md/);
    assert.doesNotMatch(h.summary.textContent, /first\.md/);
  });
});

test('md-viewer\'s remove control clears rendered output, error and summary back to the empty state', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    initMdViewer(h.surface, { renderMarkdown: (text) => '<p>' + text + '</p>' });
    h.input.files = [new File(['# hi'], 'notes.md')];
    await fire(h.input, 'change');
    assert.equal(h.work.hidden, false);

    await fire(h.removeButton, 'click');
    assert.equal(h.work.hidden, true);
    assert.equal(h.empty.hidden, false);
    assert.equal(h.summary.textContent, '');
    assert.match(h.live.textContent, /removed/i);
  });
});

test('md-viewer accepts a dropped file and toggles the dragging indicator', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    initMdViewer(h.surface, { renderMarkdown: (text) => '<p>' + text + '</p>' });
    await fire(h.drop, 'dragenter');
    assert.equal(h.drop.classList.contains('is-dragging'), true);
    await fire(h.drop, 'drop', { dataTransfer: { files: [new File(['# hi'], 'dropped.md')] } });
    assert.equal(h.drop.classList.contains('is-dragging'), false);
    assert.match(h.summary.textContent, /dropped\.md/);
    assert.equal(h.work.hidden, false);
  });
});

test('md-viewer floating button scrolls smoothly to the top after a file is rendered', async () => {
  await withPdfMakerDocument(async () => {
    const h = buildMdViewerSurface();
    const scrollCalls = [];
    initMdViewer(h.surface, {
      renderMarkdown: (text) => '<p>' + text + '</p>',
      scrollTo: (options) => scrollCalls.push(options)
    });

    h.input.files = [new File(['# hi'], 'long-notes.md')];
    await fire(h.input, 'change');
    assert.equal(h.work.hidden, false);

    await fire(h.backToTopButton, 'click');
    assert.deepEqual(scrollCalls, [{ top: 0, behavior: 'smooth' }]);
  });
});

test('md-viewer renders an accessible floating back-to-top control', () => {
  const html = mdViewerModule.render();
  assert.match(html, /class="md-back-to-top"/);
  assert.match(html, /data-md-back-to-top/);
  assert.match(html, /aria-label="Back to top"/);
});

test('md-viewer code block copy button announces success and failure', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const container = document.createElement('div');
    container.innerHTML = mdViewerModule.render();
    const surface = container.firstElementChild;
    let writeResult = () => Promise.resolve();
    const clipboard = { writeText: () => writeResult() };
    initMdViewer(surface, { clipboard, renderMarkdown: () => '<pre><code>const x = 1;</code></pre>' });

    const input = surface.querySelector('[data-md-input]');
    const file = new File(['ignored'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copyButton = surface.querySelector('[data-md-copy]');
    assert.ok(copyButton, 'expected a copy button on the rendered code block');
    const live = surface.querySelector('[data-md-live]');

    copyButton.dispatchEvent(new dom.window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(live.textContent, /copied/i);

    writeResult = () => Promise.reject(new Error('denied'));
    copyButton.dispatchEvent(new dom.window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(live.textContent, /failed/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('md-viewer copy button announces failure instead of throwing when the Clipboard API is unavailable', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const container = document.createElement('div');
    container.innerHTML = mdViewerModule.render();
    const surface = container.firstElementChild;
    initMdViewer(surface, { clipboard: undefined, renderMarkdown: () => '<pre><code>const x = 1;</code></pre>' });

    const input = surface.querySelector('[data-md-input]');
    const file = new File(['ignored'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copyButton = surface.querySelector('[data-md-copy]');
    assert.ok(copyButton, 'expected a copy button on the rendered code block');
    const live = surface.querySelector('[data-md-live]');

    assert.doesNotThrow(() => copyButton.dispatchEvent(new dom.window.Event('click')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(live.textContent, /failed/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('md-viewer copy button announces failure when writeText is not a function', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const container = document.createElement('div');
    container.innerHTML = mdViewerModule.render();
    const surface = container.firstElementChild;
    initMdViewer(surface, { clipboard: {}, renderMarkdown: () => '<pre><code>const x = 1;</code></pre>' });

    const input = surface.querySelector('[data-md-input]');
    const file = new File(['ignored'], 'notes.md', { type: 'text/markdown' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new dom.window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const copyButton = surface.querySelector('[data-md-copy]');
    const live = surface.querySelector('[data-md-live]');

    assert.doesNotThrow(() => copyButton.dispatchEvent(new dom.window.Event('click')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(live.textContent, /failed/i);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('renderMarkdownToSafeHtml strips scripts, handlers and dangerous URLs while preserving safe Markdown', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const markdown = [
    '# Title',
    '',
    'Some **bold** and *italic* text with `inline code`.',
    '',
    '- one',
    '- two',
    '',
    '> a quote',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '[safe link](https://example.com "t")',
    '',
    '![safe image](https://example.com/a.png)',
    '',
    '[xss](javascript:alert(1))',
    '',
    '![xss](data:text/html,evil)',
    '',
    '![relative](./local.png)',
    '',
    '[relative](./notes.md)',
    '',
    '<script>alert(1)</script>',
    '',
    '<img src=x onerror="alert(1)">',
    '',
    '<iframe src="https://evil.example"></iframe>',
    '',
    '<div onclick="alert(1)">click me</div>',
    '',
    '<a href="https://raw.example">raw external link</a>',
    '',
    '<a href="https://raw.example" rel="opener" target="_self">raw link with unsafe rel</a>',
    '',
    '<a href=" https://raw.example" rel="opener" target="_self">raw link with leading space href</a>',
    ''
  ].join('\n');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('renderMarkdownToSafeHtml must not perform network requests'); };
  let html;
  try {
    html = renderMarkdownToSafeHtml(markdown, { window: dom.window });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>inline code<\/code>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-js"/);
  assert.match(html, /<a href="https:\/\/example\.com" title="t" rel="noopener noreferrer" target="_blank">safe link<\/a>/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="safe image" loading="lazy">/);

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror=/i);
  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /<iframe/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /data:text\/html/i);
  assert.doesNotMatch(html, /href="\.\/notes\.md"/);
  assert.doesNotMatch(html, /src="\.\/local\.png"/);
  assert.match(html, /md-unsupported-ref/);

  const rawLink = html.match(/<a[^>]*>raw external link<\/a>/)?.[0];
  assert.ok(rawLink, 'expected the raw HTML external link to survive sanitization');
  assert.match(rawLink, /rel="noopener noreferrer"/);
  assert.match(rawLink, /target="_blank"/);

  const rawLinkUnsafeRel = html.match(/<a[^>]*>raw link with unsafe rel<\/a>/)?.[0];
  assert.ok(rawLinkUnsafeRel, 'expected the raw HTML link with an unsafe rel to survive sanitization');
  assert.match(rawLinkUnsafeRel, /rel="noopener noreferrer"/);
  assert.match(rawLinkUnsafeRel, /target="_blank"/);
  assert.doesNotMatch(rawLinkUnsafeRel, /rel="opener"/);
  assert.doesNotMatch(rawLinkUnsafeRel, /target="_self"/);

  const rawLinkLeadingSpaceHref = html.match(/<a[^>]*>raw link with leading space href<\/a>/)?.[0];
  assert.ok(rawLinkLeadingSpaceHref, 'expected the raw HTML link with a leading-space href to survive sanitization');
  assert.match(rawLinkLeadingSpaceHref, /rel="noopener noreferrer"/);
  assert.match(rawLinkLeadingSpaceHref, /target="_blank"/);
  assert.doesNotMatch(rawLinkLeadingSpaceHref, /rel="opener"/);
  assert.doesNotMatch(rawLinkLeadingSpaceHref, /target="_self"/);
});

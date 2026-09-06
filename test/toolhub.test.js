import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { validateRegistry } from '../tools/registry.js';

test('routes, assets, headers and safe errors', async (t) => {
  const server = createApp({ logger: { info() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/dashboard', '/tools', '/tools/sample-tool']) { const r = await fetch(base + route); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /default-src/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); }
  assert.match(await (await fetch(base + '/')).text(), /Sample Tool/);
  assert.match(await (await fetch(base + '/tools/sample-tool')).text(), /Read-only example/);
  for (const route of ['/tools/missing', '/tools/bad--id', '/assets/missing.css', '/assets/%252e%252e/server/app.js']) { const r = await fetch(base + route); assert.equal(r.status, 404); assert.doesNotMatch(await r.text(), /server\/app|Error:|node_modules/); }
  assert.equal((await fetch(base + '/tools/%73ample-tool')).status, 200);
  assert.equal((await fetch(base + '/tools/%2573ample-tool')).status, 404);
  const home = await (await fetch(base + '/')).text(); const cssPath = home.match(/href="\/(assets\/[^"]+\.css)"/)[1];
  const css = await fetch(base + '/' + cssPath); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
  const favicon = await fetch(base + '/favicon.ico'); assert.equal(favicon.status, 200); assert.match(favicon.headers.get('content-type'), /image\/x-icon/);
  const assetsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/client/assets');
  const outsideFile = path.resolve(assetsRoot, '../outside-root-secret.css');
  const outsideLink = path.join(assetsRoot, 'outside-root-link.css');
  fs.rmSync(outsideLink, { force: true }); fs.writeFileSync(outsideFile, 'secret'); fs.symlinkSync(outsideFile, outsideLink, 'file');
  t.after(() => { fs.rmSync(outsideLink, { force: true }); fs.rmSync(outsideFile, { force: true }); });
  assert.equal((await fetch(base + '/assets/outside-root-link.css')).status, 404);
});

test('search input is escaped', async (t) => { const server = createApp({ logger: { info() {} } }).listen(0); await once(server, 'listening'); t.after(() => server.close()); const html = await (await fetch(`http://127.0.0.1:${server.address().port}/?q=${encodeURIComponent('<script>x</script>')}`)).text(); assert.doesNotMatch(html, /<script>x<\/script>/); assert.match(html, /&lt;script&gt;/); });
test('registry rejects invalid, duplicate and incomplete tools', () => { const module = { render() { return ''; } }; assert.throws(() => validateRegistry([{ id: 'Bad', name: 'x', description: 'x', tags: [], active: true, module }])); assert.throws(() => validateRegistry([{ id: 'a', name: 'x', description: 'x', tags: [], active: true, module }, { id: 'a', name: 'x', description: 'x', tags: [], active: true, module }])); assert.throws(() => validateRegistry([{ id: 'a', active: true, module }])); });

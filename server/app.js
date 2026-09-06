import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { registrations, validateRegistry, toolIdPattern } from '../tools/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shell({ title, requestId, current = '', body, assets }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ToolHub</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/${assets.css}"></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="/">ToolHub</a><nav aria-label="Primary"><a href="/dashboard"${current === 'dashboard' ? ' aria-current="page"' : ''}>Dashboard</a><a href="/tools"${current === 'tools' ? ' aria-current="page"' : ''}>Tools</a></nav></header><main id="main">${body}</main><footer>Request ID: <code>${escapeHtml(requestId)}</code></footer><script type="module" src="/${assets.js}"></script></body></html>`;
}

export function createApp({ tools = registrations, mode = 'development', logger = console } = {}) {
  const active = validateRegistry(tools);
  let manifest;
  try {
    const built = JSON.parse(fs.readFileSync(path.join(root, 'build/client/.vite/manifest.json'), 'utf8'))['src/main.js'];
    manifest = { css: built.css[0], js: built.file };
  } catch {
    throw Object.assign(new Error('built client assets are missing; run npm run build'), { code: 'ASSET_MISSING' });
  }
  const assetRoot = path.join(root, 'build/client/assets');
  const assetRootReal = fs.realpathSync(assetRoot);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = performance.now();
    req.id = /^[A-Za-z0-9_-]{1,80}$/.test(req.get('x-request-id') || '') ? req.get('x-request-id') : crypto.randomUUID();
    res.set({ 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Request-ID': req.id });
    res.on('finish', () => logger.info?.(JSON.stringify({ requestId: req.id, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - started) })));
    next();
  });
  const cache = (kind) => mode === 'production' && kind === 'asset' ? 'public, max-age=31536000, immutable' : 'no-cache';
  app.get('/favicon.ico', (req, res) => res.set('Cache-Control', cache('html')).type('image/x-icon').sendFile(path.join(root, 'build/client/favicon.ico')));
  app.use('/assets', (req, res, next) => {
    const rawPath = req.url.split('?')[0];
    if (rawPath.includes('\\') || /%25|%2f|%5c/i.test(rawPath)) return next();
    let decodedPath; try { decodedPath = decodeURIComponent(rawPath); } catch { return next(); }
    if (decodedPath.includes('%') || decodedPath.includes('\\') || decodedPath.split('/').some((part) => part === '..' || part.startsWith('.'))) return next();
    const candidate = path.resolve(assetRoot, `.${decodedPath}`);
    if (!candidate.startsWith(`${assetRoot}${path.sep}`)) return next();
    let realPath; try { realPath = fs.realpathSync(candidate); } catch { return next(); }
    if (!realPath.startsWith(`${assetRootReal}${path.sep}`)) return next();
    let stat; try { stat = fs.statSync(realPath); } catch { return next(); }
    if (!stat.isFile()) return next();
    res.set('Cache-Control', cache('asset')).sendFile(realPath, (error) => { if (error && !res.headersSent) next(error); });
  });
  const dashboard = (req, res) => {
    const q = String(req.query.q || '').normalize('NFKC').trim().toLowerCase();
    const shown = active.filter((t) => !q || [t.name, t.description, ...t.tags].some((v) => v.toLowerCase().includes(q)));
    const cards = shown.length ? shown.map((t) => `<article class="card"><h2>${escapeHtml(t.name)}</h2><p>${escapeHtml(t.description)}</p><p>${t.tags.map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join(' ')}</p><a href="/tools/${t.id}">Open ${escapeHtml(t.name)}</a></article>`).join('') : '<p role="status">No tools match your search.</p>';
    const body = `<h1>ToolHub Dashboard</h1><form role="search"><label for="q">Search tools</label><input id="q" name="q" value="${escapeHtml(req.query.q || '')}"><button>Search</button></form><section class="grid" aria-label="Available tools">${cards}</section>`;
    res.set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Dashboard', requestId: req.id, current: 'dashboard', body, assets: manifest }));
  };
  app.get(['/', '/dashboard'], dashboard);
  app.get('/tools', (req, res) => res.set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Tools', requestId: req.id, current: 'tools', assets: manifest, body: `<h1>All Tools</h1><div class="grid">${active.map((t) => `<article class="card"><h2>${escapeHtml(t.name)}</h2><p>${escapeHtml(t.description)}</p><a href="/tools/${t.id}">Open</a></article>`).join('')}</div>` })));
  app.get('/tools/:toolId', (req, res, next) => {
    const id = req.params.toolId.normalize('NFKC');
    if (!toolIdPattern.test(id) || /%|[\\/.]/.test(id)) return next();
    const tool = active.find((t) => t.id === id); if (!tool) return next();
    const body = `<nav aria-label="Breadcrumb"><a href="/tools">Tools</a> / ${escapeHtml(tool.name)}</nav><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(tool.description)}</p>${tool.module.render({ requestId: req.id })}`;
    res.set('Cache-Control', cache('html')).type('html').send(shell({ title: tool.name, requestId: req.id, current: 'tools', body, assets: manifest }));
  });
  app.all(/.*/, (req, res) => res.status(404).set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Not found', requestId: req.id, assets: manifest, body: '<h1>Page not found</h1><p>The requested resource is unavailable.</p>' })));
  return app;
}

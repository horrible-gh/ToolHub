import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { registrations, validateRegistry, toolIdPattern } from '../tools/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function searchTools(tools, value) {
  const raw = String(value ?? '');
  const query = raw.normalize('NFKC').trim().toLowerCase();
  const matches = tools.filter((tool) => !query || [tool.name, tool.description, ...tool.tags]
    .some((field) => String(field).normalize('NFKC').toLowerCase().includes(query)));
  return { raw, query, matches };
}

function renderSearchForm(raw, action) {
  return `<form class="tool-search" role="search" action="${action}"><label for="q">Search by name, description, or tag</label><div><input id="q" name="q" value="${escapeHtml(raw)}"><button>Search</button></div></form>`;
}

function renderToolResults({ tools, query, total, clearPath, format }) {
  if (total === 0) return '<p class="empty-state" role="status">No active tools are registered.</p>';
  if (tools.length === 0) return `<div class="empty-state" role="status"><p>No tools match your search.</p><p><a href="${clearPath}">Clear search and show all tools</a></p></div>`;
  const tags = (tool) => tool.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ');
  if (format === 'table') {
    const rows = tools.map((tool) => `<tr><th scope="row"><a href="/tools/${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</a></th><td>${escapeHtml(tool.description)}</td><td>${tags(tool)}</td><td><code>${escapeHtml(tool.id)}</code></td></tr>`).join('');
    return `<div class="tool-table-wrap"><table class="tool-table"><caption>${query ? `${tools.length} matching active tools` : `${total} active tools`}</caption><thead><tr><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Tags</th><th scope="col">ID</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  const items = tools.map((tool) => `<li><a href="/tools/${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</a><span>${escapeHtml(tool.description)}</span><span class="tool-tags">${tags(tool)}</span></li>`).join('');
  return `<ul class="tool-results" aria-label="${query ? 'Matching tools' : 'Active tools'}">${items}</ul>`;
}

function shell({ title, requestId, current = '', currentTool = '', body, assets, tools }) {
  const toolLinks = tools.map((tool) => `<a href="/tools/${escapeHtml(tool.id)}"${currentTool === tool.id ? ' aria-current="page"' : ''}>${escapeHtml(tool.name)}</a>`).join('');
  const rail = `<aside class="tool-rail" aria-label="ToolHub navigation"><a class="brand" href="/">ToolHub</a><nav aria-label="Primary"><a href="/dashboard"${current === 'dashboard' ? ' aria-current="page"' : ''}>Dashboard</a><div class="rail-tools"><span class="rail-heading">Tools</span>${toolLinks}</div><a href="/tools"${current === 'tools' ? ' aria-current="page"' : ''}>All Tools</a></nav></aside>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ToolHub</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/${assets.css}"></head><body><a class="skip" href="#main">Skip to content</a><div class="workbench">${rail}<div class="workbench-content"><main id="main">${body}</main><footer>Request ID: <code>${escapeHtml(requestId)}</code></footer></div></div><script type="module" src="/${assets.js}"></script></body></html>`;
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
    const result = searchTools(active, req.query.q);
    const body = `<header class="dashboard-summary"><p class="eyebrow">Workspace overview</p><h1>Find the right tool</h1><p><strong>${active.length}</strong> active ${active.length === 1 ? 'tool' : 'tools'} available.</p><a class="all-tools-link" href="/tools">Browse all tools</a></header>${renderSearchForm(result.raw, req.path)}<section class="tool-discovery" aria-labelledby="tool-results-heading"><h2 id="tool-results-heading">${result.query ? 'Search results' : 'Start exploring'}</h2>${renderToolResults({ tools: result.matches, query: result.query, total: active.length, clearPath: req.path, format: 'summary' })}</section>`;
    res.set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Dashboard', requestId: req.id, current: 'dashboard', body, assets: manifest, tools: active }));
  };
  app.get(['/', '/dashboard'], dashboard);
  app.get('/tools', (req, res) => {
    const result = searchTools(active, req.query.q);
    const body = `<h1>All Tools</h1><p>Compare every active tool and open its detail page.</p>${renderSearchForm(result.raw, '/tools')}<section class="tool-discovery" aria-labelledby="tool-results-heading"><h2 id="tool-results-heading">${result.query ? 'Search results' : 'Active tools'}</h2>${renderToolResults({ tools: result.matches, query: result.query, total: active.length, clearPath: '/tools', format: 'table' })}</section>`;
    res.set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Tools', requestId: req.id, current: 'tools', assets: manifest, tools: active, body }));
  });
  app.get('/tools/:toolId', (req, res, next) => {
    const id = req.params.toolId.normalize('NFKC');
    if (!toolIdPattern.test(id) || /%|[\\/.]/.test(id)) return next();
    const tool = active.find((t) => t.id === id); if (!tool) return next();
    const enhancements = `<section class="tool-enhancements" data-tool-id="${escapeHtml(tool.id)}" aria-label="Tool preferences"><button type="button" data-favorite-toggle aria-pressed="false" hidden>Add to favorites</button><span class="visually-hidden" data-favorite-status aria-live="polite"></span>${tool.module.render({ requestId: req.id })}</section>`;
    const body = `<nav aria-label="Breadcrumb"><a href="/tools">Tools</a> / ${escapeHtml(tool.name)}</nav><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(tool.description)}</p>${enhancements}`;
    res.set('Cache-Control', cache('html')).type('html').send(shell({ title: tool.name, requestId: req.id, currentTool: tool.id, body, assets: manifest, tools: active }));
  });
  app.all(/.*/, (req, res) => res.status(404).set('Cache-Control', cache('html')).type('html').send(shell({ title: 'Not found', requestId: req.id, assets: manifest, tools: active, body: '<h1>Page not found</h1><p>The requested resource is unavailable.</p>' })));
  return app;
}

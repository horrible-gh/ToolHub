import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPdfMaker } from './pdf-maker.js';
import { registrations, validateRegistry, toolIdPattern, groupTools, tagCounts, toolIcon, closestToolId } from '../tools/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

export function filterTools(tools, { q, tag } = {}) {
  const rawQuery = String(q ?? '');
  const rawTag = String(tag ?? '');
  const query = normalize(rawQuery);
  const tagQuery = normalize(rawTag);
  const matches = tools.filter((tool) => {
    const textMatch = !query || [tool.name, tool.description, tool.id, ...tool.tags].some((field) => normalize(field).includes(query));
    const tagMatch = !tagQuery || tool.tags.some((value) => normalize(value) === tagQuery);
    return textMatch && tagMatch;
  });
  return { rawQuery, rawTag, query, tag: tagQuery, matches };
}

function railSearch(rawQuery) {
  return '<form class="railsearch" role="search" action="/tools" method="get">' +
    '<span class="railsearch-icon" aria-hidden="true">&#9906;</span>' +
    '<label class="visually-hidden" for="rail-search">Search tools</label>' +
    `<input id="rail-search" name="q" type="search" autocomplete="off" placeholder="Search tools" value="${escapeHtml(rawQuery)}" data-rail-search>` +
    '<kbd class="railsearch-kbd" aria-hidden="true" data-rail-kbd hidden>Ctrl K</kbd>' +
    '<button class="railsearch-submit" type="submit">Search</button></form>';
}

function railItem(tool, currentTool) {
  const current = currentTool === tool.id ? ' aria-current="page"' : '';
  return `<li class="rail-item" data-rail-item data-tool-id="${escapeHtml(tool.id)}" data-tool-name="${escapeHtml(tool.name)}">` +
    `<a href="/tools/${escapeHtml(tool.id)}"${current}><span class="ico" aria-hidden="true">${escapeHtml(toolIcon(tool))}</span>` +
    `<span class="rail-name">${escapeHtml(tool.name)}</span>` +
    '<span class="star" data-rail-star hidden aria-hidden="true">&#9733;</span></a></li>';
}

function renderRail({ tools, total, current, currentTool, requestId, rawQuery }) {
  const groups = groupTools(tools).map(({ group, items }, index) => {
    const id = `rail-group-${index}`;
    return `<h2 class="rgroup" id="${id}">${escapeHtml(group)} <span class="n">${items.length}</span></h2>` +
      `<ul class="rail-list" aria-labelledby="${id}">${items.map((tool) => railItem(tool, currentTool)).join('')}</ul>`;
  }).join('');
  const pinned = '<h2 class="rgroup" id="rail-group-pinned" data-rail-pinned-heading hidden>Pinned <span class="n" data-rail-pinned-count>0</span></h2>' +
    '<ul class="rail-list" aria-labelledby="rail-group-pinned" data-rail-pinned hidden></ul>';
  const browse = '<h2 class="rgroup" id="rail-group-browse">Browse</h2>' +
    `<ul class="rail-list" aria-labelledby="rail-group-browse"><li><a href="/dashboard"${current === 'dashboard' ? ' aria-current="page"' : ''}><span class="ico" aria-hidden="true">&#8962;</span><span class="rail-name">Home</span></a></li>` +
    `<li><a href="/tools"${current === 'tools' ? ' aria-current="page"' : ''}><span class="ico" aria-hidden="true">&#9636;</span><span class="rail-name">All tools</span></a></li></ul>`;
  const empty = tools.length === 0
    ? '<p class="rail-empty">No active tools are registered.</p>'
    : '<p class="rail-empty" data-rail-empty hidden>No tools match that search.</p>';
  return '<aside class="rail" aria-label="ToolHub navigation">' +
    '<a class="brand" href="/"><span class="mk" aria-hidden="true">TH</span>ToolHub</a>' +
    railSearch(rawQuery) +
    `<nav class="rail-nav" aria-label="Tools">${pinned}${groups}${empty}</nav>` +
    `<nav class="rail-browse" aria-label="Primary">${browse}</nav>` +
    `<p class="railfoot">Request ID: <code>${escapeHtml(requestId)}</code><span class="railfoot-line">${total} registered &middot; ${tools.length} active</span></p></aside>`;
}

function renderTopbar(crumbs, actions = '') {
  const parts = crumbs.map((crumb) => {
    const label = crumb.mono ? `<code>${escapeHtml(crumb.label)}</code>` : escapeHtml(crumb.label);
    return crumb.href ? `<a href="${escapeHtml(crumb.href)}">${label}</a>` : `<span aria-current="page">${label}</span>`;
  });
  return '<div class="topbar"><nav class="crumb" aria-label="Breadcrumb">' +
    parts.join('<span class="crumb-sep" aria-hidden="true">/</span>') +
    `</nav><span class="spacer"></span><div class="topbar-actions">${actions}</div></div>`;
}

function shell({ title, requestId, current = '', currentTool = '', body, topbar, assets, tools, total, rawQuery = '' }) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${escapeHtml(title)} &middot; ToolHub</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/${assets.css}"></head><body>` +
    '<a class="skip" href="#main">Skip to content</a><div class="app">' +
    renderRail({ tools, total, current, currentTool, requestId, rawQuery }) +
    `<div class="content">${topbar}<main id="main" class="pane">${body}</main></div></div>` +
    `<script type="module" src="/${assets.js}"></script></body></html>`;
}

function statCard(label, value, detail, { valueAttr = '', detailAttr = '', text = false } = {}) {
  return `<div class="stat"><p class="k">${label}</p><p class="v${text ? ' v-text' : ''}"${valueAttr ? ' ' + valueAttr : ''}>${value}</p><p class="s"${detailAttr ? ' ' + detailAttr : ''}>${detail}</p></div>`;
}

function renderHome({ active, total }) {
  const inactive = total - active.length;
  const stats = '<div class="statrow">' +
    statCard('Registered tools', String(active.length), `${active.length} active &middot; ${inactive} inactive`) +
    statCard('Runs this session', '0', '0 succeeded &middot; 0 failed', { valueAttr: 'data-stat-runs', detailAttr: 'data-stat-runs-detail' }) +
    statCard('Last run', 'None yet', 'Run a tool to start the session log.', { valueAttr: 'data-stat-last', detailAttr: 'data-stat-last-detail', text: true }) +
    statCard('Average run', '&mdash;', 'No timed runs yet', { valueAttr: 'data-stat-average', detailAttr: 'data-stat-average-detail', text: true }) +
    '</div>';
  const resume = '<h2 class="sectitle" id="resume-heading">Pick up where you left off <span class="rule" aria-hidden="true"></span></h2>' +
    '<div class="card"><table class="tbl" aria-labelledby="resume-heading" data-resume-table hidden>' +
    '<thead><tr><th scope="col">Tool</th><th scope="col">Arguments</th><th scope="col">Result</th><th scope="col">When</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>' +
    '<tbody data-resume-body></tbody></table>' +
    '<p class="empty-row" data-resume-empty>No runs recorded in this browser session yet. Open a tool from the rail to start one.</p></div>';
  return `<h1>Workbench</h1><p class="lede">Pick a tool in the rail and run it right here. The rail never leaves, so switching tools never costs a page you have to find again.</p>${stats}${resume}` +
    '<p class="summary">Run history and pins stay in this browser. Nothing about a run is sent to the server.</p>';
}

function renderToolsTable({ total, matched, query, tag }) {
  if (total === 0) return '<div class="card"><p class="empty-row" role="status">No active tools are registered.</p></div>';
  if (matched.length === 0) {
    return '<div class="card"><div class="empty-row" role="status"><p>No tools match your search.</p>' +
      '<p><a href="/tools">Clear search and show all tools</a></p></div></div>';
  }
  const rows = matched.map((tool) => {
    const tags = tool.tags.map((value) => `<a class="tag" href="/tools?tag=${encodeURIComponent(value)}">${escapeHtml(value)}</a>`).join('');
    return `<tr data-tool-row data-tool-id="${escapeHtml(tool.id)}" data-tool-name="${escapeHtml(tool.name)}">` +
      `<td class="col-star"><button type="button" class="starbtn" data-pin-toggle data-tool-id="${escapeHtml(tool.id)}" aria-pressed="false" hidden><span class="starmark" aria-hidden="true">&#9734;</span><span class="visually-hidden">Pin ${escapeHtml(tool.name)}</span></button></td>` +
      `<th scope="row"><a class="nm" href="/tools/${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</a><span class="dsc">${escapeHtml(tool.description)}</span></th>` +
      `<td>${tags}</td><td class="mono">${escapeHtml(tool.id)}</td>` +
      '<td class="mono" data-tool-lastused>&mdash;</td>' +
      `<td class="go"><a href="/tools/${escapeHtml(tool.id)}">Open &rarr;</a></td></tr>`;
  }).join('');
  const caption = query || tag ? `${matched.length} matching active tools` : `${total} active tools`;
  return '<div class="card"><table class="tbl" data-tools-table>' +
    `<caption class="visually-hidden">${escapeHtml(caption)}</caption>` +
    '<thead><tr><th scope="col" class="col-star"><span class="visually-hidden">Pinned</span></th>' +
    '<th scope="col">Tool</th><th scope="col">Tags</th><th scope="col">ID</th><th scope="col">Last used</th>' +
    '<th scope="col"><span class="visually-hidden">Open</span></th></tr></thead>' +
    `<tbody>${rows}</tbody></table></div>`;
}

function renderTools({ active, result }) {
  const chipHref = (tag) => {
    const params = new URLSearchParams();
    if (result.rawQuery) params.set('q', result.rawQuery);
    if (tag) params.set('tag', tag);
    const query = params.toString();
    return query ? `/tools?${query}` : '/tools';
  };
  const chips = [`<a class="chip${result.tag ? '' : ' on'}" href="${escapeHtml(chipHref(''))}">All ${active.length}</a>`]
    .concat(tagCounts(active).map(({ tag, count }) => {
      const on = result.tag === normalize(tag) ? ' on' : '';
      return `<a class="chip${on}" href="${escapeHtml(chipHref(tag))}"${on ? ' aria-current="page"' : ''}>#${escapeHtml(tag)} ${count}</a>`;
    }))
    .join('');
  const filters = `<div class="filters">${chips}<span class="spacer"></span>` +
    '<label class="sortlabel" for="tools-sort" data-tools-sort-label hidden>Sort</label>' +
    '<select id="tools-sort" data-tools-sort hidden><option value="name">Name</option><option value="recent">Recently used</option><option value="pinned">Pinned first</option></select></div>';
  const lede = result.query || result.tag
    ? `${result.matches.length} of ${active.length} tools match`
    : `${active.length} ${active.length === 1 ? 'tool' : 'tools'} · ${active.length} active`;
  return `<h1>All tools</h1><p class="lede">${escapeHtml(lede)}</p>${filters}` +
    renderToolsTable({ total: active.length, matched: result.matches, query: result.query, tag: result.tag }) +
    '<p class="summary">Search and tag chips combine with AND. The same table keeps working as tools are added.</p>';
}

function renderDetail(tool, requestId) {
  const tags = tool.tags.map((value) => `<span class="tag">${escapeHtml(value)}</span>`).join('');
  return `<h1>${escapeHtml(tool.name)}</h1><p class="lede">${escapeHtml(tool.description)} ${tags}</p>` +
    `<div class="tool-surface" data-tool-surface data-tool-id="${escapeHtml(tool.id)}">${tool.module.render({ requestId })}</div>`;
}

function detailActions(tool) {
  const reset = typeof tool.module.formId === 'string'
    ? `<button type="reset" class="iconbtn" form="${escapeHtml(tool.module.formId)}">Reset</button>`
    : '';
  return `<button type="button" class="iconbtn" data-pin-toggle data-tool-id="${escapeHtml(tool.id)}" aria-pressed="false" hidden><span class="starmark" aria-hidden="true">&#9734;</span> <span data-pin-label>Pin</span></button>` +
    '<button type="button" class="iconbtn" data-copy-link hidden>Copy link</button>' + reset +
    '<span class="visually-hidden" data-pin-status aria-live="polite"></span>';
}

export function describeMissingPath(requestPath) {
  const segments = String(requestPath).split('/').filter(Boolean);
  const isToolPath = segments.length === 2 && segments[0] === 'tools' && /^[A-Za-z0-9_-]{1,64}$/.test(segments[1]);
  return isToolPath ? { label: '/tools/' + segments[1], toolId: segments[1].toLowerCase() } : { label: null, toolId: null };
}

function renderNotFound(missing, active) {
  const suggestion = missing.toolId ? closestToolId(missing.toolId, active) : null;
  const path = missing.label
    ? `<p class="mono empty-path">${escapeHtml(missing.label)}</p>`
    : '<p class="empty-path">That address is not a ToolHub page.</p>';
  const hint = suggestion
    ? `<p class="empty-hint">Closest match: <a href="/tools/${escapeHtml(suggestion.id)}">${escapeHtml(suggestion.name)}</a></p>`
    : '';
  return '<div class="empty"><p class="empty-mark" aria-hidden="true">&#9888;</p>' +
    '<h1>Nothing is registered at that path</h1>' +
    `${path}${hint}` +
    '<p class="empty-links"><a href="/tools">Browse all tools &rarr;</a><span class="crumb-sep" aria-hidden="true">&middot;</span><a href="/">Back to the workbench</a></p></div>';
}

export function createApp({ tools = registrations, mode = 'development', logger = console, pdfMakerConfig = loadConfig().pdfMaker, pdfMakerConverter, pdfMakerMarkdownConverter, pdfMakerStartCleanup = false, pdfMakerRemovePath } = {}) {
  const active = validateRegistry(tools);
  const total = tools.length;
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
  const pdfMaker = createPdfMaker({ config: pdfMakerConfig, converter: pdfMakerConverter, markdownConverter: pdfMakerMarkdownConverter, logger, startCleanup: pdfMakerStartCleanup, removePath: pdfMakerRemovePath });
  app.locals.pdfMaker = pdfMaker;
  app.use('/api/pdf-maker', pdfMaker.router);
  app.use('/api/pdf-maker', (error, req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'The upload request is too large.' } });
    return next(error);
  });
  const cache = (kind) => mode === 'production' && kind === 'asset' ? 'public, max-age=31536000, immutable' : 'no-cache';
  const page = (req, res, status, options) => res.status(status).set('Cache-Control', cache('html')).type('html')
    .send(shell({ requestId: req.id, assets: manifest, tools: active, total, ...options }));
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
  app.get(['/', '/dashboard'], (req, res) => page(req, res, 200, {
    title: 'Workbench',
    current: 'dashboard',
    rawQuery: String(req.query.q ?? ''),
    topbar: renderTopbar([{ label: 'Workbench' }]),
    body: renderHome({ active, total })
  }));
  app.get('/tools', (req, res) => {
    const result = filterTools(active, { q: req.query.q, tag: req.query.tag });
    page(req, res, 200, {
      title: 'All tools',
      current: 'tools',
      rawQuery: result.rawQuery,
      topbar: renderTopbar([{ label: 'Workbench', href: '/' }, { label: 'All tools' }]),
      body: renderTools({ active, result })
    });
  });
  app.get('/tools/:toolId', (req, res, next) => {
    const id = req.params.toolId.normalize('NFKC');
    if (!toolIdPattern.test(id) || /%|[\\/.]/.test(id)) return next();
    const tool = active.find((item) => item.id === id); if (!tool) return next();
    page(req, res, 200, {
      title: tool.name,
      currentTool: tool.id,
      rawQuery: String(req.query.q ?? ''),
      topbar: renderTopbar([{ label: 'All tools', href: '/tools' }, { label: tool.name }], detailActions(tool)),
      body: renderDetail(tool, req.id)
    });
  });
  app.all(/.*/, (req, res) => {
    const missing = describeMissingPath(req.path);
    page(req, res, 404, {
      title: 'Not found',
      topbar: renderTopbar([{ label: 'Workbench', href: '/' }, missing.label ? { label: missing.label, mono: true } : { label: 'Not found' }]),
      body: renderNotFound(missing, active)
    });
  });
  return app;
}

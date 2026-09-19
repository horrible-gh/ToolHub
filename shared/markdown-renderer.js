import { marked, Renderer } from 'marked';
import createDOMPurify from 'dompurify';

export const MARKDOWN_RESOURCE_POLICIES = Object.freeze({
  VIEWER: 'viewer',
  PDF: 'pdf'
});

const SAFE_LINK_SCHEME = /^(https?:|mailto:)/i;
const SAFE_IMAGE_SCHEME = /^https?:/i;
const EXTERNAL_LINK_SCHEME = /^https?:/i;
const PURIFY_ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const URL_ATTRS = new Set([
  'href',
  'src',
  'xlink:href',
  'poster',
  'background',
  'action',
  'formaction',
  'cite',
  'longdesc'
]);
const VIEWER_FORBIDDEN_TAGS = [
  'style',
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'link',
  'meta',
  'base',
  'svg',
  'math'
];
const PDF_FORBIDDEN_TAGS = [
  ...VIEWER_FORBIDDEN_TAGS,
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'frame',
  'frameset',
  'applet',
  'portal',
  'html',
  'head',
  'body',
  'title'
];
const PDF_RESOURCE_ATTRS = new Set([
  'src',
  'srcset',
  'imagesrcset',
  'imagesizes',
  'poster',
  'background',
  'data',
  'href',
  'xlink:href',
  'action',
  'formaction',
  'ping',
  'manifest',
  'archive',
  'codebase',
  'classid',
  'usemap',
  'profile',
  'attributionsrc'
]);

export const PDF_MARKDOWN_CSS = [
  'html { font-family: sans-serif; font-size: 11pt; line-height: 1.5; color: #1f2933; }',
  'body { margin: 18mm; }',
  '.md-render { max-width: 100%; overflow-wrap: break-word; }',
  '.md-render h1, .md-render h2, .md-render h3, .md-render h4, .md-render h5, .md-render h6 { margin: 1.2em 0 0.5em; line-height: 1.25; page-break-after: avoid; }',
  '.md-render p, .md-render ul, .md-render ol, .md-render blockquote, .md-render pre, .md-render table { margin: 0 0 0.9em; }',
  '.md-render ul, .md-render ol { padding-left: 1.8em; }',
  '.md-render blockquote { padding-left: 1em; border-left: 3px solid #9aa5b1; color: #52606d; }',
  '.md-render table { width: 100%; border-collapse: collapse; }',
  '.md-render th, .md-render td { padding: 0.35em 0.5em; border: 1px solid #bcccdc; text-align: left; vertical-align: top; }',
  '.md-render th { font-weight: bold; background: #f0f4f8; }',
  '.md-render pre { padding: 0.8em; border: 1px solid #d9e2ec; white-space: pre-wrap; overflow-wrap: anywhere; }',
  '.md-render code { font-family: monospace; }',
  '.md-render a { color: #1d4ed8; text-decoration: underline; }',
  '.md-render .md-unsupported-ref { color: #52606d; }'
].join('\n');

const isSafeUrl = (value, pattern) => (
  typeof value === 'string'
  && !CONTROL_CHARS.test(value)
  && pattern.test(value.trim())
);
const isSafeLinkUrl = (value) => isSafeUrl(value, SAFE_LINK_SCHEME);
const isSafeImageUrl = (value) => isSafeUrl(value, SAFE_IMAGE_SCHEME);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

function normalizePolicy(policy = MARKDOWN_RESOURCE_POLICIES.VIEWER) {
  if (policy !== MARKDOWN_RESOURCE_POLICIES.VIEWER && policy !== MARKDOWN_RESOURCE_POLICIES.PDF) {
    throw new TypeError('Unknown Markdown resource policy: ' + String(policy));
  }
  return policy;
}

function unsupportedReference(kind, text) {
  const label = text || 'unsupported source';
  return '<span class="md-unsupported-ref" title="Local and unsupported ' + kind
    + ' cannot be ' + (kind === 'images' ? 'loaded' : 'opened') + '">'
    + (kind === 'images' ? '[Image not shown: ' + escapeHtml(label) + ']' : text)
    + '</span>';
}

class SafeRenderer extends Renderer {
  constructor(policy) {
    super();
    this.resourcePolicy = policy;
  }

  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    if (!isSafeLinkUrl(href)) return unsupportedReference('links', text);
    const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
    return '<a href="' + escapeHtml(href) + '"' + titleAttr
      + ' rel="noopener noreferrer" target="_blank">' + text + '</a>';
  }

  image({ href, title, text, tokens }) {
    const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : (text || '');
    if (this.resourcePolicy === MARKDOWN_RESOURCE_POLICIES.PDF || !isSafeImageUrl(href)) {
      return unsupportedReference('images', alt);
    }
    const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
    return '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(alt) + '"'
      + titleAttr + ' loading="lazy">';
  }
}

function isSafeSrcset(value) {
  if (typeof value !== 'string' || CONTROL_CHARS.test(value)) return false;
  const candidates = value.split(',').map((candidate) => candidate.trim()).filter(Boolean);
  return candidates.length > 0 && candidates.every((candidate) => isSafeImageUrl(candidate.split(/\s+/, 1)[0]));
}

function isPdfResourceAttribute(name) {
  return PDF_RESOURCE_ATTRS.has(name) || name.includes('src');
}

function installPolicyHooks(purify, policy) {
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const attrName = String(data.attrName).toLowerCase();
    const tagName = String(node.tagName || '').toUpperCase();

    if (policy === MARKDOWN_RESOURCE_POLICIES.PDF) {
      if (attrName === 'style') {
        data.keepAttr = false;
        return;
      }
      if (attrName === 'href' && tagName === 'A') {
        if (!isSafeLinkUrl(data.attrValue)) data.keepAttr = false;
        return;
      }
      if (isPdfResourceAttribute(attrName) || URL_ATTRS.has(attrName)) data.keepAttr = false;
      return;
    }

    if (attrName === 'srcset') {
      if (!isSafeSrcset(data.attrValue)) data.keepAttr = false;
      return;
    }
    if (!URL_ATTRS.has(attrName)) return;
    if (tagName === 'IMG' && attrName === 'src') {
      if (!isSafeImageUrl(data.attrValue)) data.keepAttr = false;
      return;
    }
    if (!isSafeLinkUrl(data.attrValue)) data.keepAttr = false;
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    if (String(node.tagName || '').toUpperCase() !== 'A') return;
    const href = (node.getAttribute('href') || '').trim();
    if (!isSafeLinkUrl(href)) {
      node.removeAttribute('href');
      node.removeAttribute('rel');
      node.removeAttribute('target');
      return;
    }
    if (EXTERNAL_LINK_SCHEME.test(href)) {
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('target', '_blank');
    }
  });

  return purify;
}

const purifierCache = new WeakMap();

function getWindow(explicitWindow) {
  const win = explicitWindow || globalThis.window;
  if (!win || !win.document) throw new Error('Rendering Markdown requires a DOM window.');
  return win;
}

function getPurifier(win, policy) {
  let byPolicy = purifierCache.get(win);
  if (!byPolicy) {
    byPolicy = new Map();
    purifierCache.set(win, byPolicy);
  }
  let purify = byPolicy.get(policy);
  if (!purify) {
    purify = installPolicyHooks(createDOMPurify(win), policy);
    byPolicy.set(policy, purify);
  }
  return purify;
}

export function renderMarkdownToSafeHtml(markdown, {
  window: explicitWindow,
  policy: requestedPolicy = MARKDOWN_RESOURCE_POLICIES.VIEWER
} = {}) {
  const policy = normalizePolicy(requestedPolicy);
  const win = getWindow(explicitWindow);
  const renderer = new SafeRenderer(policy);
  const rawHtml = marked.parse(String(markdown ?? ''), { renderer });
  return getPurifier(win, policy).sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: PURIFY_ALLOWED_URI_REGEXP,
    ADD_ATTR: ['target'],
    FORBID_TAGS: policy === MARKDOWN_RESOURCE_POLICIES.PDF
      ? PDF_FORBIDDEN_TAGS
      : VIEWER_FORBIDDEN_TAGS,
    FORBID_ATTR: policy === MARKDOWN_RESOURCE_POLICIES.PDF ? ['style'] : []
  });
}

export function renderMarkdownToStandaloneHtml(markdown, {
  window: explicitWindow,
  title = 'Markdown document'
} = {}) {
  const content = renderMarkdownToSafeHtml(markdown, {
    window: explicitWindow,
    policy: MARKDOWN_RESOURCE_POLICIES.PDF
  });
  const csp = "default-src 'none'; img-src 'none'; media-src 'none'; font-src 'none'; "
    + "style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; "
    + "base-uri 'none'; form-action 'none'";
  return '<!doctype html>\n'
    + '<html><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="' + escapeHtml(csp) + '">'
    + '<title>' + escapeHtml(title) + '</title>'
    + '<style>' + PDF_MARKDOWN_CSS + '</style></head>'
    + '<body><article class="md-render">' + content + '</article></body></html>';
}
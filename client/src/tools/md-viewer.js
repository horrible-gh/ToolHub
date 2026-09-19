import { marked, Renderer } from 'marked';
import createDOMPurify from 'dompurify';
import { formatBytes } from './pdf-maker.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['md', 'markdown']);
const RENDERER_SAFE_SCHEME = /^(https?:|mailto:)/i;
const EXTERNAL_LINK_SCHEME = /^https?:/i;
const PURIFY_ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'poster', 'background', 'action', 'formaction', 'cite', 'longdesc']);
const FORBIDDEN_TAGS = ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base', 'svg', 'math'];

export function validateMdViewerFile(file) {
  if (!file) return { ok: false, message: 'No file was selected.' };
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, message: file.name + ': only .md and .markdown files are supported.' };
  if (file.size === 0) return { ok: false, message: file.name + ': the file is empty.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: file.name + ': file exceeds ' + formatBytes(MAX_FILE_BYTES) + '.' };
  return { ok: true };
}

const isSafeUrl = (href) => typeof href === 'string' && !CONTROL_CHARS.test(href) && RENDERER_SAFE_SCHEME.test(href.trim());
const escapeAttr = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class SafeRenderer extends Renderer {
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    if (!isSafeUrl(href)) return '<span class="md-unsupported-ref" title="Local and unsupported links cannot be opened">' + text + '</span>';
    const titleAttr = title ? ' title="' + escapeAttr(title) + '"' : '';
    return '<a href="' + escapeAttr(href) + '"' + titleAttr + ' rel="noopener noreferrer" target="_blank">' + text + '</a>';
  }
  image({ href, title, text, tokens }) {
    const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : (text || '');
    if (!isSafeUrl(href)) return '<span class="md-unsupported-ref" title="Local and unsupported images cannot be loaded">[Image not shown: ' + (alt || 'unsupported source') + ']</span>';
    const titleAttr = title ? ' title="' + escapeAttr(title) + '"' : '';
    return '<img src="' + escapeAttr(href) + '" alt="' + escapeAttr(alt) + '"' + titleAttr + ' loading="lazy">';
  }
}
const safeRenderer = new SafeRenderer();

const hookedInstances = new WeakSet();
function ensureHook(purify) {
  if (hookedInstances.has(purify)) return purify;
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    if (URL_ATTRS.has(String(data.attrName).toLowerCase()) && !isSafeUrl(data.attrValue)) data.keepAttr = false;
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && EXTERNAL_LINK_SCHEME.test((node.getAttribute('href') || '').trim())) {
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('target', '_blank');
    }
  });
  hookedInstances.add(purify);
  return purify;
}

let cachedPurify = null;
let cachedWindow = null;
function getPurify(win) {
  if (typeof createDOMPurify.sanitize === 'function') return ensureHook(createDOMPurify);
  if (!win) throw new Error('Rendering Markdown requires a DOM window.');
  if (cachedWindow !== win) {
    cachedPurify = createDOMPurify(win);
    cachedWindow = win;
  }
  return ensureHook(cachedPurify);
}

export function renderMarkdownToSafeHtml(markdown, { window: win } = {}) {
  const rawHtml = marked.parse(String(markdown ?? ''), { renderer: safeRenderer });
  return getPurify(win).sanitize(rawHtml, {
    ALLOWED_URI_REGEXP: PURIFY_ALLOWED_URI_REGEXP,
    ADD_ATTR: ['target'],
    FORBID_TAGS: FORBIDDEN_TAGS
  });
}

function addCopyButtons(container, announce, clipboard) {
  for (const block of container.querySelectorAll('pre')) {
    if (block.querySelector('[data-md-copy]')) continue;
    const code = block.querySelector('code');
    if (!code) continue;
    block.classList.add('md-code-block');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'md-copy-btn';
    button.textContent = 'Copy';
    button.setAttribute('data-md-copy', '');
    button.addEventListener('click', () => {
      let pending;
      try {
        if (!clipboard || typeof clipboard.writeText !== 'function') throw new Error('Clipboard API unavailable.');
        pending = clipboard.writeText(code.textContent);
      } catch {
        announce('Copying the code block failed.');
        return;
      }
      Promise.resolve(pending)
        .then(() => announce('Code block copied.'))
        .catch(() => announce('Copying the code block failed.'));
    });
    block.append(button);
  }
}

export function initMdViewer(surface, options = {}) {
  const readFile = options.readFile || ((file) => file.text());
  const renderMarkdown = options.renderMarkdown || ((text) => renderMarkdownToSafeHtml(text));
  const clipboard = options.clipboard || navigator.clipboard;
  const q = (selector) => surface.querySelector(selector);
  const input = q('[data-md-input]');
  const drop = q('[data-md-drop]');
  const work = q('[data-md-work]');
  const empty = q('[data-md-empty]');
  const summary = q('[data-md-summary]');
  const error = q('[data-md-error]');
  const live = q('[data-md-live]');
  const renderEl = q('[data-md-render]');
  const removeButton = q('[data-md-remove]');
  if (!input || !drop || !renderEl || !work || !empty) return;

  let requestSerial = 0;
  const setError = (message = '') => { error.textContent = message; error.hidden = !message; };
  const announce = (message) => { live.textContent = message; };
  const showEmpty = () => { work.hidden = true; empty.hidden = false; };
  const showWork = () => { work.hidden = false; empty.hidden = true; };

  const reset = () => {
    ++requestSerial;
    input.value = '';
    setError();
    renderEl.replaceChildren();
    if (summary) summary.textContent = '';
    showEmpty();
  };

  const load = async (file) => {
    const validation = validateMdViewerFile(file);
    const serial = ++requestSerial;
    setError();
    if (!validation.ok) {
      input.value = '';
      setError(validation.message);
      announce(validation.message);
      showEmpty();
      return;
    }
    announce('Reading ' + file.name + '.');
    let text;
    try {
      text = await readFile(file);
    } catch {
      if (serial !== requestSerial) return;
      setError(file.name + ': the file could not be read.');
      announce('The file could not be read.');
      showEmpty();
      return;
    }
    if (serial !== requestSerial) return;
    let html;
    try {
      html = renderMarkdown(text);
    } catch {
      setError(file.name + ': the file could not be rendered.');
      announce('The file could not be rendered.');
      showEmpty();
      return;
    }
    if (serial !== requestSerial) return;
    renderEl.innerHTML = html;
    addCopyButtons(renderEl, announce, clipboard);
    if (summary) summary.textContent = file.name + ' · ' + formatBytes(file.size);
    showWork();
    announce(file.name + ' rendered.');
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    return file ? load(file) : undefined;
  });
  for (const type of ['dragenter', 'dragover']) {
    drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('is-dragging'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove('is-dragging'); });
  }
  drop.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    return file ? load(file) : undefined;
  });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => { if (!drop.contains(event.target)) event.preventDefault(); });
  removeButton?.addEventListener('click', () => { reset(); announce('File removed.'); });

  showEmpty();
}

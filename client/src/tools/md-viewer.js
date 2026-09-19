import { formatBytes } from './pdf-maker.js';
import { renderMarkdownToSafeHtml } from '../../../shared/markdown-renderer.js';

export { renderMarkdownToSafeHtml };

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['md', 'markdown']);

export function validateMdViewerFile(file) {
  if (!file) return { ok: false, message: 'No file was selected.' };
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, message: file.name + ': only .md and .markdown files are supported.' };
  if (file.size === 0) return { ok: false, message: file.name + ': the file is empty.' };
  if (file.size > MAX_FILE_BYTES) return { ok: false, message: file.name + ': file exceeds ' + formatBytes(MAX_FILE_BYTES) + '.' };
  return { ok: true };
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
  const backToTopButton = q('[data-md-back-to-top]');
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
  backToTopButton?.addEventListener('click', () => {
    const scrollTo = options.scrollTo || ((scrollOptions) => window.scrollTo(scrollOptions));
    scrollTo({ top: 0, behavior: 'smooth' });
  });

  showEmpty();
}

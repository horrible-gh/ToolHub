import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  MARKDOWN_RESOURCE_POLICIES,
  PDF_MARKDOWN_CSS,
  renderMarkdownToSafeHtml as renderSharedMarkdown,
  renderMarkdownToStandaloneHtml as renderSharedStandalone
} from '../shared/markdown-renderer.js';
import {
  renderMarkdownToSafeHtml as renderServerMarkdown,
  renderMarkdownToStandaloneHtml as renderServerStandalone
} from '../server/markdown-renderer.js';

const makeWindow = () => new JSDOM('<!doctype html><html><body></body></html>').window;

test('shared Markdown renderer preserves the MD Viewer rendering and sanitizing contract', () => {
  const markdown = [
    '# Title',
    '',
    'Some **bold** and *italic* text.',
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
    '[safe link](https://example.com "t")',
    '',
    '![safe image](https://example.com/a.png)',
    '',
    '[relative](./notes.md)',
    '',
    '![relative](./local.png)',
    '',
    '<script>alert(1)</script>',
    '',
    '<iframe src="https://evil.example"></iframe>',
    '',
    '<div onclick="alert(1)">click me</div>',
    '',
    '<a href="https://raw.example" rel="opener" target="_self">raw external link</a>'
  ].join('\n');

  const html = renderSharedMarkdown(markdown, { window: makeWindow() });

  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<blockquote>/);
  assert.match(html, /<table>/);
  assert.match(html, /<a href="https:\/\/example\.com" title="t" rel="noopener noreferrer" target="_blank">safe link<\/a>/);
  assert.match(html, /<img src="https:\/\/example\.com\/a\.png" alt="safe image" loading="lazy">/);
  assert.match(html, /md-unsupported-ref/);
  assert.doesNotMatch(html, /<script|<iframe|onclick=|href="\.\/|src="\.\/local/iu);

  const rawLink = html.match(/<a[^>]*>raw external link<\/a>/)?.[0];
  assert.ok(rawLink);
  assert.match(rawLink, /rel="noopener noreferrer"/);
  assert.match(rawLink, /target="_blank"/);
});

test('Markdown resource policies are explicit and isolated across call order', () => {
  const win = makeWindow();
  const markdown = '![remote](https://example.com/a.png)\n\n<a href="https://example.com">link</a>';
  const renderViewer = () => renderSharedMarkdown(markdown, {
    window: win,
    policy: MARKDOWN_RESOURCE_POLICIES.VIEWER
  });
  const renderPdf = () => renderSharedMarkdown(markdown, {
    window: win,
    policy: MARKDOWN_RESOURCE_POLICIES.PDF
  });

  const viewerBefore = renderViewer();
  const pdfAfterViewer = renderPdf();
  const viewerAfterPdf = renderViewer();
  const pdfBeforeViewer = renderPdf();

  assert.equal(viewerAfterPdf, viewerBefore);
  assert.equal(pdfBeforeViewer, pdfAfterViewer);
  assert.match(viewerBefore, /<img /);
  assert.doesNotMatch(pdfAfterViewer, /<img /);
  assert.throws(
    () => renderSharedMarkdown('hello', { window: win, policy: 'relaxed' }),
    /Unknown Markdown resource policy/
  );
});

test('PDF policy removes every tested network and local resource-loading vector', () => {
  const markdown = [
    '![http](http://example.com/a.png)',
    '![https](https://example.com/a.png)',
    '![protocol](//example.com/a.png)',
    '![relative](images/a.png)',
    '![root](/images/a.png)',
    '![data](data:image/png;base64,AAAA)',
    '![blob](blob:https://example.com/id)',
    '![file](file:///etc/passwd)',
    '<img src="https://example.com/raw.png" srcset="https://example.com/a.png 1x">',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    '<style>@import "https://example.com/a.css"; @font-face { src: url(file:///font.woff); }</style>',
    '<div style="background:url(https://example.com/bg.png)">styled</div>',
    '<table background="file:///tmp/bg.png"><tr><td>cell</td></tr></table>',
    '<video src="https://example.com/v.mp4" poster="/poster.png"></video>',
    '<audio src="data:audio/mpeg;base64,AAAA"></audio>',
    '<picture><source srcset="//example.com/a.webp"><img src="blob:abc"></picture>',
    '<iframe src="file:///etc/passwd"></iframe>',
    '<object data="https://example.com/o"></object>',
    '<embed src="../local.bin">',
    '<a href="https://example.com/page" ping="https://tracker.example">safe anchor</a>'
  ].join('\n\n');

  const html = renderSharedMarkdown(markdown, {
    window: makeWindow(),
    policy: MARKDOWN_RESOURCE_POLICIES.PDF
  });

  assert.match(html, /md-unsupported-ref/);
  assert.match(html, /<a href="https:\/\/example\.com\/page" rel="noopener noreferrer" target="_blank">safe anchor<\/a>/);
  assert.doesNotMatch(html, /<(?:img|link|style|iframe|object|embed|video|audio|source|picture|track|frame|frameset|applet)\b/iu);
  assert.doesNotMatch(html, /\s(?:src|srcset|imagesrcset|poster|background|style|data|xlink:href|ping|manifest|archive|codebase|classid|usemap|attributionsrc)=/iu);
  assert.doesNotMatch(html, /url\s*\(|@import|@font-face/iu);
});

test('standalone Markdown HTML is UTF-8, self-contained, context-safe and conservative', () => {
  const html = renderSharedStandalone(
    '# Heading\n\n</article><img src="https://example.com/a.png"><script>alert(1)</script>',
    {
      window: makeWindow(),
      title: '</title><img src="file:///etc/passwd">'
    }
  );
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const style = document.querySelector('style')?.textContent || '';

  assert.match(html, /^<!doctype html>/);
  assert.equal(document.characterSet, 'UTF-8');
  assert.equal(document.querySelector('meta[charset]')?.getAttribute('charset'), 'utf-8');
  assert.equal(document.querySelector('article.md-render h1')?.textContent, 'Heading');
  assert.equal(document.title, '</title><img src="file:///etc/passwd">');
  assert.equal(document.querySelectorAll('article.md-render').length, 1);
  assert.equal(document.querySelector('img, script, link, iframe, object, embed, video, audio, source, picture'), null);
  assert.match(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '', /default-src 'none'/);
  assert.equal(style, PDF_MARKDOWN_CSS);
  assert.doesNotMatch(style, /--[\w-]+\s*:|url\s*\(|@import|@font-face/iu);
  assert.doesNotMatch(html, /data-md-copy|md-back-to-top|toolbar/iu);
});

test('Node Markdown adapter works without browser globals and does not request resources', () => {
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const hadDocument = Object.hasOwn(globalThis, 'document');
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  delete globalThis.window;
  delete globalThis.document;
  globalThis.fetch = () => {
    throw new Error('Markdown rendering must not fetch');
  };

  try {
    const viewerHtml = renderServerMarkdown('# Server\n\n![safe](https://example.com/a.png)');
    const pdfHtml = renderServerMarkdown(
      '<img src="https://example.com/a.png"><div style="background:url(file:///tmp/a)">x</div>',
      { policy: MARKDOWN_RESOURCE_POLICIES.PDF }
    );
    const standalone = renderServerStandalone('# Server', { title: 'Server title' });

    assert.match(viewerHtml, /<h1>Server<\/h1>/);
    assert.match(viewerHtml, /<img src="https:\/\/example\.com\/a\.png"/);
    assert.doesNotMatch(pdfHtml, /<img|style=|url\s*\(/iu);
    assert.match(standalone, /<article class="md-render"><h1>Server<\/h1>/);
    assert.equal(globalThis.window, undefined);
    assert.equal(globalThis.document, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
    if (hadDocument) globalThis.document = previousDocument;
    else delete globalThis.document;
  }
});
import { JSDOM } from 'jsdom';
import {
  renderMarkdownToSafeHtml as renderWithWindow,
  renderMarkdownToStandaloneHtml as renderStandaloneWithWindow
} from '../shared/markdown-renderer.js';

let markdownDom;

function getMarkdownWindow() {
  if (!markdownDom) markdownDom = new JSDOM('<!doctype html><html><body></body></html>');
  return markdownDom.window;
}

export function renderMarkdownToSafeHtml(markdown, options = {}) {
  return renderWithWindow(markdown, { ...options, window: getMarkdownWindow() });
}

export function renderMarkdownToStandaloneHtml(markdown, options = {}) {
  return renderStandaloneWithWindow(markdown, { ...options, window: getMarkdownWindow() });
}
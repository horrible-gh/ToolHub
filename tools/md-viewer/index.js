export function render() {
  return `<section class="md-viewer" aria-labelledby="md-viewer-heading">
    <div class="md-drop" data-md-drop>
      <div class="md-drop-icon" aria-hidden="true">MD</div>
      <h2 id="md-viewer-heading">View a Markdown file</h2>
      <p>Drop a Markdown file here, or choose one from your device. Everything is read and rendered locally in your browser.</p>
      <label class="md-choose" for="md-viewer-file">Choose file</label>
      <input class="visually-hidden" id="md-viewer-file" data-md-input type="file" accept=".md,.markdown">
      <p class="md-drop-help">MD and MARKDOWN &middot; up to 5 MB &middot; nothing is uploaded</p>
    </div>
    <p class="md-privacy">This tool never sends your file, its name, or its content to a server. Reading, rendering and sanitizing all happen locally in your browser, with no network requests.</p>
    <div class="alert" data-md-error role="alert" hidden></div>
    <p class="visually-hidden" data-md-live aria-live="polite" aria-atomic="true"></p>
    <section class="md-work" data-md-work hidden aria-labelledby="md-file-heading">
      <div class="md-toolbar">
        <div><h2 id="md-file-heading">Selected file</h2><p data-md-summary></p></div>
        <div class="md-actions">
          <button class="ghost" type="button" data-md-remove>Remove file</button>
        </div>
      </div>
      <div class="md-render-wrap">
        <article class="md-render" data-md-render aria-label="Rendered Markdown"></article>
      </div>
      <button class="md-back-to-top" type="button" data-md-back-to-top aria-label="Back to top">
        <span aria-hidden="true">↑</span> Top
      </button>
    </section>
    <div class="md-empty" data-md-empty>
      <p>No file selected yet. Drop a <code>.md</code> or <code>.markdown</code> file above, or choose one, to see it rendered here.</p>
    </div>
    <noscript><p class="alert">JavaScript is required to read and render Markdown files. Nothing is uploaded to a server.</p></noscript>
  </section>`;
}

export default { render };

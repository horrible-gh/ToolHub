export function render() {
  return `<section class="pdf-maker" aria-labelledby="pdf-maker-heading">
    <div class="pdf-drop" data-pdf-drop>
      <div class="pdf-drop-icon" aria-hidden="true">PDF</div>
      <h2 id="pdf-maker-heading">Convert documents to PDF</h2>
      <p>Drop Word or PowerPoint files here, or choose them from your device.</p>
      <label class="pdf-choose" for="pdf-maker-files">Choose files</label>
      <input class="visually-hidden" id="pdf-maker-files" data-pdf-input type="file" accept=".docx,.pptx" multiple>
      <p class="pdf-drop-help">DOCX and PPTX &middot; up to 10 files &middot; 25 MB each</p>
    </div>
    <p class="pdf-privacy">Files are converted on the server and automatically deleted after the retention period. Do not upload documents you are not permitted to process.</p>
    <div class="alert" data-pdf-error role="alert" hidden></div>
    <section class="pdf-work" data-pdf-work hidden aria-labelledby="pdf-selection-heading">
      <div class="pdf-toolbar">
        <div><h2 id="pdf-selection-heading">Selected files</h2><p data-pdf-summary>0 files &middot; 0 B</p></div>
        <div class="pdf-actions">
          <button class="ghost" type="button" data-pdf-clear>Clear selection</button>
          <button class="cta pdf-convert" type="button" data-pdf-convert disabled>Convert to PDF</button>
        </div>
      </div>
      <div class="pdf-table-wrap">
        <table class="tbl pdf-table">
          <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody data-pdf-files></tbody>
        </table>
      </div>
      <div class="pdf-results" data-pdf-results hidden>
        <p data-pdf-result-summary></p>
        <button class="cta pdf-zip" type="button" data-pdf-zip hidden>Download successful PDFs (.zip)</button>
        <button class="ghost" type="button" data-pdf-finish>Remove completed job</button>
      </div>
    </section>
    <p class="visually-hidden" data-pdf-live aria-live="polite" aria-atomic="true"></p>
    <noscript><p class="alert">JavaScript is required to upload and convert documents. Supported files are DOCX and PPTX.</p></noscript>
  </section>`;
}

export default { render };

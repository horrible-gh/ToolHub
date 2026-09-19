# ToolHub

ToolHub is an Express 5 web application with Vite-built assets and registry-driven Tool pages.

## Requirements and startup

Use Node.js 22 LTS and npm 10 or newer.

~~~sh
npm ci
npm run dev
~~~

npm run dev builds client assets, validates the Tool registry, and starts the server. Defaults are HOST=127.0.0.1, PORT=6412, NODE_ENV=development, and TOOLHUB_LOG_LEVEL=info. A successful JSON log includes the mode, bind host/port, registered Tool IDs, and URL. Set another port with PORT=7000 npm run dev (PowerShell: $env:PORT=7000; npm run dev).

Open http://127.0.0.1:6412/ or /dashboard, browse all entries at /tools, and try /tools/random-number. The page loads content-hashed CSS/JavaScript under /assets/ and /favicon.ico.

## Verification

~~~sh
npm run build
npm test
curl -i http://127.0.0.1:6412/
curl -i http://127.0.0.1:6412/tools
curl -i http://127.0.0.1:6412/tools/random-number
curl -i http://127.0.0.1:6412/favicon.ico
curl -i http://127.0.0.1:6412/tools/missing
~~~

If startup reports EADDRINUSE, stop the conflicting process or select another valid PORT. INVALID_ENV means the port is outside 1–65535 or not an integer. Run npm ci for missing dependencies and rerun npm run dev for missing build assets. TOOL_REGISTRATION identifies invalid IDs, duplicates, missing metadata, or missing module entrypoints.

New Tools use a kebab-case directory under tools/ and one registry entry containing id, name, description, tags, active, and a module with render(). No common router change is required. Interactive Tools also register a matching data-tool-id initializer in client/src/tools/index.js; keep DOM binding in that initializer and reusable domain logic outside it.
## PDF-Maker server conversion

The server exposes `POST /api/pdf-maker/jobs` (multipart field `files`), authenticated job status, individual PDF download, successful-result ZIP download, and explicit deletion under `/api/pdf-maker/jobs/:jobId`. Keep the returned access token in memory and send it as `Authorization: Bearer`; never put it in a URL or log. Results default to one-hour retention and are removed by the lifecycle cleanup runner.

LibreOffice headless must be installed separately and discoverable as `libreoffice`, or set `PDF_MAKER_LIBREOFFICE_PATH` to the executable. The service account needs read/write/delete permission only on `PDF_MAKER_STORAGE_ROOT`. That root must be outside the application source/static tree. Production isolation still requires an OS/container policy that runs ToolHub and LibreOffice as a low-privilege user, blocks unnecessary egress, and applies CPU/memory/process limits; startup intentionally does not claim to provide those OS controls.

Configuration is fail-closed. Supported variables are `PDF_MAKER_ALLOWED_EXTENSIONS` (must include `.docx,.pptx`), `PDF_MAKER_FILE_MAX_BYTES`, `PDF_MAKER_REQUEST_MAX_BYTES`, `PDF_MAKER_MAX_FILES`, `PDF_MAKER_TIMEOUT_MS`, `PDF_MAKER_CONCURRENCY`, `PDF_MAKER_QUEUE_LIMIT`, `PDF_MAKER_RETENTION_MS`, `PDF_MAKER_CLEANUP_INTERVAL_MS`, `PDF_MAKER_STORAGE_ROOT`, and `PDF_MAKER_LIBREOFFICE_PATH`. Invalid values stop startup with `INVALID_ENV`. Shutdown stops intake, waits for active conversions, and stops cleanup scheduling; retained jobs are removed by expiry after restart only when durable job metadata is introduced, so current deployments must use a single process and clear an abandoned isolation root operationally before restart.

## MD Viewer

MD Viewer reads and renders `.md`/`.markdown` files entirely in the browser: nothing is uploaded, no server endpoint is involved, and no external CDN is loaded. A single file up to 5 MB is read with `File.text()`, converted with the bundled `marked` parser, and sanitized with the bundled `DOMPurify` before insertion into the page. Relative links/images and unsupported URL schemes are shown as inert placeholders instead of being requested, and external links open with `rel="noopener noreferrer"`. Choosing a new file, or removing the current one, fully replaces any previous rendered output, error, and copy-button state.
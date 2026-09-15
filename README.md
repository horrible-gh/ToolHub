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
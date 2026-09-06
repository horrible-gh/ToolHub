# ToolHub

ToolHub is a read-only Express 5 web application with Vite-built assets and a registry-driven Tool page.

## Requirements and startup

Use Node.js 22 LTS and npm 10 or newer.

```sh
npm ci
npm run dev
```

`npm run dev` builds client assets, validates the Tool registry, and starts the server. Defaults are `HOST=127.0.0.1`, `PORT=8080`, `NODE_ENV=development`, and `TOOLHUB_LOG_LEVEL=info`. A successful JSON log includes the mode, bind host/port, registered Tool IDs, and URL. Set another port with `PORT=8090 npm run dev` (PowerShell: `$env:PORT=8090; npm run dev`).

Open `/` or `/dashboard`, follow the Sample Tool link from `/tools`, and confirm `/tools/sample-tool`. The page loads content-hashed CSS/JavaScript under `/assets/` and `/favicon.ico`.

## Verification

```sh
npm run build
npm test
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/tools/sample-tool
curl -i http://127.0.0.1:8080/ # copy the emitted /assets/ URL from the HTML
curl -i http://127.0.0.1:8080/favicon.ico
curl -i http://127.0.0.1:8080/tools/missing
```

If startup reports `EADDRINUSE`, stop the conflicting process or select another valid `PORT`. `INVALID_ENV` means the port is outside 1–65535 or not an integer. Run `npm ci` for missing dependencies and rerun `npm run dev` for missing build assets. `TOOL_REGISTRATION` identifies invalid IDs, duplicates, missing metadata, or missing module entrypoints.

New Tools use a kebab-case directory under `tools/` and one registry entry containing `id`, `name`, `description`, `tags`, `active`, and a module with `render()`. No common router change is required.

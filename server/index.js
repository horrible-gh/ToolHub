import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { validateRegistry, registrations } from '../tools/registry.js';

try {
  const config = loadConfig();
  const tools = validateRegistry(registrations);
  const app = createApp({ tools, mode: config.mode, pdfMakerConfig: config.pdfMaker, pdfMakerStartCleanup: true });
  const server = app.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'started', mode: config.mode, host: config.host, port: config.port, tools: tools.map((t) => t.id), url: `http://${config.host}:${config.port}/` })));
  server.on('error', (error) => { console.error(JSON.stringify({ event: 'startup_error', code: error.code || 'STARTUP_FAILURE', port: config.port })); process.exitCode = 1; });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    server.close(() => { void app.locals.pdfMaker.close().finally(() => { process.exitCode = 0; }); });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(JSON.stringify({ event: 'startup_error', code: error.code || 'STARTUP_FAILURE', message: error.message }));
  process.exitCode = 1;
}

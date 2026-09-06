import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { validateRegistry, registrations } from '../tools/registry.js';

try {
  const config = loadConfig();
  const tools = validateRegistry(registrations);
  const server = createApp({ tools, mode: config.mode }).listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'started', mode: config.mode, host: config.host, port: config.port, tools: tools.map((t) => t.id), url: `http://${config.host}:${config.port}/` })));
  server.on('error', (error) => { console.error(JSON.stringify({ event: 'startup_error', code: error.code || 'STARTUP_FAILURE', port: config.port })); process.exitCode = 1; });
} catch (error) {
  console.error(JSON.stringify({ event: 'startup_error', code: error.code || 'STARTUP_FAILURE', message: error.message }));
  process.exitCode = 1;
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const integer = (env, name, fallback, minimum, maximum) => {
  const raw = env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum) throw Object.assign(new Error(`${name} must be an integer from ${minimum} to ${maximum}`), { code: 'INVALID_ENV' });
  return Number(raw);
};
const inside = (candidate, parent) => candidate === parent || candidate.startsWith(parent + path.sep);
export function defaultLibreOfficePath(env = process.env, platform = process.platform) {
  if (env.PDF_MAKER_LIBREOFFICE_PATH) return env.PDF_MAKER_LIBREOFFICE_PATH;
  if (platform !== 'win32') return 'libreoffice';
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, 'LibreOffice', 'program', 'soffice.com');
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'soffice.com';
}

export function loadConfig(env = process.env) {
  const port = integer(env, 'PORT', 6412, 1, 65535);
  const fileMaxBytes = integer(env, 'PDF_MAKER_FILE_MAX_BYTES', 25 * 1024 * 1024, 1024, 250 * 1024 * 1024);
  const requestMaxBytes = integer(env, 'PDF_MAKER_REQUEST_MAX_BYTES', 75 * 1024 * 1024, fileMaxBytes, 500 * 1024 * 1024);
  const storageRoot = path.resolve(env.PDF_MAKER_STORAGE_ROOT || path.join(os.tmpdir(), 'toolhub-pdf-maker'));
  if (inside(storageRoot, projectRoot) || inside(projectRoot, storageRoot)) throw Object.assign(new Error('PDF_MAKER_STORAGE_ROOT must be outside the application source tree'), { code: 'INVALID_ENV' });
  const rawExtensions = env.PDF_MAKER_ALLOWED_EXTENSIONS || '.docx,.pptx';
  const allowedExtensions = [...new Set(rawExtensions.split(',').map((value) => value.trim().toLowerCase()))];
  if (!allowedExtensions.length || allowedExtensions.some((value) => !/^\.[a-z0-9]{1,10}$/.test(value)) || !allowedExtensions.includes('.docx') || !allowedExtensions.includes('.pptx')) throw Object.assign(new Error('PDF_MAKER_ALLOWED_EXTENSIONS must be a comma-separated list including .docx and .pptx'), { code: 'INVALID_ENV' });
  return {
    host: env.HOST || '127.0.0.1', port, mode: env.NODE_ENV || 'development', logLevel: env.TOOLHUB_LOG_LEVEL || 'info',
    pdfMaker: {
      allowedExtensions, fileMaxBytes, requestMaxBytes,
      maxFiles: integer(env, 'PDF_MAKER_MAX_FILES', 10, 1, 100),
      timeoutMs: integer(env, 'PDF_MAKER_TIMEOUT_MS', 120000, 1000, 30 * 60 * 1000),
      concurrency: integer(env, 'PDF_MAKER_CONCURRENCY', 2, 1, 32),
      queueLimit: integer(env, 'PDF_MAKER_QUEUE_LIMIT', 20, 1, 1000),
      retentionMs: integer(env, 'PDF_MAKER_RETENTION_MS', 60 * 60 * 1000, 1000, 7 * 24 * 60 * 60 * 1000),
      cleanupIntervalMs: integer(env, 'PDF_MAKER_CLEANUP_INTERVAL_MS', 60000, 1000, 24 * 60 * 60 * 1000),
      storageRoot,
      runtimeRoot: path.resolve(env.PDF_MAKER_RUNTIME_ROOT || (process.platform === 'win32' ? path.join(env.SystemRoot || 'C:\\Windows', 'Temp', 'toolhub-pdf-maker-runtime') : path.join(os.tmpdir(), 'toolhub-pdf-maker-runtime'))),
      engine: (() => { const value = env.PDF_MAKER_ENGINE || 'libreoffice'; if (!['office', 'libreoffice'].includes(value)) throw Object.assign(new Error('PDF_MAKER_ENGINE must be office or libreoffice'), { code: 'INVALID_ENV' }); return value; })(),
      libreOfficePath: defaultLibreOfficePath(env),
      powershellPath: env.PDF_MAKER_POWERSHELL_PATH || 'powershell.exe'
    }
  };
}

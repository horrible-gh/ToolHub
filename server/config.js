export function loadConfig(env = process.env) {
  const raw = env.PORT ?? '6412';
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    throw Object.assign(new Error('PORT must be an integer from 1 to 65535'), { code: 'INVALID_ENV' });
  }
  return { host: env.HOST || '127.0.0.1', port: Number(raw), mode: env.NODE_ENV || 'development', logLevel: env.TOOLHUB_LOG_LEVEL || 'info' };
}
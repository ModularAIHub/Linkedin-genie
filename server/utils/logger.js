const LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const METHOD_BY_LEVEL = {
  error: 'error',
  warn: 'warn',
  info: 'log',
  debug: 'debug'
};

const DEFAULT_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const ACTIVE_LEVEL = LEVEL_PRIORITY[DEFAULT_LEVEL] ?? LEVEL_PRIORITY.info;

const shouldLog = (level) => {
  const levelPriority = LEVEL_PRIORITY[level];
  if (levelPriority === undefined) return false;
  return levelPriority <= ACTIVE_LEVEL;
};

const normalizeMeta = (meta) => {
  if (!meta) return undefined;
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack
    };
  }
  if (typeof meta === 'object') return meta;
  return { value: String(meta) };
};

const writeLog = (level, message, meta) => {
  if (!shouldLog(level)) return;

  const method = METHOD_BY_LEVEL[level] || 'log';
  const timestamp = new Date().toISOString();
  const metaObject = normalizeMeta(meta);
  const useJson = process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production';

  if (useJson) {
    const payload = {
      ts: timestamp,
      level,
      service: process.env.SERVICE_NAME || 'linkedin-genie',
      message
    };
    if (metaObject) payload.meta = metaObject;
    console[method](JSON.stringify(payload));
    return;
  }

  if (metaObject) {
    console[method](`[${timestamp}] [${level.toUpperCase()}] ${message}`, metaObject);
    return;
  }

  console[method](`[${timestamp}] [${level.toUpperCase()}] ${message}`);
};

export const logger = {
  error: (message, meta) => writeLog('error', message, meta),
  warn: (message, meta) => writeLog('warn', message, meta),
  info: (message, meta) => writeLog('info', message, meta),
  debug: (message, meta) => writeLog('debug', message, meta)
};


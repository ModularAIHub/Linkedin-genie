import http from 'http';
import dotenv from 'dotenv';
import { logger } from './utils/logger.js';
import { startLinkedinScheduler, stopLinkedinScheduler } from './workers/linkedinScheduler.js';

dotenv.config({ quiet: true });

// Minimal health server so Render free web service tier keeps this process alive.
const PORT = process.env.PORT || 3099;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'linkedin-genie-worker', ts: Date.now() }));
}).listen(PORT, () => logger.info(`[LinkedIn Scheduler] Health server listening on ${PORT}`));

const shutdown = (signal) => {
  logger.info('[LinkedIn Scheduler] Shutdown signal received', { signal });
  stopLinkedinScheduler();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startLinkedinScheduler()
  .then(({ started }) => {
    if (started) {
      logger.info('[LinkedIn Scheduler] Process initialized');
      return;
    }

    logger.warn('[LinkedIn Scheduler] Process started but scheduler is disabled');
  })
  .catch((error) => {
    logger.error('[LinkedIn Scheduler] Failed to initialize process', error);
    process.exit(1);
  });

import express from 'express';
import Honeybadger from '@honeybadger-io/js';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Route imports
import oauthRoutes from './routes/oauth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/index.js';
import adminRoutes from './routes/admin.js';
import cleanupRoutes from './routes/cleanup.js';
import crossPostRoutes from './routes/crossPost.js';

// Middleware imports
import { requirePlatformLogin } from './middleware/requirePlatformLogin.js';
import { applyAgencyWorkspaceContext } from './middleware/agencyWorkspace.js';
import { captureRequestContext } from './utils/requestContext.js';
import errorHandler from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import internalAuth from './middleware/internalAuth.js';
import pool from './config/database.js';
import { runSchedulerTick } from './workers/linkedinScheduler.js';
import { runDailyContentPlanCronTick } from './workers/dailyContentPlanCron.js';

dotenv.config({ quiet: true });

// Honeybadger configuration
Honeybadger.configure({
  apiKey: process.env.HONEYBADGER_API_KEY || process.env.HONEYBADGER_KEY || '',
  environment: process.env.NODE_ENV || 'development'
});

const app = express();

// Honeybadger request handler (must be first middleware)
app.use(Honeybadger.requestHandler);
const PORT = process.env.PORT || 3004;
const READINESS_CHECK_INTERVAL_MS = Number.parseInt(process.env.READINESS_CHECK_INTERVAL_MS || '30000', 10);
const runSchedulerInApi = process.env.LINKEDIN_RUN_SCHEDULER_IN_API !== 'false';
const logAllowedCorsOrigins = process.env.CORS_LOG_ALLOWED_ORIGINS === 'true';
const linkedinRuntimeState = {
  database: {
    ok: false,
    lastCheckedAt: null,
    error: 'Database readiness not checked yet',
  },
  schedulerStarted: false,
};

const setLinkedInDatabaseReady = () => {
  linkedinRuntimeState.database.ok = true;
  linkedinRuntimeState.database.lastCheckedAt = new Date().toISOString();
  linkedinRuntimeState.database.error = null;
};

const setLinkedInDatabaseNotReady = (error) => {
  linkedinRuntimeState.database.ok = false;
  linkedinRuntimeState.database.lastCheckedAt = new Date().toISOString();
  linkedinRuntimeState.database.error = error?.message || String(error || 'Unknown database error');
};

const refreshLinkedInDatabaseReadiness = async () => {
  try {
    await pool.query('SELECT 1');
    setLinkedInDatabaseReady();
    return true;
  } catch (error) {
    setLinkedInDatabaseNotReady(error);
    return false;
  }
};

const getLinkedInHealthPayload = () => ({
  status: linkedinRuntimeState.database.ok ? 'OK' : 'DEGRADED',
  live: true,
  ready: linkedinRuntimeState.database.ok,
  service: 'LinkedIn Genie',
  timestamp: new Date().toISOString(),
  checks: {
    database: { ...linkedinRuntimeState.database },
    scheduler: {
      enabled: !process.env.VERCEL && runSchedulerInApi,
      started: linkedinRuntimeState.schedulerStarted,
    },
  },
});

const parseBooleanParam = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const getProvidedCronToken = (req) => {
  const authHeader = req.headers['authorization'] || '';
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return String(authHeader || req.query.secret || req.body?.secret || '').trim();
};

const isCronAuthorized = (req) => {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const providedToken = getProvidedCronToken(req);
  return Boolean(cronSecret) && Boolean(providedToken) && providedToken === cronSecret;
};

const maybeStartEmbeddedScheduler = async () => {
  if (process.env.VERCEL || !runSchedulerInApi || linkedinRuntimeState.schedulerStarted) {
    return;
  }

  if (!linkedinRuntimeState.database.ok) {
    logger.warn('[LinkedIn Scheduler] Embedded scheduler startup skipped because database is not ready', {
      database: linkedinRuntimeState.database,
    });
    return;
  }

  const { startLinkedinScheduler } = await import('./workers/linkedinScheduler.js');
  await startLinkedinScheduler({ enabled: true });
  linkedinRuntimeState.schedulerStarted = true;
};

const startLinkedInReadinessLoop = () => {
  const intervalMs =
    Number.isFinite(READINESS_CHECK_INTERVAL_MS) && READINESS_CHECK_INTERVAL_MS > 0
      ? READINESS_CHECK_INTERVAL_MS
      : 30000;

  const timer = setInterval(async () => {
    await refreshLinkedInDatabaseReadiness();
    try {
      await maybeStartEmbeddedScheduler();
    } catch (error) {
      logger.error('[LinkedIn Scheduler] Failed to start embedded scheduler in API process', error);
    }
  }, intervalMs);

  timer.unref?.();
};

// Basic middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  'https://suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://linkedin.suitegenie.in',
  'https://linkedin.suitgenie.in',
  'https://meta.suitegenie.in',
  'https://apilinkedin.suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweetapi.suitegenie.in',
  'https://metaapi.suitegenie.in'
];

const isAllowedCorsOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    if (!['http:', 'https:'].includes(protocol)) return false;

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    if (hostname === 'suitegenie.in' || hostname.endsWith('.suitegenie.in')) {
      return true;
    }

    if (hostname === 'suitgenie.in' || hostname.endsWith('.suitgenie.in')) {
      return true;
    }

    // Allow Vercel preview deployments for this team/project namespace.
    if (
      hostname.endsWith('.vercel.app') &&
      (hostname.includes('suitegenies-projects') || process.env.ALLOW_VERCEL_PREVIEWS === 'true')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  allowedOrigins.push(
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:3004',
    'http://localhost:3006'
  );
}
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (isAllowedCorsOrigin(origin)) {
      if (logAllowedCorsOrigins) {
        logger.debug('[CORS] Allowed origin', { origin });
      }
      return callback(null, true);
    } else {
      logger.warn('[CORS] Blocked origin', { origin });
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Cookie',
    'X-CSRF-Token',
    'x-csrf-token',
    'X-Selected-Account-Id',
    'x-selected-account-id',
    'X-Team-Id',
    'x-team-id',
    'X-Agency-Token',
    'x-agency-token',
    'X-Agency-Workspace-Id',
    'x-agency-workspace-id',
    'X-Agency-Tool',
    'x-agency-tool',
    'X-Agency-Target',
    'x-agency-target'
  ],
  exposedHeaders: ['Set-Cookie']
}));

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(applyAgencyWorkspaceContext);
app.use(captureRequestContext);

// Handle malformed JSON payloads early (before Honeybadger error middleware)
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    logger.warn('[request] Invalid JSON payload', {
      path: req.originalUrl,
      method: req.method,
      message: err?.message || 'Malformed JSON body',
    });
    return res.status(400).json({
      error: 'Invalid JSON payload',
      code: 'INVALID_JSON_PAYLOAD',
    });
  }
  return next(err);
});

// Health check
app.get('/health', (req, res) => {
  const payload = getLinkedInHealthPayload();
  res.status(200).json(payload);
});

app.get('/ready', (req, res) => {
  const payload = getLinkedInHealthPayload();
  res.status(payload.ready ? 200 : 503).json(payload);
});

// CSRF token endpoint
app.get('/api/csrf-token', (req, res) => {
  res.json({ 
    csrfToken: 'dummy-csrf-token',
    message: 'CSRF protection simplified for serverless deployment' 
  });
});

// OAuth routes (unprotected for login)
app.use('/api/oauth', oauthRoutes);
// Platform auth routes (callback, validate, refresh, logout)
app.use('/auth', authRoutes);
// Admin routes
app.use('/api/admin', adminRoutes);
// Cleanup routes
app.use('/api/cleanup', cleanupRoutes);

// Vercel Cron trigger for the LinkedIn post scheduler.
// Called every minute by Vercel (see server/vercel.json). Auth via CRON_SECRET.
// setInterval workers are killed between Vercel requests — this is their replacement.
app.post('/api/cron/scheduler', async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await runSchedulerTick();
    return res.json({ ok: true });
  } catch (error) {
    logger.error('[LinkedInSchedulerCron] Tick failed', error);
    return res.status(500).json({ ok: false, error: error?.message || 'unknown_error' });
  }
});

// QStash/Vercel cron trigger for daily strategy content generation.
// Generates up to 2 posts per eligible user strategy/day and then triggers ready-post notifications.
app.post('/api/cron/daily-content-plan', async (req, res) => {
  if (!isCronAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = {
      trigger: 'cron_endpoint_daily_content_plan',
      force: parseBooleanParam(req.query.force ?? req.body?.force, false),
      notify: parseBooleanParam(req.query.notify ?? req.body?.notify, true),
      userLimit: req.query.userLimit ?? req.body?.userLimit ?? null,
      queueTarget: req.query.queueTarget ?? req.body?.queueTarget ?? null,
      tickId: String(req.query.tickId || req.body?.tickId || '').trim() || null,
    };
    const result = await runDailyContentPlanCronTick(payload);
    return res.json({ ok: true, ...result });
  } catch (error) {
    logger.error('[LinkedInDailyContentPlanCron] Tick failed', error);
    return res.status(500).json({ ok: false, error: error?.message || 'unknown_error' });
  }
});

// Internal auth runs first on all remaining requests
app.use(internalAuth);

// Internal-only routes — protected by internalAuth, bypass requirePlatformLogin
// Tweet Genie calls this to cross-post tweets to LinkedIn
app.use('/api/internal', crossPostRoutes);

// All other API routes require platform login
app.use(requirePlatformLogin);
app.use('/api', apiRoutes);

// Root health check
app.get('/', (req, res) => {
  res.json({ 
    message: 'LinkedIn Genie backend is running.',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Honeybadger error handler
app.use(Honeybadger.errorHandler);

// Error handling with CORS headers
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  errorHandler(err, req, res, next);
});

// Export for Vercel serverless function
export default app;

// Only start server if not in serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    logger.info('LinkedIn Genie backend listening', { port: PORT });
  });

  await refreshLinkedInDatabaseReadiness();
  try {
    await maybeStartEmbeddedScheduler();
  } catch (error) {
    logger.error('[LinkedIn Scheduler] Failed to start embedded scheduler in API process', error);
  }
  startLinkedInReadinessLoop();

  if (!runSchedulerInApi) {
    logger.info('[LinkedIn Scheduler] Embedded scheduler disabled in API process', {
      hint: 'Run `npm run start:scheduler` in Linkedin-genie/server'
    });
  }
}

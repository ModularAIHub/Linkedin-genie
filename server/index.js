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
import errorHandler from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import internalAuth from './middleware/internalAuth.js';

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

// Basic middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = [
  'https://suitegenie.in',
  'https://platform.suitegenie.in',
  'https://linkedin.suitegenie.in',
  'https://apilinkedin.suitegenie.in',
  'https://api.suitegenie.in'
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

    // Allow Vercel preview deployments for this team/project namespace.
    if (hostname.endsWith('.vercel.app') && hostname.includes('suitegenies-projects')) {
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
    'http://localhost:3000',
    'http://localhost:3004'
  );
}
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (isAllowedCorsOrigin(origin)) {
      logger.debug('[CORS] Allowed origin', { origin });
      return callback(null, true);
    } else {
      logger.warn('[CORS] Blocked origin', { origin });
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-CSRF-Token', 'x-csrf-token', 'X-Selected-Account-Id'],
  exposedHeaders: ['Set-Cookie']
}));

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'LinkedIn Genie' });
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
}

const runSchedulerInApi = process.env.LINKEDIN_RUN_SCHEDULER_IN_API !== 'false';

if (!process.env.VERCEL) {
  if (runSchedulerInApi) {
    const { startLinkedinScheduler } = await import('./workers/linkedinScheduler.js');
    startLinkedinScheduler({ enabled: true }).catch((error) => {
      logger.error('[LinkedIn Scheduler] Failed to start embedded scheduler in API process', error);
    });
  } else {
    logger.info('[LinkedIn Scheduler] Embedded scheduler disabled in API process', {
      hint: 'Run `npm run start:scheduler` in Linkedin-genie/server'
    });
  }
}

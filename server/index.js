
import express from 'express';

import dotenv from 'dotenv';
dotenv.config();
import csrf from 'csurf';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import oauthRoutes from './routes/oauth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/index.js';
import { requirePlatformLogin } from './middleware/requirePlatformLogin.js';
import errorHandler from './middleware/errorHandler.js';
import cors from 'cors';

const app = express();
app.use(helmet());
// Only call these once at the top

// CSRF protection middleware (cookie-based)
const csrfProtection = csrf({ cookie: true });

// Expose CSRF token route after cookieParser and express.json
app.get('/api/csrf-token', (req, res) => {
  // Generate CSRF token
  const token = req.csrfToken ? req.csrfToken() : 'csrf-token-placeholder';
  res.json({ csrfToken: token });
});

const suitegenieRegex = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*suitegenie\.in$/;
const allowedOrigins = [
  suitegenieRegex,
];
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
    if (!origin) {
      callback(null, true);
    } else if (allowedOrigins.some(o => typeof o === 'string' ? o === origin : o.test(origin))) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Explicit OPTIONS handler for all /api/* routes
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
// Set cookie domain for cross-subdomain auth
app.use(cookieParser());
app.use((req, res, next) => {
  const cookieDomain = process.env.COOKIE_DOMAIN || '.suitegenie.in';
  res.setHeader('Set-Cookie', `domain=${cookieDomain}; Path=/; SameSite=None; Secure`);
  next();
});

// OAuth routes (unprotected for login)
app.use('/api/oauth', oauthRoutes);
// Platform auth routes (callback, validate, refresh, logout)
app.use('/auth', authRoutes);

// Protect all API routes by default
app.use(requirePlatformLogin);
app.use('/api', apiRoutes);


// Health check route
app.get('/', (req, res) => {
  res.json({ 
    message: 'LinkedIn Genie backend is running.',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

// Error handler middleware
app.use(errorHandler);

// Export for Vercel serverless function
export default app;

// Only start server if not in serverless environment
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3004;
  app.listen(PORT, () => {
    console.log(`LinkedIn Genie backend listening on port ${PORT}`);
  });

  // Start BullMQ worker for scheduled LinkedIn posts (only in regular server mode)
  import('./workers/linkedinScheduler.js').catch(console.error);
}

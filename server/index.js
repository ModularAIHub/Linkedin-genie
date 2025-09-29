
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
app.get('/api/csrf-token', (req, res, next) => {
  // Removed duplicate import of cors
  const origin = req.headers.origin;
  // ...existing code for CSRF token route...
  // You may want to add your CSRF logic here
  next();
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


import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from client build (if deployed)
app.use(express.static(path.join(__dirname, '../client/dist')));

// Health check route
app.get('/', (req, res) => {
  res.send('LinkedIn Genie backend is running.');
});

// Catch-all route for SPA client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Error handler middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`LinkedIn Genie backend listening on port ${PORT}`);
});

// Start BullMQ worker for scheduled LinkedIn posts (same process)
await import('./workers/linkedinScheduler.js');

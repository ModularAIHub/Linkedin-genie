

// Load environment variables from .env before anything else

import dotenv from 'dotenv';
dotenv.config();

// DEBUG: Print env vars to diagnose missing LINKEDIN_CLIENT_ID
console.log('DEBUG process.env.LINKEDIN_CLIENT_ID:', process.env.LINKEDIN_CLIENT_ID);
console.log('DEBUG process.env.LINKEDIN_REDIRECT_URI:', process.env.LINKEDIN_REDIRECT_URI);


import express from 'express';
import csrf from 'csurf';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import oauthRoutes from './routes/oauth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/index.js';
import { requirePlatformLogin } from './middleware/requirePlatformLogin.js';
import errorHandler from './middleware/errorHandler.js';


const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// CSRF protection middleware (cookie-based)
const csrfProtection = csrf({ cookie: true });

// Expose CSRF token route after cookieParser and express.json
app.get('/api/csrf-token', (req, res, next) => {
  // Set CORS headers for CSRF token route
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://suitegenie.in',
    'https://api.suitegenie.in',
    'https://tweet.suitegenie.in',
    'https://tweetapi.suitegenie.in',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:3000',
    'http://localhost:3004'
  ];
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cookie,x-csrf-token,X-CSRF-Token,X-Csrf-Token,X-CSRF-token');
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  } else {
    console.log('CORS blocked origin (csrf-token):', origin);
    return res.status(403).send('CORS blocked');
  }
}, csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// CORS configuration with both production and development origins (matches Tweet Genie)
const allowedOrigins = [
  'https://suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://tweetapi.suitegenie.in',
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
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cookie,x-csrf-token,X-CSRF-Token,X-Csrf-Token,X-CSRF-token');
    res.header('Access-Control-Expose-Headers', 'Set-Cookie');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
  } else {
    console.log('CORS blocked origin:', origin);
    return res.status(403).send('CORS blocked');
  }
});

// Explicit OPTIONS handler for all /api/* routes
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// OAuth routes (unprotected for login)
app.use('/api/oauth', oauthRoutes);
// Platform auth routes (callback, validate, refresh, logout)
app.use('/auth', authRoutes);

// Protect all API routes by default
app.use(requirePlatformLogin);
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.send('LinkedIn Genie backend is running.');
});

// Error handler middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`LinkedIn Genie backend listening on port ${PORT}`);
});

// Start BullMQ worker for scheduled LinkedIn posts (same process)
import './workers/linkedinScheduler.js';

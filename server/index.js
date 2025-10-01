
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

// Route imports
import oauthRoutes from './routes/oauth.js';
import authRoutes from './routes/auth.js';
import apiRoutes from './routes/index.js';

// Middleware imports
import { requirePlatformLogin } from './middleware/requirePlatformLogin.js';
import errorHandler from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;

// Basic middleware
app.use(helmet());

// CORS configuration with both production and development origins
const allowedOrigins = [
  'https://suitegenie.in',
  'https://platform.suitegenie.in',
  'https://linkedin.suitegenie.in',
  'https://apilinkedin.suitegenie.in',
  'https://api.suitegenie.in'
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
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
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

// CSRF token endpoint (simplified like Tweet Genie)
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

// Error handling with CORS headers like Tweet Genie
app.use((err, req, res, next) => {
  // Add CORS headers even on errors
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Delegate to the original error handler
  errorHandler(err, req, res, next);
});

// Export for Vercel serverless function
export default app;

// Only start server if not in serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`LinkedIn Genie backend listening on port ${PORT}`);
  });
}

// Start BullMQ worker for scheduled LinkedIn posts
import './workers/linkedinScheduler.js';

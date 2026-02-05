import cors from 'cors';

const allowedOrigins = [
  'http://localhost:5175', // LinkedIn Genie frontend
  'http://localhost:5173', // Platform frontend
  'http://localhost:5174', // Tweet Genie frontend
  'https://suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://linkedin.suitegenie.in',
  'https://byok.suitegenie.in',
  'https://api.suitegenie.in',
  'https://new-platform.suitegenie.in', // Add new-platform domain
  'https://apitweet.suitegenie.in',     // Tweet API domain
  'https://apilinkedin.suitegenie.in',  // LinkedIn API domain
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Selected-Account-Id'],
  exposedHeaders: ['Set-Cookie'],
};

export default cors(corsOptions);

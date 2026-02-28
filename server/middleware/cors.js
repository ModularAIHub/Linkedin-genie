import cors from 'cors';

const allowedOrigins = [
  'http://localhost:5175', // LinkedIn Genie frontend
  'http://localhost:5173', // Platform frontend
  'http://localhost:5174', // Tweet Genie frontend
  'http://localhost:5176', // Social Genie frontend
  'https://suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://linkedin.suitegenie.in',
  'https://linkedin.suitgenie.in',
  'https://meta.suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweetapi.suitegenie.in',
  'https://apilinkedin.suitegenie.in',  // LinkedIn API domain
  'https://metaapi.suitegenie.in',
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
    'X-Selected-Account-Id',
    'x-selected-account-id',
    'X-Team-Id',
    'x-team-id'
  ],
  exposedHeaders: ['Set-Cookie'],
};

export default cors(corsOptions);

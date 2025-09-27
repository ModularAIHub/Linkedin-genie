import cors from 'cors';

const allowedOrigins = [
  'http://localhost:5175', // LinkedIn Genie frontend
  'http://localhost:5173', // Platform frontend
  'http://localhost:5174', // Tweet Genie frontend
];

const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
};

export default cors(corsOptions);

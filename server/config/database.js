import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;


const config = process.env.DATABASE_URL 
  ? {
      connectionString: process.env.DATABASE_URL,
      // No SSL required
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'linkedin_genie',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      // No SSL required
    };

Object.assign(config, {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
});

console.log('LinkedIn Genie Database config:', {
  type: process.env.DATABASE_URL ? 'connection_string' : 'individual_params',
  host: config.host || 'from_connection_string',
  port: config.port || 'from_connection_string',
  database: config.database || 'from_connection_string',
  ssl: !!config.ssl
});

export const pool = new Pool(config);

pool.on('connect', () => {
  console.log('✅ Connected to LinkedIn Genie database');
});

pool.on('error', (err) => {
  console.error('❌ LinkedIn Genie database connection error:', err);
});

pool.query('SELECT NOW()')
  .then(() => console.log('✅ LinkedIn Genie database connection test successful'))
  .catch(err => console.error('❌ LinkedIn Genie database connection test failed:', err));



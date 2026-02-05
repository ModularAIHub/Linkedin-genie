import { pool } from './config/database.js';
import fs from 'fs';

const sql = fs.readFileSync('./migrations/20260205_create_linkedin_team_accounts.sql', 'utf8');

pool.query(sql)
  .then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  });

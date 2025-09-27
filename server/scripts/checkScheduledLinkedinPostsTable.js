import { pool } from './config/database.js';

async function checkScheduledLinkedinPostsTable() {
  try {
    const { rows } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'scheduled_linkedin_posts'");
    console.log('scheduled_linkedin_posts columns:', rows.map(r => r.column_name));
  } catch (err) {
    console.error('Error checking table:', err);
  } finally {
    process.exit(0);
  }
}

checkScheduledLinkedinPostsTable();

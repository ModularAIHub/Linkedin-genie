import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

async function cleanup() {
  try {
    // First, see what we're dealing with
    const orphans = await pool.query(`
      SELECT lta.* 
      FROM linkedin_team_accounts lta 
      LEFT JOIN teams t ON t.id::text = lta.team_id::text 
      WHERE t.id IS NULL
    `);
    console.log('Orphaned records found:', orphans.rows.length);
    console.log(orphans.rows);

    if (orphans.rows.length > 0) {
      // Delete orphaned records
      const result = await pool.query(`
        DELETE FROM linkedin_team_accounts 
        WHERE team_id NOT IN (SELECT id::text FROM teams)
      `);
      console.log('Deleted orphaned records:', result.rowCount);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

cleanup();

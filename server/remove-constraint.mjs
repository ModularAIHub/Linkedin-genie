import { pool } from './config/database.js';

async function removeConstraint() {
    try {
        console.log('Connecting to database...');
        
        // Remove global UNIQUE constraint
        await pool.query(`
            ALTER TABLE linkedin_team_accounts 
            DROP CONSTRAINT IF EXISTS linkedin_team_accounts_linkedin_user_id_key
        `);
        
        console.log('✅ Global UNIQUE constraint removed successfully');
        console.log('✅ LinkedIn accounts can now be connected to multiple teams');
        console.log('✅ Per-team constraint (team_id, linkedin_user_id) is still active');
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Full error:', error);
        await pool.end();
        process.exit(1);
    }
}

removeConstraint();

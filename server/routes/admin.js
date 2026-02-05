import express from 'express';
import { pool } from '../config/database.js';

const router = express.Router();

// Admin endpoint to remove global unique constraint
router.post('/remove-linkedin-constraint', async (req, res) => {
    try {
        console.log('[ADMIN] Removing global UNIQUE constraint on linkedin_user_id...');
        
        // Remove global UNIQUE constraint
        await pool.query(`
            ALTER TABLE linkedin_team_accounts 
            DROP CONSTRAINT IF EXISTS linkedin_team_accounts_linkedin_user_id_key
        `);
        
        console.log('[ADMIN] ✅ Global UNIQUE constraint removed successfully');
        
        res.json({
            success: true,
            message: 'Global UNIQUE constraint removed. LinkedIn accounts can now be connected to multiple teams.'
        });
    } catch (error) {
        console.error('[ADMIN] ❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;

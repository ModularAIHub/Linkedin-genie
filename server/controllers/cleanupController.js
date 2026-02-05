// cleanupController.js
// Handles cleanup of LinkedIn data when users/teams are deleted from main platform

import { pool } from '../config/database.js';

export const cleanupController = {
    // Clean up all LinkedIn data for a deleted user
    async cleanupUserData(req, res) {
        try {
            const { userId } = req.body;

            if (!userId) {
                return res.status(400).json({
                    error: 'userId is required',
                    code: 'MISSING_USER_ID'
                });
            }

            console.log(`🗑️ [LinkedIn] Starting cleanup for user: ${userId}`);

            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // 1. Delete personal LinkedIn accounts
                const personalAccountsResult = await client.query(
                    'DELETE FROM linkedin_auth WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${personalAccountsResult.rowCount} personal LinkedIn accounts`);

                // 2. Delete scheduled posts created by this user
                const scheduledPostsResult = await client.query(
                    'DELETE FROM scheduled_posts WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${scheduledPostsResult.rowCount} scheduled posts`);

                // 3. Delete LinkedIn team accounts connected by this user
                const teamAccountsResult = await client.query(
                    'DELETE FROM linkedin_team_accounts WHERE user_id = $1',
                    [userId]
                );
                console.log(`   ✓ Deleted ${teamAccountsResult.rowCount} team LinkedIn accounts`);

                await client.query('COMMIT');
                console.log(`✅ [LinkedIn] User data cleanup completed`);

                res.json({
                    success: true,
                    message: 'LinkedIn data cleaned up successfully',
                    deletedCounts: {
                        personalAccounts: personalAccountsResult.rowCount,
                        scheduledPosts: scheduledPostsResult.rowCount,
                        teamAccounts: teamAccountsResult.rowCount
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ [LinkedIn] Cleanup error:', error);
            res.status(500).json({
                error: 'Failed to cleanup LinkedIn data',
                code: 'CLEANUP_ERROR',
                message: error.message
            });
        }
    },

    // Clean up all LinkedIn data for a deleted team
    async cleanupTeamData(req, res) {
        try {
            const { teamId } = req.body;

            if (!teamId) {
                return res.status(400).json({
                    error: 'teamId is required',
                    code: 'MISSING_TEAM_ID'
                });
            }

            console.log(`🗑️ [LinkedIn] Starting cleanup for team: ${teamId}`);

            const client = await pool.connect();

            try {
                await client.query('BEGIN');

                // 1. Delete team LinkedIn accounts
                const teamAccountsResult = await client.query(
                    'DELETE FROM linkedin_team_accounts WHERE team_id = $1',
                    [teamId]
                );
                console.log(`   ✓ Deleted ${teamAccountsResult.rowCount} team LinkedIn accounts`);

                // 2. Delete scheduled posts for this team
                const scheduledPostsResult = await client.query(
                    'DELETE FROM scheduled_posts WHERE team_id = $1',
                    [teamId]
                );
                console.log(`   ✓ Deleted ${scheduledPostsResult.rowCount} team scheduled posts`);

                await client.query('COMMIT');
                console.log(`✅ [LinkedIn] Team data cleanup completed`);

                res.json({
                    success: true,
                    message: 'LinkedIn team data cleaned up successfully',
                    deletedCounts: {
                        teamAccounts: teamAccountsResult.rowCount,
                        scheduledPosts: scheduledPostsResult.rowCount
                    }
                });

            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }

        } catch (error) {
            console.error('❌ [LinkedIn] Team cleanup error:', error);
            res.status(500).json({
                error: 'Failed to cleanup LinkedIn team data',
                code: 'CLEANUP_ERROR',
                message: error.message
            });
        }
    }
};

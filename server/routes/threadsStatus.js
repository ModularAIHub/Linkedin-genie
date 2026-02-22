import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Advisory status check (like Tweet Genie's LinkedIn status route):
// direct DB lookup against shared Supabase/Postgres instead of proxying to Social Genie.
router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, account_id, account_username, access_token, token_expires_at
       FROM social_connected_accounts
       WHERE user_id = $1
         AND team_id IS NULL
         AND platform = 'threads'
         AND is_active = true
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ connected: false, reason: 'not_connected' });
    }

    const account = rows[0];
    const expiresAt = account?.token_expires_at ? new Date(account.token_expires_at) : null;
    const hasToken = Boolean(String(account?.access_token || '').trim());
    const hasAccountId = Boolean(String(account?.account_id || '').trim());
    const isExpired =
      expiresAt instanceof Date &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() <= Date.now();

    return res.json({
      connected: true,
      reason: (!hasToken || !hasAccountId) ? 'token_missing' : (isExpired ? 'token_expired' : null),
      account: {
        id: account.id,
        account_id: account.account_id || null,
        account_username: account.account_username || null,
      },
      token: {
        isExpired,
        hasToken,
        hasAccountId,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
      },
    });
  } catch (error) {
    logger.error('[threads/status] DB error', {
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unavailable' });
  }
});

export default router;

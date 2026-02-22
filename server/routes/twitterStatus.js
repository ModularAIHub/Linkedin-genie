import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Advisory status check (like Tweet Genie's LinkedIn status route):
// direct DB lookup against shared Supabase/Postgres instead of proxying to Tweet Genie.
router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, twitter_user_id, twitter_username, token_expires_at, oauth1_access_token
       FROM twitter_auth
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.json({ connected: false, reason: 'not_connected' });
    }

    const account = rows[0];
    const hasOAuth1 = Boolean(account?.oauth1_access_token);
    const expiresAt = account?.token_expires_at ? new Date(account.token_expires_at) : null;
    const isExpired =
      !hasOAuth1 &&
      expiresAt instanceof Date &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() <= Date.now();

    // Keep this advisory and forgiving: row existence means "connected" for toggle UX.
    // We still expose token health so the UI can message better.
    return res.json({
      connected: true,
      reason: isExpired ? 'token_expired' : null,
      account: {
        id: account.id,
        twitter_user_id: account.twitter_user_id || null,
        twitter_username: account.twitter_username || null,
      },
      token: {
        isExpired,
        isOAuth1: hasOAuth1,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null,
      },
    });
  } catch (error) {
    logger.error('[twitter/status] DB error', {
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unavailable' });
  }
});

export default router;

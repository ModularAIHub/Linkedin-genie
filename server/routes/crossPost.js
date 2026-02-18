import express from 'express';
import { pool } from '../config/database.js';
import { createLinkedInPost } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /api/internal/cross-post
 * Called internally by Tweet Genie to cross-post a tweet to LinkedIn.
 * Protected by internalAuth middleware (x-internal-api-key header).
 */
router.post('/cross-post', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { content, tweetUrl } = req.body;
  const platformUserId = req.headers['x-platform-user-id'];

  if (!content || !platformUserId) {
    return res.status(400).json({ error: 'content and x-platform-user-id are required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM linkedin_auth WHERE user_id = $1 LIMIT 1',
      [platformUserId]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: 'LinkedIn account not connected.',
        code: 'LINKEDIN_NOT_CONNECTED',
      });
    }

    const account = rows[0];
    const authorUrn = `urn:li:person:${account.linkedin_user_id}`;

    const linkedinContent = content;

    await createLinkedInPost(
      account.access_token,
      authorUrn,
      linkedinContent,
      [],
      'single_post'
    );
    logger.info('[cross-post] Posted to LinkedIn for user', { user: platformUserId });
    res.json({ success: true });

  } catch (err) {
    logger.error('[cross-post] Error posting to LinkedIn', { error: err?.response?.data || err.message });
    res.status(500).json({ error: 'Failed to post to LinkedIn' });
  }
});

export default router;
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

    const linkedinResult = await createLinkedInPost(
      account.access_token,
      authorUrn,
      linkedinContent,
      [],
      'single_post'
    );

    try {
      const linkedinPostId = linkedinResult?.id || linkedinResult?.urn || null;
      await pool.query(
        `INSERT INTO linkedin_posts (
          user_id,
          linkedin_post_id,
          post_content,
          media_urls,
          post_type,
          company_id,
          linkedin_user_id,
          status,
          views,
          likes,
          comments,
          shares,
          posted_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, 'single_post', NULL, $5, 'posted', 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          platformUserId,
          linkedinPostId,
          linkedinContent,
          JSON.stringify([]),
          account.linkedin_user_id || null,
        ]
      );
    } catch (dbErr) {
      logger.warn('[cross-post] Posted to LinkedIn but failed to save history row', {
        user: platformUserId,
        error: dbErr?.message || String(dbErr),
      });
    }

    logger.info('[cross-post] Posted to LinkedIn for user', { user: platformUserId });
    res.json({
      success: true,
      linkedinPostId: linkedinResult?.id || linkedinResult?.urn || null,
      tweetUrl: typeof tweetUrl === 'string' ? tweetUrl : null,
    });

  } catch (err) {
    logger.error('[cross-post] Error posting to LinkedIn', { error: err?.response?.data || err.message });
    res.status(500).json({ error: 'Failed to post to LinkedIn' });
  }
});

export default router;

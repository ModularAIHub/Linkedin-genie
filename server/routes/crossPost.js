import express from 'express';
import { pool } from '../config/database.js';
import { createLinkedInPost, refreshLinkedInAccessToken } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

const isLinkedInUnauthorizedError = (error) => {
  const status = Number(error?.response?.status || error?.status || 0);
  const apiCode = String(error?.response?.data?.code || error?.code || '').toUpperCase();
  const serviceErrorCode = String(error?.response?.data?.serviceErrorCode || '');
  const message = String(error?.response?.data?.message || error?.message || '').toUpperCase();

  return (
    status === 401 ||
    apiCode === 'REVOKED_ACCESS_TOKEN' ||
    serviceErrorCode === '65601' ||
    message.includes('REVOKED') ||
    message.includes('UNAUTHORIZED')
  );
};

async function refreshLinkedInAuthForUser(userId, accountRow) {
  const refreshToken = String(accountRow?.refresh_token || '').trim();
  if (!refreshToken) {
    throw new Error('LinkedIn refresh token missing');
  }

  const refreshed = await refreshLinkedInAccessToken(refreshToken);
  const accessToken = String(refreshed?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('LinkedIn refresh did not return access token');
  }

  const nextRefreshToken = String(refreshed?.refresh_token || refreshToken).trim() || refreshToken;
  const expiresIn = Number(refreshed?.expires_in || 0);
  const tokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  const { rows } = await pool.query(
    `UPDATE linkedin_auth
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE user_id = $4
     RETURNING *`,
    [accessToken, nextRefreshToken, tokenExpiresAt, userId]
  );

  return rows[0] || { ...accountRow, access_token: accessToken, refresh_token: nextRefreshToken, token_expires_at: tokenExpiresAt };
}

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

    let postingAccount = account;
    let linkedinResult;

    try {
      linkedinResult = await createLinkedInPost(
        postingAccount.access_token,
        authorUrn,
        linkedinContent,
        [],
        'single_post'
      );
    } catch (postErr) {
      const canRefresh = isLinkedInUnauthorizedError(postErr) && Boolean(String(postingAccount?.refresh_token || '').trim());
      if (!canRefresh) {
        throw postErr;
      }

      logger.warn('[cross-post] LinkedIn access token invalid for internal cross-post. Attempting refresh + retry', {
        user: platformUserId,
      });

      try {
        postingAccount = await refreshLinkedInAuthForUser(platformUserId, postingAccount);
        linkedinResult = await createLinkedInPost(
          postingAccount.access_token,
          authorUrn,
          linkedinContent,
          [],
          'single_post'
        );
      } catch (retryErr) {
        if (isLinkedInUnauthorizedError(retryErr)) {
          return res.status(401).json({
            error: 'LinkedIn token revoked/expired. Reconnect required.',
            code: 'LINKEDIN_TOKEN_EXPIRED',
          });
        }
        throw retryErr;
      }
    }

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
          postingAccount.linkedin_user_id || account.linkedin_user_id || null,
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
    if (isLinkedInUnauthorizedError(err)) {
      logger.warn('[cross-post] LinkedIn token invalid and could not refresh', {
        user: platformUserId,
        error: err?.response?.data || err?.message || String(err),
      });
      return res.status(401).json({
        error: 'LinkedIn token revoked/expired. Reconnect required.',
        code: 'LINKEDIN_TOKEN_EXPIRED',
      });
    }

    logger.error('[cross-post] Error posting to LinkedIn', { error: err?.response?.data || err.message });
    res.status(500).json({ error: 'Failed to post to LinkedIn' });
  }
});

export default router;

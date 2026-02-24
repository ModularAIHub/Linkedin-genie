import express from 'express';
import { pool } from '../config/database.js';
import { createLinkedInPost, refreshLinkedInAccessToken } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const TEAM_ADMIN_ROLES = new Set(['owner', 'admin']);

const parsePositiveInt = (value) => {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeOptionalString = (value, maxLength = 255) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const buildTeamLinkedInLabel = (row = {}) => {
  const accountType = String(row?.account_type || 'personal').toLowerCase();
  const baseName =
    normalizeOptionalString(row?.organization_name) ||
    normalizeOptionalString(row?.linkedin_display_name) ||
    normalizeOptionalString(row?.organization_vanity_name) ||
    normalizeOptionalString(row?.linkedin_username) ||
    normalizeOptionalString(row?.linkedin_user_id) ||
    `LinkedIn account #${row?.id ?? 'unknown'}`;

  return `${baseName} (${accountType === 'organization' ? 'LinkedIn organization' : 'LinkedIn personal'})`;
};

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

async function refreshLinkedInAuthForTeamAccount(teamAccountId, accountRow) {
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
    `UPDATE linkedin_team_accounts
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [accessToken, nextRefreshToken, tokenExpiresAt, teamAccountId]
  );

  return rows[0] || { ...accountRow, access_token: accessToken, refresh_token: nextRefreshToken, token_expires_at: tokenExpiresAt };
}

async function getActiveTeamMembership(teamId, userId) {
  const { rows } = await pool.query(
    `SELECT team_id, user_id, role
     FROM team_members
     WHERE team_id = $1
       AND user_id = $2
       AND status = 'active'
     LIMIT 1`,
    [teamId, userId]
  );
  return rows[0] || null;
}

async function listEligibleTeamLinkedInTargets({ teamId, platformUserId }) {
  const membership = await getActiveTeamMembership(teamId, platformUserId);
  if (!membership) {
    return { membership: null, targets: [] };
  }

  const requesterRole = String(membership.role || '').toLowerCase();
  const allowAllTeamAccounts = TEAM_ADMIN_ROLES.has(requesterRole);

  const params = [teamId];
  let query = `
    SELECT lta.*
    FROM linkedin_team_accounts lta
    WHERE lta.team_id = $1
      AND lta.active = true
  `;

  if (!allowAllTeamAccounts) {
    params.push(platformUserId);
    query += ' AND lta.user_id = $2';
  }

  query += ' ORDER BY lta.updated_at DESC NULLS LAST, lta.id DESC';

  const { rows } = await pool.query(query, params);
  const targets = rows.map((row) => ({
    id: String(row.id),
    teamId: String(row.team_id),
    label: buildTeamLinkedInLabel(row),
    accountType: normalizeOptionalString(row.account_type, 40) || 'personal',
    linkedinUserId: normalizeOptionalString(row.linkedin_user_id),
    connectedByUserId: normalizeOptionalString(row.user_id),
  }));

  return { membership, targets };
}

async function resolveExplicitTeamLinkedInTarget({ teamId, platformUserId, targetLinkedinTeamAccountId }) {
  const membership = await getActiveTeamMembership(teamId, platformUserId);
  if (!membership) {
    return { error: { status: 403, code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN', message: 'Requester is not an active team member.' } };
  }

  const parsedTargetId = parsePositiveInt(targetLinkedinTeamAccountId);
  if (!parsedTargetId) {
    return { error: { status: 400, code: 'CROSSPOST_TARGET_ACCOUNT_INVALID', message: 'Invalid target LinkedIn team account id.' } };
  }

  const { rows } = await pool.query(
    `SELECT lta.*
     FROM linkedin_team_accounts lta
     WHERE lta.id = $1
       AND lta.team_id = $2
       AND lta.active = true
     LIMIT 1`,
    [parsedTargetId, teamId]
  );

  const targetRow = rows[0] || null;
  if (!targetRow) {
    return { error: { status: 404, code: 'CROSSPOST_TARGET_ACCOUNT_NOT_FOUND', message: 'Target LinkedIn team account not found.' } };
  }

  const requesterRole = String(membership.role || '').toLowerCase();
  if (!TEAM_ADMIN_ROLES.has(requesterRole) && String(targetRow.user_id) !== String(platformUserId)) {
    return { error: { status: 403, code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN', message: 'You do not have permission to use this target LinkedIn team account.' } };
  }

  return { membership, targetRow };
}

/**
 * GET /api/internal/team-accounts/eligible-crosspost-targets
 * Lists eligible LinkedIn team accounts for explicit cross-post routing in team mode.
 */
router.get('/team-accounts/eligible-crosspost-targets', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim();

  if (!platformUserId || !platformTeamId) {
    return res.status(400).json({
      error: 'x-platform-user-id and x-platform-team-id are required',
      code: 'CROSSPOST_TARGET_ACCOUNT_INVALID',
    });
  }

  try {
    const { membership, targets } = await listEligibleTeamLinkedInTargets({
      teamId: platformTeamId,
      platformUserId,
    });

    if (!membership) {
      return res.status(403).json({
        error: 'Requester is not an active team member.',
        code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN',
      });
    }

    return res.json({
      success: true,
      requesterRole: membership.role,
      targets,
    });
  } catch (error) {
    logger.error('[cross-post] Failed to list eligible team LinkedIn targets', {
      user: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch LinkedIn team targets' });
  }
});

/**
 * POST /api/internal/cross-post
 * Called internally by Tweet Genie to cross-post a tweet to LinkedIn.
 * Protected by internalAuth middleware (x-internal-api-key header).
 */
router.post('/cross-post', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { content, tweetUrl, targetLinkedinTeamAccountId = null } = req.body || {};
  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim() || null;

  if (!content || !platformUserId) {
    return res.status(400).json({ error: 'content and x-platform-user-id are required' });
  }

  try {
    const linkedinContent = content;
    const explicitTeamTargetRequested =
      targetLinkedinTeamAccountId !== null &&
      targetLinkedinTeamAccountId !== undefined &&
      String(targetLinkedinTeamAccountId).trim() !== '';

    let postingAccount;
    let authorUrn;
    let isTeamTarget = false;
    let targetTeamAccount = null;

    if (explicitTeamTargetRequested) {
      if (!platformTeamId) {
        return res.status(400).json({
          error: 'x-platform-team-id is required when targetLinkedinTeamAccountId is provided',
          code: 'CROSSPOST_TARGET_ACCOUNT_INVALID',
        });
      }

      const targetResolution = await resolveExplicitTeamLinkedInTarget({
        teamId: platformTeamId,
        platformUserId,
        targetLinkedinTeamAccountId,
      });

      if (targetResolution.error) {
        return res.status(targetResolution.error.status).json({
          error: targetResolution.error.message,
          code: targetResolution.error.code,
        });
      }

      targetTeamAccount = targetResolution.targetRow;
      postingAccount = targetTeamAccount;
      authorUrn = `urn:li:person:${postingAccount.linkedin_user_id}`;
      isTeamTarget = true;
    } else {
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

      postingAccount = rows[0];
      authorUrn = `urn:li:person:${postingAccount.linkedin_user_id}`;
    }

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
        postingAccount = isTeamTarget
          ? await refreshLinkedInAuthForTeamAccount(targetTeamAccount.id, postingAccount)
          : await refreshLinkedInAuthForUser(platformUserId, postingAccount);
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
          account_id,
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
          $1, $2, $3, $4, $5, 'single_post', $6, $7, 'posted', 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          platformUserId,
          isTeamTarget ? targetTeamAccount?.id || null : null,
          linkedinPostId,
          linkedinContent,
          JSON.stringify([]),
          isTeamTarget ? platformTeamId : null,
          postingAccount.linkedin_user_id || targetTeamAccount?.linkedin_user_id || null,
        ]
      );
    } catch (dbErr) {
      logger.warn('[cross-post] Posted to LinkedIn but failed to save history row', {
        user: platformUserId,
        error: dbErr?.message || String(dbErr),
      });
    }

    logger.info('[cross-post] Posted to LinkedIn for user', {
      user: platformUserId,
      teamId: isTeamTarget ? platformTeamId : null,
      targetLinkedinTeamAccountId: isTeamTarget ? targetTeamAccount?.id || null : null,
    });
    res.json({
      success: true,
      linkedinPostId: linkedinResult?.id || linkedinResult?.urn || null,
      tweetUrl: typeof tweetUrl === 'string' ? tweetUrl : null,
      targetLinkedinTeamAccountId: isTeamTarget ? String(targetTeamAccount?.id) : null,
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

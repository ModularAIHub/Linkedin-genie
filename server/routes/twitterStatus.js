import express from 'express';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const TWITTER_STATUS_TIMEOUT_MS = Number.parseInt(process.env.TWITTER_STATUS_TIMEOUT_MS || '5000', 10);
const TWITTER_PLATFORM = 'twitter';

const resolvePlatformTeamId = (req) => String(req.headers['x-team-id'] || '').trim() || null;
const isTokenExpired = (tokenExpiresAt) => {
  if (!tokenExpiresAt) return false;
  const expiresAtMs = new Date(tokenExpiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
};

const mapLocalTwitterAccount = (row = {}) => {
  const id =
    row?.source_id !== undefined && row?.source_id !== null
      ? String(row.source_id)
      : row?.id !== undefined && row?.id !== null
        ? String(row.id)
        : null;
  const username = row?.twitter_username ? String(row.twitter_username).trim() : '';
  const displayName = row?.twitter_display_name ? String(row.twitter_display_name).trim() : '';
  const supportsMediaUpload = Boolean(
    row?.has_oauth1 ||
    (row?.oauth1_access_token && row?.oauth1_access_token_secret)
  );

  return {
    id,
    accountId: row?.twitter_user_id ? String(row.twitter_user_id) : null,
    username: username || null,
    displayName: displayName || (username ? `@${username}` : 'X account'),
    avatar: row?.twitter_profile_image_url || null,
    supportsMediaUpload,
    tokenExpiresAt: row?.token_expires_at || null,
  };
};

const listLocalTwitterTargets = async ({ userId, teamId = null }) => {
  const normalizedUserId = String(userId || '').trim();
  const normalizedTeamId = String(teamId || '').trim() || null;

  if (!normalizedUserId) {
    return [];
  }

  try {
    const { rows } = await pool.query(
      normalizedTeamId
        ? `SELECT
             sca.id::text,
             COALESCE(NULLIF(sca.metadata->>'source_id', ''), sca.id::text) AS source_id,
             sca.account_id AS twitter_user_id,
             sca.account_username AS twitter_username,
             sca.account_display_name AS twitter_display_name,
             sca.profile_image_url AS twitter_profile_image_url,
             sca.token_expires_at,
             COALESCE((sca.metadata->>'has_oauth1')::boolean, false) AS has_oauth1
           FROM social_connected_accounts sca
           INNER JOIN team_members tm
             ON tm.team_id::text = sca.team_id::text
            AND tm.user_id = $1
            AND tm.status = 'active'
           WHERE sca.team_id::text = $2::text
             AND sca.platform = '${TWITTER_PLATFORM}'
             AND sca.is_active = true
           ORDER BY
             CASE WHEN COALESCE((sca.metadata->>'has_oauth1')::boolean, false) THEN 0 ELSE 1 END,
             sca.updated_at DESC NULLS LAST,
             sca.created_at DESC NULLS LAST,
             sca.id DESC`
        : `SELECT
             sca.id::text,
             COALESCE(NULLIF(sca.metadata->>'source_id', ''), sca.id::text) AS source_id,
             sca.account_id AS twitter_user_id,
             sca.account_username AS twitter_username,
             sca.account_display_name AS twitter_display_name,
             sca.profile_image_url AS twitter_profile_image_url,
             sca.token_expires_at,
             COALESCE((sca.metadata->>'has_oauth1')::boolean, false) AS has_oauth1
           FROM social_connected_accounts sca
           WHERE sca.user_id = $1
             AND sca.team_id IS NULL
             AND sca.platform = '${TWITTER_PLATFORM}'
             AND sca.is_active = true
           ORDER BY
             CASE WHEN COALESCE((sca.metadata->>'has_oauth1')::boolean, false) THEN 0 ELSE 1 END,
             sca.updated_at DESC NULLS LAST,
             sca.created_at DESC NULLS LAST,
             sca.id DESC`,
      normalizedTeamId ? [normalizedUserId, normalizedTeamId] : [normalizedUserId]
    );

    if (rows.length > 0) {
      return rows.map(mapLocalTwitterAccount).filter((account) => account.id);
    }
  } catch (error) {
    logger.warn('[twitter/local] social_connected_accounts lookup failed', {
      userId: normalizedUserId,
      teamId: normalizedTeamId,
      error: error?.message || String(error),
    });
  }

  try {
    const { rows } = await pool.query(
      normalizedTeamId
        ? `SELECT
             ta.id::text,
             ta.twitter_user_id,
             ta.twitter_username,
             ta.twitter_display_name,
             ta.twitter_profile_image_url,
             ta.token_expires_at,
             ta.oauth1_access_token,
             ta.oauth1_access_token_secret
           FROM team_accounts ta
           INNER JOIN team_members tm
             ON tm.team_id = ta.team_id
            AND tm.user_id = $1
            AND tm.status = 'active'
           WHERE ta.team_id::text = $2::text
             AND ta.active = true
           ORDER BY
             CASE WHEN ta.oauth1_access_token IS NOT NULL AND ta.oauth1_access_token_secret IS NOT NULL THEN 0 ELSE 1 END,
             ta.updated_at DESC NULLS LAST,
             ta.id DESC`
        : `SELECT
             id::text,
             twitter_user_id,
             twitter_username,
             twitter_display_name,
             twitter_profile_image_url,
             token_expires_at,
             oauth1_access_token,
             oauth1_access_token_secret
           FROM twitter_auth
           WHERE user_id = $1
           ORDER BY
             CASE WHEN oauth1_access_token IS NOT NULL AND oauth1_access_token_secret IS NOT NULL THEN 0 ELSE 1 END,
             updated_at DESC NULLS LAST,
             id DESC`,
      normalizedTeamId ? [normalizedUserId, normalizedTeamId] : [normalizedUserId]
    );

    return rows.map(mapLocalTwitterAccount).filter((account) => account.id);
  } catch (error) {
    logger.warn('[twitter/local] source-table lookup failed', {
      userId: normalizedUserId,
      teamId: normalizedTeamId,
      error: error?.message || String(error),
    });
    return [];
  }
};

const buildLocalTwitterStatusPayload = async ({ userId, teamId = null }) => {
  try {
    const accounts = await listLocalTwitterTargets({ userId, teamId });
    const primaryAccount = accounts[0] || null;

    if (!primaryAccount) {
      return {
        connected: false,
        reason: 'not_connected',
        account: null,
      };
    }

    if (isTokenExpired(primaryAccount.tokenExpiresAt) && !primaryAccount.supportsMediaUpload) {
      return {
        connected: false,
        reason: 'token_expired',
        account: null,
      };
    }

    return {
      connected: true,
      reason: null,
      account: {
        id: primaryAccount.id,
        twitter_user_id: primaryAccount.accountId,
        username: primaryAccount.username,
        supportsMediaUpload: primaryAccount.supportsMediaUpload,
      },
    };
  } catch (error) {
    logger.error('[twitter/local] Failed to resolve local status', {
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    return {
      connected: false,
      reason: 'service_unreachable',
      account: null,
    };
  }
};

const buildLocalTwitterTargetsPayload = async ({ userId, teamId = null }) => {
  try {
    const accounts = await listLocalTwitterTargets({ userId, teamId });
    return {
      connected: accounts.length > 0,
      reason: accounts.length > 0 ? null : 'not_connected',
      accounts: accounts.map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        avatar: account.avatar,
        supportsMediaUpload: account.supportsMediaUpload,
      })),
    };
  } catch (error) {
    logger.error('[twitter/local] Failed to resolve local targets', {
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    return {
      connected: false,
      reason: 'service_unreachable',
      accounts: [],
    };
  }
};

router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const teamId = resolvePlatformTeamId(req);

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  const tweetGenieUrl = String(process.env.TWEET_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    logger.warn('[twitter/status] Not configured for upstream status proxy', {
      hasTweetGenieUrl: !!tweetGenieUrl,
      hasInternalApiKey: !!internalApiKey,
    });
    const localPayload = await buildLocalTwitterStatusPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || 'not_configured'),
      account: localPayload.account || null,
    });
  }

  const endpoint = `${tweetGenieUrl.replace(/\/$/, '')}/api/internal/twitter/status`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TWITTER_STATUS_TIMEOUT_MS);

    logger.info('[twitter/status] Proxying status request to Tweet Genie', {
      endpoint,
      userId,
      timeoutMs: TWITTER_STATUS_TIMEOUT_MS,
    });

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'linkedin-genie',
        'x-platform-user-id': String(userId),
        ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    const bodyText = await response.text().catch(() => '');
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      body = {};
    }
    const bodyPreview = bodyText && typeof bodyText === 'string'
      ? (bodyText.length > 240 ? `${bodyText.slice(0, 237)}...` : bodyText)
      : '';

    logger.info('[twitter/status] Upstream response received', {
      endpoint,
      userId,
      teamId: teamId || null,
      status: response.status,
      ok: response.ok,
      contentType: contentType || null,
      upstreamCode: body?.code || null,
      upstreamReason: body?.reason || null,
      hasBodyPreview: !!bodyPreview && !contentType.includes('application/json'),
      bodyPreview: !contentType.includes('application/json') ? bodyPreview : undefined,
    });

    if (!response.ok) {
      logger.warn('[twitter/status] Tweet Genie returned non-OK response', {
        endpoint,
        userId,
        teamId: teamId || null,
        status: response.status,
        code: body?.code,
        reason: body?.reason,
        error: body?.error,
      });
      const localPayload = await buildLocalTwitterStatusPayload({ userId, teamId });
      return res.json({
        connected: localPayload.connected,
        reason: localPayload.connected
          ? null
          : (localPayload.reason || (response.status === 404 ? 'not_connected' : 'service_unreachable')),
        account: localPayload.account || null,
      });
    }

    const upstreamConnected = body?.connected === true;
    if (upstreamConnected) {
      return res.json({
        connected: true,
        reason: null,
        account: body?.account || null,
      });
    }

    const localPayload = await buildLocalTwitterStatusPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || body?.reason || 'not_connected'),
      account: localPayload.account || null,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      logger.warn('[twitter/status] Upstream status request timed out', {
        endpoint,
        userId,
        teamId: teamId || null,
        timeoutMs: TWITTER_STATUS_TIMEOUT_MS,
      });
      const localPayload = await buildLocalTwitterStatusPayload({ userId, teamId });
      return res.json({
        connected: localPayload.connected,
        reason: localPayload.connected ? null : (localPayload.reason || 'timeout'),
        account: localPayload.account || null,
      });
    }

    logger.error('[twitter/status] Proxy error', {
      endpoint,
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    const localPayload = await buildLocalTwitterStatusPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || 'service_unreachable'),
      account: localPayload.account || null,
    });
  }
});

router.get('/targets', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const teamId = resolvePlatformTeamId(req);

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized', accounts: [] });
  }

  const tweetGenieUrl = String(process.env.TWEET_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    logger.warn('[twitter/targets] Not configured for upstream targets proxy', {
      hasTweetGenieUrl: !!tweetGenieUrl,
      hasInternalApiKey: !!internalApiKey,
    });
    const localPayload = await buildLocalTwitterTargetsPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || 'not_configured'),
      accounts: localPayload.accounts,
    });
  }

  const endpoint = `${tweetGenieUrl.replace(/\/$/, '')}/api/internal/twitter/targets`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TWITTER_STATUS_TIMEOUT_MS);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-internal-api-key': internalApiKey,
        'x-internal-caller': 'linkedin-genie',
        'x-platform-user-id': String(userId),
        ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      logger.warn('[twitter/targets] Upstream returned non-OK response', {
        endpoint,
        userId,
        teamId: teamId || null,
        status: response.status,
        code: body?.code,
        reason: body?.reason,
        error: body?.error,
      });

      const localPayload = await buildLocalTwitterTargetsPayload({ userId, teamId });
      return res.json({
        connected: localPayload.connected,
        reason: localPayload.connected
          ? null
          : (localPayload.reason || (response.status === 404 ? 'not_connected' : 'service_unreachable')),
        accounts: localPayload.accounts,
      });
    }

    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    if (accounts.length > 0) {
      return res.json({
        connected: true,
        reason: null,
        accounts,
      });
    }

    const localPayload = await buildLocalTwitterTargetsPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || 'not_connected'),
      accounts: localPayload.accounts,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const localPayload = await buildLocalTwitterTargetsPayload({ userId, teamId });
      return res.json({
        connected: localPayload.connected,
        reason: localPayload.connected ? null : (localPayload.reason || 'timeout'),
        accounts: localPayload.accounts,
      });
    }

    logger.error('[twitter/targets] Proxy error', {
      endpoint,
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    const localPayload = await buildLocalTwitterTargetsPayload({ userId, teamId });
    return res.json({
      connected: localPayload.connected,
      reason: localPayload.connected ? null : (localPayload.reason || 'service_unreachable'),
      accounts: localPayload.accounts,
    });
  }
});

export default router;

import express from 'express';
import { logger } from '../utils/logger.js';

const router = express.Router();
const THREADS_STATUS_TIMEOUT_MS = Number.parseInt(process.env.THREADS_STATUS_TIMEOUT_MS || '5000', 10);

const resolvePlatformTeamId = (req) => String(req.headers['x-team-id'] || '').trim() || null;

router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const teamId = resolvePlatformTeamId(req);

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized' });
  }

  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    logger.warn('[threads/status] Not configured for upstream status proxy', {
      hasSocialGenieUrl: !!socialGenieUrl,
      hasInternalApiKey: !!internalApiKey,
    });
    return res.json({
      connected: false,
      reason: 'not_configured',
    });
  }

  const endpoint = `${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/status`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), THREADS_STATUS_TIMEOUT_MS);

    logger.info('[threads/status] Proxying status request to Social Genie', {
      endpoint,
      userId,
      timeoutMs: THREADS_STATUS_TIMEOUT_MS,
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

    logger.info('[threads/status] Upstream response received', {
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
      logger.warn('[threads/status] Social Genie returned non-OK response', {
        endpoint,
        userId,
        teamId: teamId || null,
        status: response.status,
        code: body?.code,
        reason: body?.reason,
        error: body?.error,
      });
      return res.json({
        connected: false,
        reason: response.status === 404 ? 'not_connected' : 'service_unreachable',
      });
    }

    return res.json({
      connected: body?.connected === true,
      reason: body?.connected === true ? null : (body?.reason || 'not_connected'),
      account: body?.account || null,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      logger.warn('[threads/status] Upstream status request timed out', {
        endpoint,
        userId,
        teamId: teamId || null,
        timeoutMs: THREADS_STATUS_TIMEOUT_MS,
      });
      return res.json({ connected: false, reason: 'timeout' });
    }

    logger.error('[threads/status] Proxy error', {
      endpoint,
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unreachable' });
  }
});

router.get('/targets', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;
  const teamId = resolvePlatformTeamId(req);

  if (!userId) {
    return res.status(401).json({ connected: false, reason: 'unauthorized', accounts: [] });
  }

  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    logger.warn('[threads/targets] Not configured for upstream targets proxy', {
      hasSocialGenieUrl: !!socialGenieUrl,
      hasInternalApiKey: !!internalApiKey,
    });
    return res.json({
      connected: false,
      reason: 'not_configured',
      accounts: [],
    });
  }

  const endpoint = `${socialGenieUrl.replace(/\/$/, '')}/api/internal/threads/targets`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), THREADS_STATUS_TIMEOUT_MS);

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
      logger.warn('[threads/targets] Upstream returned non-OK response', {
        endpoint,
        userId,
        teamId: teamId || null,
        status: response.status,
        code: body?.code,
        reason: body?.reason,
        error: body?.error,
      });

      return res.json({
        connected: false,
        reason: response.status === 404 ? 'not_connected' : 'service_unreachable',
        accounts: [],
      });
    }

    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    return res.json({
      connected: accounts.length > 0,
      reason: accounts.length > 0 ? null : 'not_connected',
      accounts,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return res.json({ connected: false, reason: 'timeout', accounts: [] });
    }

    logger.error('[threads/targets] Proxy error', {
      endpoint,
      userId,
      teamId: teamId || null,
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unreachable', accounts: [] });
  }
});

export default router;

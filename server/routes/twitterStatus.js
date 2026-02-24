import express from 'express';
import { logger } from '../utils/logger.js';

const router = express.Router();
const TWITTER_STATUS_TIMEOUT_MS = Number.parseInt(process.env.TWITTER_STATUS_TIMEOUT_MS || '5000', 10);

router.get('/status', async (req, res) => {
  const userId = req.user?.id || req.user?.userId;

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
    return res.json({
      connected: false,
      reason: 'not_configured',
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
      logger.warn('[twitter/status] Upstream status request timed out', {
        endpoint,
        userId,
        timeoutMs: TWITTER_STATUS_TIMEOUT_MS,
      });
      return res.json({ connected: false, reason: 'timeout' });
    }

    logger.error('[twitter/status] Proxy error', {
      endpoint,
      userId,
      error: error?.message || String(error),
    });
    return res.json({ connected: false, reason: 'service_unreachable' });
  }
});

export default router;

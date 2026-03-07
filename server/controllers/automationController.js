import linkedinAutomationService, { AutomationError } from '../services/linkedinAutomationService.js';
import { syncAnalytics } from './analyticsController.js';

const getUserTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;
  return req.cookies?.accessToken || bearerToken || null;
};

const buildCookieHeader = (req) => {
  const accessToken = req.cookies?.accessToken;
  const refreshToken = req.cookies?.refreshToken;
  const parts = [];
  if (accessToken) parts.push(`accessToken=${accessToken}`);
  if (refreshToken) parts.push(`refreshToken=${refreshToken}`);
  return parts.length > 0 ? parts.join('; ') : null;
};

const handleControllerError = (res, error, fallbackMessage) => {
  if (error instanceof AutomationError) {
    return res.status(error.statusCode || 400).json({
      success: false,
      code: error.code,
      error: error.message,
    });
  }

  return res.status(500).json({
    success: false,
    error: fallbackMessage,
    details: error?.message || String(error),
  });
};

export async function getProfileContext(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const payload = await linkedinAutomationService.getProfileBundle(userId);
    return res.json({ success: true, ...payload });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to load automation profile context');
  }
}

export async function saveProfileContext(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const payload = await linkedinAutomationService.upsertProfileContext(userId, req.body || {});
    return res.json({ success: true, ...payload });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to save automation profile context');
  }
}

export async function saveCompetitors(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const payload = await linkedinAutomationService.upsertCompetitors(userId, req.body || {});
    return res.json({ success: true, ...payload });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to save automation competitor settings');
  }
}

export async function runAutomation(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { queueTarget = 7, confirmed = false } = req.body || {};
    if (confirmed !== true) {
      return res.status(400).json({
        success: false,
        code: 'RUN_CONFIRMATION_REQUIRED',
        error: 'Explicit confirmation is required before generating the queue.',
      });
    }

    const result = await linkedinAutomationService.runPipeline({
      userId,
      queueTarget,
      userToken: getUserTokenFromRequest(req),
      cookieHeader: buildCookieHeader(req),
    });

    return res.json({
      success: true,
      runId: result.runId,
      analysis: result.analysis,
      queue: result.queue,
      usedAi: result.usedAi,
      provider: result.provider,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to run LinkedIn automation pipeline');
  }
}

export async function getQueue(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { status = null, limit = 30, offset = 0 } = req.query || {};
    const payload = await linkedinAutomationService.listQueue(userId, { status, limit, offset });

    return res.json({
      success: true,
      queue: payload.queue,
      pagination: {
        total: payload.total,
        limit: payload.limit,
        offset: payload.offset,
      },
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to load automation queue');
  }
}

export async function patchQueueItem(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const queueId = req.params?.id;
    const { action, reason, scheduled_time, timezone } = req.body || {};

    if (!queueId) {
      return res.status(400).json({ success: false, error: 'Queue item id is required' });
    }

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ success: false, error: 'Action is required' });
    }

    const normalizedAction = action.trim().toLowerCase();
    if (normalizedAction === 'approve') {
      const queueItem = await linkedinAutomationService.approveQueueItem(userId, queueId);
      return res.json({ success: true, queueItem });
    }

    if (normalizedAction === 'reject') {
      const queueItem = await linkedinAutomationService.rejectQueueItem(userId, queueId, reason || '');
      return res.json({ success: true, queueItem });
    }

    if (normalizedAction === 'schedule') {
      const result = await linkedinAutomationService.scheduleQueueItem(userId, queueId, {
        scheduled_time,
        timezone,
      });
      return res.json({
        success: true,
        queueItem: result.queueItem,
        scheduledPost: result.scheduledPost,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Unsupported action. Use approve, reject, or schedule.',
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to update queue item');
  }
}

export async function fetchLatest(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const { confirmed = false } = req.body || {};
    if (confirmed !== true) {
      return res.status(400).json({
        success: false,
        code: 'FETCH_CONFIRMATION_REQUIRED',
        error: 'Explicit confirmation is required before fetching latest LinkedIn data.',
      });
    }

    const bundle = await linkedinAutomationService.getProfileBundle(userId);
    if (!bundle?.profileContext?.consent_use_posts) {
      return res.status(403).json({
        success: false,
        code: 'CONSENT_REQUIRED_USE_POSTS',
        error: 'Consent required to use stored LinkedIn posts and metrics.',
      });
    }

    const proxyResponse = {
      statusCode: 200,
      payload: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      },
    };

    await syncAnalytics(req, proxyResponse);

    if (!proxyResponse.payload) {
      return res.status(500).json({
        success: false,
        error: 'Sync completed without a response payload.',
      });
    }

    if (proxyResponse.statusCode >= 400) {
      return res.status(proxyResponse.statusCode).json(proxyResponse.payload);
    }

    await linkedinAutomationService.markManualFetchCompleted(userId);
    const refreshedBundle = await linkedinAutomationService.getProfileBundle(userId);

    return res.json({
      success: true,
      sync: proxyResponse.payload,
      profileContext: refreshedBundle.profileContext,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to fetch latest LinkedIn data');
  }
}

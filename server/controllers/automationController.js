import linkedinAutomationService, { AutomationError } from '../services/linkedinAutomationService.js';
import { syncAnalytics } from './analyticsController.js';
import { pool } from '../config/database.js';
import contextVaultService from '../services/contextVaultService.js';
import strategyService from '../services/strategyService.js';
import adaptiveVaultLoopService from '../services/adaptiveVaultLoopService.js';
import commentReplyAssistService from '../services/commentReplyAssistService.js';

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

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const parsePositiveInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const refreshContextVaultFromQueueAction = async ({ userId, queueItem, reason = 'queue_review' } = {}) => {
  try {
    const runId = String(queueItem?.run_id || '').trim();
    if (!runId) return null;

    const { rows } = await pool.query(
      `SELECT metadata
       FROM linkedin_automation_runs
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [runId, userId]
    );

    const runMetadata = parseJsonObject(rows?.[0]?.metadata, {});
    const strategyId = String(runMetadata.strategy_id || '').trim();
    if (!strategyId) return null;

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || String(strategy.user_id) !== String(userId)) return null;

    const vault = await contextVaultService.refresh({
      userId,
      strategy,
      reason,
    });

    return {
      strategyId,
      vaultId: vault?.id || null,
      refreshedAt: vault?.lastRefreshedAt || null,
    };
  } catch (error) {
    console.warn('[Automation] Context vault refresh after queue action failed:', {
      userId,
      queueId: queueItem?.id || null,
      reason,
      error: error?.message || String(error),
    });
    return null;
  }
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
    const strategyId = typeof req.body?.strategyId === 'string' ? req.body.strategyId.trim() : null;
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
      strategyId: strategyId || null,
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
    const {
      action,
      reason,
      scheduled_time,
      timezone,
      title,
      content,
      hashtags,
    } = req.body || {};

    if (!queueId) {
      return res.status(400).json({ success: false, error: 'Queue item id is required' });
    }

    if (!action || typeof action !== 'string') {
      return res.status(400).json({ success: false, error: 'Action is required' });
    }

    const normalizedAction = action.trim().toLowerCase();
    if (normalizedAction === 'approve') {
      const queueItem = await linkedinAutomationService.approveQueueItem(userId, queueId);
      const contextVaultRefresh = await refreshContextVaultFromQueueAction({
        userId,
        queueItem,
        reason: 'queue_approve',
      });
      return res.json({ success: true, queueItem, contextVaultRefresh });
    }

    if (normalizedAction === 'reject') {
      const queueItem = await linkedinAutomationService.rejectQueueItem(userId, queueId, reason || '');
      const contextVaultRefresh = await refreshContextVaultFromQueueAction({
        userId,
        queueItem,
        reason: 'queue_reject',
      });
      return res.json({ success: true, queueItem, contextVaultRefresh });
    }

    if (normalizedAction === 'schedule') {
      const result = await linkedinAutomationService.scheduleQueueItem(userId, queueId, {
        scheduled_time,
        timezone,
      });
      const contextVaultRefresh = await refreshContextVaultFromQueueAction({
        userId,
        queueItem: result?.queueItem,
        reason: 'queue_schedule',
      });
      return res.json({
        success: true,
        queueItem: result.queueItem,
        scheduledPost: result.scheduledPost,
        contextVaultRefresh,
      });
    }

    if (normalizedAction === 'update') {
      const queueItem = await linkedinAutomationService.updateQueueItem(userId, queueId, {
        title,
        content,
        hashtags,
        reason,
      });
      const contextVaultRefresh = await refreshContextVaultFromQueueAction({
        userId,
        queueItem,
        reason: 'queue_edit',
      });
      return res.json({
        success: true,
        queueItem,
        contextVaultRefresh,
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Unsupported action. Use approve, reject, schedule, or update.',
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to update queue item');
  }
}

export async function runAdaptiveVaultLoop(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const includeContextRefresh = req.body?.includeContextRefresh !== false;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : 'manual';

    const payload = await adaptiveVaultLoopService.runForUser({
      userId,
      reason: reason || 'manual',
      includeContextRefresh,
    });

    return res.json({
      success: true,
      run: payload?.run || null,
      summary: payload?.summary || {},
      personaVault: payload?.personaVault || null,
      contextRefresh: payload?.contextRefresh || null,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to run adaptive vault loop');
  }
}

export async function getLatestAdaptiveVaultLoop(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const run = await adaptiveVaultLoopService.getLatestRun({ userId });
    return res.json({
      success: true,
      run,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to fetch adaptive vault loop status');
  }
}

export async function getCommentReplyInbox(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const accountId = typeof req.query?.account_id === 'string'
      ? req.query.account_id.trim()
      : (typeof req.headers['x-selected-account-id'] === 'string' ? req.headers['x-selected-account-id'].trim() : null);
    const accountType = typeof req.query?.account_type === 'string'
      ? req.query.account_type.trim()
      : null;

    const limit = parsePositiveInt(req.query?.limit, 60, { min: 1, max: 120 });
    const postLimit = parsePositiveInt(req.query?.post_limit, 12, { min: 1, max: 30 });
    const perPostLimit = parsePositiveInt(req.query?.per_post_limit, 8, { min: 1, max: 20 });

    const payload = await commentReplyAssistService.listInboxComments({
      userId,
      accountId: accountId || null,
      accountType: accountType || null,
      limit,
      postLimit,
      perPostLimit,
    });

    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to load LinkedIn comment inbox');
  }
}

export async function generateCommentReplyAssist(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const strategyId = typeof req.body?.strategyId === 'string' ? req.body.strategyId.trim() : null;
    if (strategyId) {
      const strategy = await strategyService.getStrategy(strategyId);
      if (!strategy || String(strategy.user_id) !== String(userId)) {
        return res.status(404).json({
          success: false,
          error: 'Strategy not found for this account',
        });
      }
    }

    const suggestionCount = parsePositiveInt(req.body?.suggestionCount, 3, { min: 1, max: 5 });
    const payload = await commentReplyAssistService.generateSuggestions({
      userId,
      strategyId,
      postId: typeof req.body?.postId === 'string' ? req.body.postId.trim() : null,
      sourceCommentId: typeof req.body?.sourceCommentId === 'string' ? req.body.sourceCommentId.trim() : '',
      commentText: typeof req.body?.commentText === 'string' ? req.body.commentText : '',
      commenterName: typeof req.body?.commenterName === 'string' ? req.body.commenterName : '',
      tone: typeof req.body?.tone === 'string' ? req.body.tone : 'professional',
      objective: typeof req.body?.objective === 'string' ? req.body.objective : 'engage',
      contextNotes: typeof req.body?.contextNotes === 'string' ? req.body.contextNotes : '',
      suggestionCount,
    });

    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    if ((error?.message || '').toLowerCase().includes('commenttext is required')) {
      return res.status(400).json({
        success: false,
        error: 'commentText is required',
      });
    }
    return handleControllerError(res, error, 'Failed to generate comment reply suggestions');
  }
}

export async function sendCommentReplyAssist(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const strategyId = typeof req.body?.strategyId === 'string' ? req.body.strategyId.trim() : null;
    if (strategyId) {
      const strategy = await strategyService.getStrategy(strategyId);
      if (!strategy || String(strategy.user_id) !== String(userId)) {
        return res.status(404).json({
          success: false,
          error: 'Strategy not found for this account',
        });
      }
    }

    const accountId = typeof req.body?.accountId === 'string'
      ? req.body.accountId.trim()
      : (typeof req.headers['x-selected-account-id'] === 'string' ? req.headers['x-selected-account-id'].trim() : null);
    const accountType = typeof req.body?.accountType === 'string'
      ? req.body.accountType.trim()
      : null;

    const payload = await commentReplyAssistService.sendReply({
      userId,
      strategyId,
      assistRequestId: typeof req.body?.assistRequestId === 'string' ? req.body.assistRequestId.trim() : null,
      postId: typeof req.body?.postId === 'string' ? req.body.postId.trim() : null,
      linkedinPostId: typeof req.body?.linkedinPostId === 'string' ? req.body.linkedinPostId : '',
      sourceCommentId: typeof req.body?.sourceCommentId === 'string' ? req.body.sourceCommentId : '',
      commentText: typeof req.body?.commentText === 'string' ? req.body.commentText : '',
      replyText: typeof req.body?.replyText === 'string' ? req.body.replyText : '',
      accountId: accountId || null,
      accountType: accountType || null,
    });

    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('replytext is required')) {
      return res.status(400).json({
        success: false,
        error: 'replyText is required',
      });
    }
    if (message.includes('sourcecommentid is required')) {
      return res.status(400).json({
        success: false,
        error: 'sourceCommentId is required',
      });
    }
    if (message.includes('stable linkedin comment urn')) {
      return res.status(400).json({
        success: false,
        error: 'Could not resolve the exact LinkedIn comment target. Refresh comment inbox and try again.',
      });
    }
    return handleControllerError(res, error, 'Failed to send LinkedIn comment reply');
  }
}

export async function getCommentReplyAssistHistory(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });

    const strategyId = typeof req.query?.strategyId === 'string' ? req.query.strategyId.trim() : null;
    if (strategyId) {
      const strategy = await strategyService.getStrategy(strategyId);
      if (!strategy || String(strategy.user_id) !== String(userId)) {
        return res.status(404).json({
          success: false,
          error: 'Strategy not found for this account',
        });
      }
    }

    const limit = parsePositiveInt(req.query?.limit, 20, { min: 1, max: 100 });
    const offset = parsePositiveInt(req.query?.offset, 0, { min: 0, max: 10000 });

    const payload = await commentReplyAssistService.listHistory({
      userId,
      strategyId,
      limit,
      offset,
    });

    return res.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return handleControllerError(res, error, 'Failed to load comment reply assist history');
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

import dotenv from 'dotenv';
import { pool } from '../config/database.js';
import { createLinkedInPost } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';
import { buildCrossPostPayloads, detectCrossPostMedia } from '../utils/crossPostOptimizer.js';
import { resolveLinkedInAuthorIdentity } from '../utils/linkedinAuthorIdentity.js';

dotenv.config({ quiet: true });

const POLL_INTERVAL_MS = Number(process.env.LINKEDIN_SCHEDULER_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.LINKEDIN_SCHEDULER_BATCH_SIZE || 5);
const WORKER_ENABLED = process.env.LINKEDIN_SCHEDULER_ENABLED !== 'false';
const MAX_ATTEMPTS = Number(process.env.LINKEDIN_SCHEDULER_MAX_ATTEMPTS || 5);
const RETRY_BASE_MS = Number(process.env.LINKEDIN_SCHEDULER_RETRY_BASE_MS || 60000);
const RETRY_MAX_MS = Number(process.env.LINKEDIN_SCHEDULER_RETRY_MAX_MS || 900000);
const MAX_ERROR_LENGTH = 900;

const RETRY_COLUMNS = ['retry_count', 'next_retry_at', 'last_attempt_at'];
const OPTIONAL_COLUMNS = ['metadata'];
const X_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.X_CROSSPOST_TIMEOUT_MS || '10000', 10);
const THREADS_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.THREADS_CROSSPOST_TIMEOUT_MS || '10000', 10);
const INTERNAL_CALLER = 'linkedin-genie-scheduler';

let tickInProgress = false;
let retrySchemaChecked = false;
let retryColumnsAvailable = false;
let optionalColumnSchemaChecked = false;
let metadataColumnAvailable = false;
let schedulerStarted = false;
let schedulerInterval = null;
let schedulerStartedAt = null;
let lastTickFinishedAt = null;
let nextAllowedTickAt = 0;
let transientFailureBackoffMs = 0;

const schedulerStats = {
  ticks: 0,
  noopTicks: 0,
  processedPosts: 0,
  succeededPosts: 0,
  retriedPosts: 0,
  failedPosts: 0
};

const lastTickSummary = {
  tickId: null,
  startedAt: null,
  finishedAt: null,
  durationMs: 0,
  processed: 0,
  succeeded: 0,
  retried: 0,
  failed: 0,
  status: 'idle',
  error: null
};

const safeErrorMessage = (error) => {
  const message = error?.response?.data?.message || error?.message || 'Unknown scheduler error';
  return String(message).slice(0, MAX_ERROR_LENGTH);
};

const isTransientConnectionError = (error) => {
  const message = String(error?.response?.data?.message || error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  return (
    message.includes('getaddrinfo eai_again') ||
    message.includes('enotfound') ||
    message.includes('connect eacces') ||
    message.includes('connection terminated') ||
    message.includes('connection timeout') ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT'
  );
};

const computeTransientBackoffMs = () => {
  if (!transientFailureBackoffMs) {
    return Math.min(Math.max(POLL_INTERVAL_MS * 2, 30000), 300000);
  }
  return Math.min(transientFailureBackoffMs * 2, 300000);
};

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...fallback, ...value };
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...fallback, ...parsed };
      }
    } catch {
      return { ...fallback };
    }
  }
  return { ...fallback };
};

const parseMediaUrls = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeCrossPostMedia = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
};

const computeBackoffMs = (retryCount) => {
  const exponent = Math.max(0, retryCount - 1);
  const delay = RETRY_BASE_MS * Math.pow(2, exponent);
  return Math.min(delay, RETRY_MAX_MS);
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

const resolveSocialLinkedinUserId = (row = {}) => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const fromMetadata = String(metadata?.linkedin_user_id || '').trim();
  if (fromMetadata) return fromMetadata;
  const accountId = String(row?.account_id || '').trim();
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

const buildInternalServiceHeaders = ({ userId, internalApiKey, teamId = null }) => {
  const headers = {
    'Content-Type': 'application/json',
    'x-internal-api-key': internalApiKey,
    'x-internal-caller': INTERNAL_CALLER,
    'x-platform-user-id': String(userId),
  };

  if (teamId !== null && teamId !== undefined && String(teamId).trim()) {
    headers['x-platform-team-id'] = String(teamId).trim();
  }

  return headers;
};

const buildInternalServiceEndpoint = (baseUrl, path) =>
  `${String(baseUrl || '').trim().replace(/\/$/, '')}${path}`;

function resolveTweetGenieInternalBaseUrl() {
  const configuredUrl = String(process.env.TWEET_GENIE_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    return 'http://localhost:3002';
  }

  return '';
}

async function postInternalJson({ endpoint, userId, teamId = null, internalApiKey, payload, timeoutMs = 0 }) {
  const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;

  try {
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildInternalServiceHeaders({ userId, internalApiKey, teamId }),
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function crossPostScheduledToX({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  postMode = 'single',
  threadParts = [],
  mediaDetected = false,
  media = [],
}) {
  const tweetGenieUrl = resolveTweetGenieInternalBaseUrl();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    logger.warn('[LinkedIn Scheduler] X cross-post skipped: missing config');
    return { status: 'skipped_not_configured' };
  }

  const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/cross-post');

  try {
    const { response, body } = await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      timeoutMs: X_CROSSPOST_TIMEOUT_MS,
      payload: {
        postMode,
        content,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        mediaDetected: Boolean(mediaDetected),
        sourcePlatform: 'linkedin',
        media: Array.isArray(media) ? media : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });

    if (!response.ok) {
      if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
        return { status: 'not_connected' };
      }
      if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
        return { status: 'not_connected' };
      }
      if (
        (response.status === 404 && String(body?.code || '').toUpperCase().includes('TARGET_ACCOUNT_NOT_FOUND')) ||
        (response.status === 403 && String(body?.code || '').toUpperCase().includes('TARGET_ACCOUNT_FORBIDDEN'))
      ) {
        return { status: 'target_not_found' };
      }
      if (response.status === 400 && String(body?.code || '').toUpperCase() === 'X_POST_TOO_LONG') {
        return { status: 'failed_too_long' };
      }
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }

    return {
      status: body?.status || 'posted',
      tweetId: body?.tweetId || null,
      tweetUrl: body?.tweetUrl || null,
      mediaDetected: Boolean(mediaDetected),
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'timeout' };
    }
    logger.error('[LinkedIn Scheduler] X cross-post request error', {
      userId,
      error: error?.message || String(error),
    });
    return { status: 'failed' };
  }
}

async function saveToTweetHistory({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  tweetId = null,
  mediaDetected = false,
  media = [],
  postMode = 'single',
  threadParts = [],
}) {
  const tweetGenieUrl = resolveTweetGenieInternalBaseUrl();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    return;
  }

  const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/save-to-history');

  try {
    await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      payload: {
        content,
        tweetId,
        sourcePlatform: 'linkedin_schedule',
        mediaDetected: Boolean(mediaDetected),
        media: Array.isArray(media) ? media : [],
        postMode,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });
  } catch (error) {
    logger.warn('[LinkedIn Scheduler] Failed to save X history after cross-post', {
      userId,
      error: error?.message || String(error),
    });
  }
}

async function crossPostScheduledToThreads({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  mediaDetected = false,
  optimizeCrossPost = true,
  media = [],
}) {
  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    logger.warn('[LinkedIn Scheduler] Threads cross-post skipped: missing config');
    return { status: 'skipped_not_configured' };
  }

  const endpoint = buildInternalServiceEndpoint(socialGenieUrl, '/api/internal/threads/cross-post');

  try {
    const { response, body } = await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      timeoutMs: THREADS_CROSSPOST_TIMEOUT_MS,
      payload: {
        postMode: 'single',
        content,
        threadParts: [],
        sourcePlatform: 'linkedin_schedule',
        optimizeCrossPost: optimizeCrossPost !== false,
        mediaDetected: Boolean(mediaDetected),
        mediaUrls: Array.isArray(media) ? media : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });

    if (!response.ok) {
      if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
        return { status: 'not_connected' };
      }
      if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
        return { status: 'not_connected' };
      }
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }

    return {
      status: 'posted',
      mediaDetected: Boolean(mediaDetected),
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'timeout' };
    }
    logger.error('[LinkedIn Scheduler] Threads cross-post request error', {
      userId,
      error: error?.message || String(error),
    });
    return { status: 'failed' };
  }
}

async function detectRetrySchemaSupport() {
  if (retrySchemaChecked) return;

  try {
    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'scheduled_linkedin_posts'
         AND column_name = ANY($1::text[])`,
      [RETRY_COLUMNS]
    );

    const availableColumns = new Set(rows.map((row) => row.column_name));
    retryColumnsAvailable = RETRY_COLUMNS.every((column) => availableColumns.has(column));
    lastTickSummary.error = null;

    if (!retryColumnsAvailable) {
      logger.warn('[LinkedIn Scheduler] Retry columns missing. Using no-retry fallback.', {
        required: RETRY_COLUMNS,
        available: [...availableColumns]
      });
    }
  } catch (error) {
    logger.warn('[LinkedIn Scheduler] Failed to inspect scheduler retry schema. Using no-retry fallback.', {
      error: safeErrorMessage(error)
    });
    retryColumnsAvailable = false;
  } finally {
    retrySchemaChecked = true;
  }
}

async function detectOptionalSchemaSupport() {
  if (optionalColumnSchemaChecked) return;

  try {
    try {
      await pool.query(
        `ALTER TABLE scheduled_linkedin_posts
         ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`
      );
    } catch (alterError) {
      logger.warn('[LinkedIn Scheduler] Could not auto-add metadata column for scheduled cross-post results.', {
        error: safeErrorMessage(alterError),
      });
    }

    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'scheduled_linkedin_posts'
         AND column_name = ANY($1::text[])`,
      [OPTIONAL_COLUMNS]
    );

    const availableColumns = new Set(rows.map((row) => row.column_name));
    metadataColumnAvailable = availableColumns.has('metadata');
  } catch (error) {
    logger.warn('[LinkedIn Scheduler] Failed to inspect optional scheduler columns.', {
      error: safeErrorMessage(error),
    });
    metadataColumnAvailable = false;
  } finally {
    optionalColumnSchemaChecked = true;
  }
}

async function claimDueScheduledPosts(limit) {
  await detectRetrySchemaSupport();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const query = retryColumnsAvailable
      ? `WITH due AS (
           SELECT id
           FROM scheduled_linkedin_posts
           WHERE status = 'scheduled'
             AND COALESCE(next_retry_at, scheduled_time) <= NOW()
           ORDER BY COALESCE(next_retry_at, scheduled_time) ASC, scheduled_time ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE scheduled_linkedin_posts p
         SET status = 'processing',
             last_attempt_at = NOW(),
             updated_at = NOW()
         FROM due
         WHERE p.id = due.id
         RETURNING p.*`
      : `WITH due AS (
           SELECT id
           FROM scheduled_linkedin_posts
           WHERE status = 'scheduled'
             AND scheduled_time <= NOW()
           ORDER BY scheduled_time ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE scheduled_linkedin_posts p
         SET status = 'processing',
             updated_at = NOW()
         FROM due
         WHERE p.id = due.id
         RETURNING p.*`;

    const { rows } = await client.query(query, [limit]);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolvePublishingContext(post) {
  if (post.company_id) {
    const { rows: socialTeamRows } = await pool.query(
      `SELECT id, team_id, account_id, metadata, access_token, token_expires_at
       FROM social_connected_accounts
       WHERE platform = 'linkedin'
         AND team_id IS NOT NULL
         AND is_active = true
         AND (
           team_id::text = $1
           OR id::text = $1
           OR COALESCE(metadata->>'legacy_team_account_id', '') = $1
           OR COALESCE(metadata->>'legacy_row_id', '') = $1
         )
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [String(post.company_id)]
    );

    const socialTeamAuthorIdentity = resolveLinkedInAuthorIdentity(socialTeamRows[0] || {});
    if (socialTeamRows[0]?.access_token && socialTeamAuthorIdentity.authorUrn) {
      return {
        accessToken: socialTeamRows[0].access_token,
        authorUrn: socialTeamAuthorIdentity.authorUrn,
        linkedinUserId: socialTeamAuthorIdentity.linkedinUserId
      };
    }

    const { rows: teamRows } = await pool.query(
      `SELECT id, team_id, access_token, linkedin_user_id, account_type, organization_id, organization_name
       FROM linkedin_team_accounts
       WHERE active = true
         AND (team_id::text = $1 OR id::text = $1)
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [String(post.company_id)]
    );

    const teamAuthorIdentity = resolveLinkedInAuthorIdentity(teamRows[0] || {});
    if (teamRows[0]?.access_token && teamAuthorIdentity.authorUrn) {
      return {
        accessToken: teamRows[0].access_token,
        authorUrn: teamAuthorIdentity.authorUrn,
        linkedinUserId: teamAuthorIdentity.linkedinUserId
      };
    }
  }

  const { rows: socialPersonalRows } = await pool.query(
    `SELECT access_token, account_id, metadata
     FROM social_connected_accounts
     WHERE user_id::text = $1::text
       AND team_id IS NULL
       AND platform = 'linkedin'
       AND is_active = true
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [post.user_id]
  );

  const socialPersonalLinkedinUserId = resolveSocialLinkedinUserId(socialPersonalRows[0] || {});
  if (socialPersonalRows[0]?.access_token && socialPersonalLinkedinUserId) {
    return {
      accessToken: socialPersonalRows[0].access_token,
      authorUrn: `urn:li:person:${socialPersonalLinkedinUserId}`,
      linkedinUserId: socialPersonalLinkedinUserId
    };
  }

  const { rows: personalRows } = await pool.query(
    `SELECT access_token, linkedin_user_id
     FROM linkedin_auth
     WHERE user_id = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [post.user_id]
  );

  if (personalRows[0]?.access_token && personalRows[0]?.linkedin_user_id) {
    return {
      accessToken: personalRows[0].access_token,
      authorUrn: `urn:li:person:${personalRows[0].linkedin_user_id}`,
      linkedinUserId: personalRows[0].linkedin_user_id
    };
  }

  throw new Error('LinkedIn account not connected for scheduled post');
}

async function addPostedEntry(post, linkedinResult, linkedinUserId) {
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
       created_at,
       updated_at,
       posted_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, 'posted', 0, 0, 0, 0, NOW(), NOW(), NOW()
     )`,
    [
      post.user_id,
      post.account_id || null,
      linkedinPostId,
      post.post_content,
      JSON.stringify(parseMediaUrls(post.media_urls)),
      post.post_type,
      post.company_id,
      linkedinUserId,
    ]
  );
}

async function markScheduledPostCompleted(postId, { metadata = undefined } = {}) {
  await detectRetrySchemaSupport();
  await detectOptionalSchemaSupport();

  const canWriteMetadata = metadataColumnAvailable && metadata !== undefined;
  const metadataParam = canWriteMetadata ? JSON.stringify(metadata || {}) : null;

  if (retryColumnsAvailable && canWriteMetadata) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts
       SET status = 'completed',
           posted_at = NOW(),
           error_message = NULL,
           next_retry_at = NULL,
           metadata = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [postId, metadataParam]
    );
    return;
  }

  if (retryColumnsAvailable) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts
       SET status = 'completed',
           posted_at = NOW(),
           error_message = NULL,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [postId]
    );
    return;
  }

  if (canWriteMetadata) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts
       SET status = 'completed',
           posted_at = NOW(),
           error_message = NULL,
           metadata = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [postId, metadataParam]
    );
    return;
  }

  await pool.query(
    `UPDATE scheduled_linkedin_posts
     SET status = 'completed',
         posted_at = NOW(),
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [postId]
  );
}

async function scheduleRetryOrFail(post, error) {
  await detectRetrySchemaSupport();

  const errorMessage = safeErrorMessage(error);
  if (!retryColumnsAvailable) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [post.id, errorMessage]
    );
    return { outcome: 'failed', retryCount: Number(post.retry_count || 0), error: errorMessage };
  }

  const currentRetryCount = Number(post.retry_count || 0);
  const nextRetryCount = currentRetryCount + 1;

  if (nextRetryCount >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts
       SET status = 'failed',
           retry_count = $2,
           error_message = $3,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [post.id, nextRetryCount, errorMessage]
    );

    logger.error('[LinkedIn Scheduler] Scheduled post marked failed after max attempts', {
      scheduledPostId: post.id,
      retryCount: nextRetryCount,
      maxAttempts: MAX_ATTEMPTS,
      error: errorMessage
    });
    return { outcome: 'failed', retryCount: nextRetryCount, error: errorMessage };
  }

  const backoffMs = computeBackoffMs(nextRetryCount);
  await pool.query(
    `UPDATE scheduled_linkedin_posts
     SET status = 'scheduled',
         retry_count = $2,
         next_retry_at = NOW() + ($3 * INTERVAL '1 millisecond'),
         error_message = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [post.id, nextRetryCount, backoffMs, errorMessage]
  );

  logger.warn('[LinkedIn Scheduler] Scheduled post will retry', {
    scheduledPostId: post.id,
    retryCount: nextRetryCount,
    maxAttempts: MAX_ATTEMPTS,
    backoffMs,
    error: errorMessage
  });

  return { outcome: 'retry', retryCount: nextRetryCount, backoffMs, error: errorMessage };
}

async function processScheduledPost(post) {
  const context = await resolvePublishingContext(post);
  const mediaUrls = parseMediaUrls(post.media_urls);
  const linkedinResult = await createLinkedInPost(
    context.accessToken,
    context.authorUrn,
    post.post_content,
    mediaUrls,
    post.post_type,
    post.company_id
  );

  // --- PATCH: Resolve LinkedIn asset URNs to real URLs for Threads cross-post ---
  let resolvedMediaUrls = mediaUrls;
  if (Array.isArray(mediaUrls) && mediaUrls.some(url => url.startsWith('urn:li:digitalmediaAsset:'))) {
    const { resolveLinkedInAssetUrl } = await import('../utils/linkedinAssetResolver.js');
    resolvedMediaUrls = await Promise.all(mediaUrls.map(async (url) => {
      if (url.startsWith('urn:li:digitalmediaAsset:')) {
        try {
          const resolved = await resolveLinkedInAssetUrl(url, context.accessToken);
          logger.info('[LinkedIn Scheduler] Resolved LinkedIn asset URN to URL', { urn: url, resolved });
          return resolved;
        } catch (e) {
          logger.warn('[LinkedIn Scheduler] Failed to resolve LinkedIn asset URN to URL', { url, error: e?.message || String(e) });
          return null;
        }
      }
      return url;
    }));
    resolvedMediaUrls = resolvedMediaUrls.filter(Boolean);
    logger.info('[LinkedIn Scheduler] Final resolvedMediaUrls for Threads cross-post', { resolvedMediaUrls });
    if (!resolvedMediaUrls.length) {
      logger.warn('[LinkedIn Scheduler] No valid media URLs resolved for Threads cross-post. Skipping media.');
    }
  }

  try {
    await addPostedEntry(post, linkedinResult, context.linkedinUserId);
  } catch (historyError) {
    logger.error('[LinkedIn Scheduler] Published but failed to insert linkedin_posts row', {
      scheduledPostId: post.id,
      error: safeErrorMessage(historyError)
    });
  }

  const baseMetadata = parseJsonObject(post?.metadata, {});
  const crossPostMeta =
    baseMetadata?.cross_post && typeof baseMetadata.cross_post === 'object'
      ? { ...baseMetadata.cross_post }
      : null;

  let nextMetadata = baseMetadata;
  if (crossPostMeta && typeof crossPostMeta === 'object') {
    const targets =
      crossPostMeta.targets && typeof crossPostMeta.targets === 'object'
        ? crossPostMeta.targets
        : {};
    const crossPostMedia = normalizeCrossPostMedia(crossPostMeta.media);
    const xEnabled = Boolean(targets.x || targets.twitter);
    const threadsEnabled = Boolean(targets.threads);
    const routing =
      crossPostMeta.routing && typeof crossPostMeta.routing === 'object'
        ? crossPostMeta.routing
        : {};
    const xTargetAccountId =
      routing?.x?.targetAccountId !== undefined && routing?.x?.targetAccountId !== null
        ? String(routing.x.targetAccountId).trim() || null
        : null;
    const threadsTargetAccountId =
      routing?.threads?.targetAccountId !== undefined && routing?.threads?.targetAccountId !== null
        ? String(routing.threads.targetAccountId).trim() || null
        : null;
    const resolvedTeamId =
      post.company_id !== undefined && post.company_id !== null && String(post.company_id).trim()
        ? String(post.company_id).trim()
        : (post.team_id !== undefined && post.team_id !== null && String(post.team_id).trim()
            ? String(post.team_id).trim()
            : null);
    const mediaDetected = detectCrossPostMedia({ mediaUrls });
    const crossPostResult = {
      x: {
        enabled: xEnabled,
        status: xEnabled ? null : 'disabled',
        mediaDetected: Boolean(mediaDetected),
        mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
      },
      threads: {
        enabled: threadsEnabled,
        status: threadsEnabled ? null : 'disabled',
        mediaDetected: Boolean(mediaDetected),
        mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
      },
    };

    if (xEnabled || threadsEnabled) {
      const payloads = buildCrossPostPayloads({
        postContent: post.post_content,
        optimizeCrossPost: crossPostMeta.optimizeCrossPost !== false,
      });

      const crossPostTasks = [];

      if (xEnabled) {
        crossPostTasks.push(
          crossPostScheduledToX({
            userId: post.user_id,
            teamId: resolvedTeamId,
            targetAccountId: xTargetAccountId,
            content: payloads.x.content,
            threadParts: payloads.x.threadParts || [],
            postMode: payloads.x.postMode || 'single',
            media: crossPostMedia,
            mediaDetected,
          })
            .then((result) => {
              if (result?.status === 'posted') {
                saveToTweetHistory({
                  userId: post.user_id,
                  teamId: resolvedTeamId,
                  targetAccountId: xTargetAccountId,
                  content: payloads.x.content,
                  tweetId: result.tweetId || null,
                  mediaDetected,
                  media: crossPostMedia,
                  postMode: payloads.x.postMode || 'single',
                  threadParts: payloads.x.threadParts || [],
                }).catch((err) => {
                  logger.warn('[LinkedIn Scheduler] Failed to save X history (non-blocking)', {
                    userId: post.user_id,
                    error: err?.message || String(err),
                  });
                });
              }
              return { platform: 'x', result };
            })
            .catch((err) => {
              logger.error('[LinkedIn Scheduler] X cross-post error', {
                userId: post.user_id,
                error: err?.message || String(err),
              });
              return { platform: 'x', result: { status: 'failed' } };
            })
        );
      }

      if (threadsEnabled) {
        crossPostTasks.push(
          crossPostScheduledToThreads({
            userId: post.user_id,
            teamId: resolvedTeamId,
            targetAccountId: threadsTargetAccountId,
            content: payloads.threads.content,
            media: crossPostMedia,
            mediaDetected,
            optimizeCrossPost: crossPostMeta.optimizeCrossPost !== false,
          })
            .then((result) => ({ platform: 'threads', result }))
            .catch((err) => {
              logger.error('[LinkedIn Scheduler] Threads cross-post error', {
                userId: post.user_id,
                error: err?.message || String(err),
              });
              return { platform: 'threads', result: { status: 'failed' } };
            })
        );
      }

      const settlements = await Promise.allSettled(crossPostTasks);

      for (const settlement of settlements) {
        if (settlement.status === 'fulfilled') {
          const { platform, result } = settlement.value;
          crossPostResult[platform] = {
            ...crossPostResult[platform],
            ...result,
            status: result?.status || 'failed',
          };
        }
      }
    }

    crossPostMeta.last_attempted_at = new Date().toISOString();
    crossPostMeta.last_result = crossPostResult;
    nextMetadata = {
      ...baseMetadata,
      cross_post: crossPostMeta,
    };
  }

  await markScheduledPostCompleted(post.id, { metadata: nextMetadata });

  return linkedinResult?.id || linkedinResult?.urn || null;
}

async function schedulerTick() {
  if (tickInProgress) return;
  if (nextAllowedTickAt && Date.now() < nextAllowedTickAt) {
    return;
  }

  tickInProgress = true;
  const tickId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  schedulerStats.ticks += 1;
  lastTickSummary.tickId = tickId;
  lastTickSummary.startedAt = startedAt;
  lastTickSummary.status = 'running';
  lastTickSummary.error = null;
  lastTickSummary.processed = 0;
  lastTickSummary.succeeded = 0;
  lastTickSummary.retried = 0;
  lastTickSummary.failed = 0;

  try {
    const duePosts = await claimDueScheduledPosts(BATCH_SIZE);
    if (!duePosts.length) {
      transientFailureBackoffMs = 0;
      nextAllowedTickAt = 0;
      schedulerStats.noopTicks += 1;
      lastTickSummary.status = 'noop';
      // Only log noop ticks when explicitly enabled to avoid noisy logs in development
      if (process.env.LINKEDIN_SCHEDULER_LOG_NOOP === 'true') {
        logger.debug('[LinkedIn Scheduler] Tick noop', { tickId });
      }
      return;
    }

    transientFailureBackoffMs = 0;
    nextAllowedTickAt = 0;
    lastTickSummary.processed = duePosts.length;
    schedulerStats.processedPosts += duePosts.length;

    logger.info('[LinkedIn Scheduler] Processing due scheduled posts', {
      tickId,
      batchSize: duePosts.length
    });

    for (const post of duePosts) {
      try {
        const linkedinPostId = await processScheduledPost(post);
        logger.info('[LinkedIn Scheduler] Scheduled post published', {
          tickId,
          scheduledPostId: post.id,
          linkedinPostId
        });
        schedulerStats.succeededPosts += 1;
        lastTickSummary.succeeded += 1;
      } catch (error) {
        const retryResult = await scheduleRetryOrFail(post, error);
        if (retryResult?.outcome === 'retry') {
          schedulerStats.retriedPosts += 1;
          lastTickSummary.retried += 1;
        } else {
          schedulerStats.failedPosts += 1;
          lastTickSummary.failed += 1;
        }
      }
    }
    lastTickSummary.status = 'ok';
  } catch (error) {
    lastTickSummary.status = 'error';
    lastTickSummary.error = safeErrorMessage(error);
    if (isTransientConnectionError(error)) {
      transientFailureBackoffMs = computeTransientBackoffMs();
      nextAllowedTickAt = Date.now() + transientFailureBackoffMs;
      logger.warn('[LinkedIn Scheduler] Tick failed with transient DB/network error; backing off', {
        tickId,
        error: safeErrorMessage(error),
        backoffMs: transientFailureBackoffMs,
        nextRetryAt: new Date(nextAllowedTickAt).toISOString(),
      });
    } else {
      logger.error('[LinkedIn Scheduler] Tick failed', {
        tickId,
        error: safeErrorMessage(error)
      });
    }
  } finally {
    tickInProgress = false;
    lastTickFinishedAt = Date.now();
    lastTickSummary.finishedAt = lastTickFinishedAt;
    lastTickSummary.durationMs = lastTickFinishedAt - startedAt;
  }
}

export function getLinkedinSchedulerStatus() {
  const now = Date.now();
  const nextRunAt = schedulerStarted && lastTickFinishedAt
    ? new Date(lastTickFinishedAt + POLL_INTERVAL_MS).toISOString()
    : null;

  return {
    enabled: WORKER_ENABLED,
    started: schedulerStarted,
    startedAt: toIso(schedulerStartedAt),
    pid: process.pid,
    inProgress: tickInProgress,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS,
    retryColumnsAvailable,
    stats: { ...schedulerStats },
    lastTick: {
      tickId: lastTickSummary.tickId,
      startedAt: toIso(lastTickSummary.startedAt),
      finishedAt: toIso(lastTickSummary.finishedAt),
      durationMs: lastTickSummary.durationMs,
      status: lastTickSummary.status,
      error: lastTickSummary.error,
      processed: lastTickSummary.processed,
      succeeded: lastTickSummary.succeeded,
      retried: lastTickSummary.retried,
      failed: lastTickSummary.failed
    },
    nextRunAt,
    nextRunInMs: nextRunAt ? Math.max(0, new Date(nextRunAt).getTime() - now) : null
  };
}

export async function startLinkedinScheduler(options = {}) {
  if (schedulerStarted) {
    logger.warn('[LinkedIn Scheduler] Start requested but scheduler already running');
    return { started: true };
  }

  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : WORKER_ENABLED;
  if (!enabled) {
    logger.info('[LinkedIn Scheduler] Disabled by configuration');
    return { started: false };
  }

  schedulerStarted = true;
  schedulerStartedAt = Date.now();
  logger.info('[LinkedIn Scheduler] DB poller started', {
    intervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    maxAttempts: MAX_ATTEMPTS,
    retryBaseMs: RETRY_BASE_MS,
    retryMaxMs: RETRY_MAX_MS
  });

  await schedulerTick();
  schedulerInterval = setInterval(schedulerTick, POLL_INTERVAL_MS);

  if (typeof schedulerInterval.unref === 'function') {
    schedulerInterval.unref();
  }

  return { started: true };
}

export function stopLinkedinScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  schedulerStarted = false;
  schedulerStartedAt = null;
  tickInProgress = false;
}

if (process.env.LINKEDIN_SCHEDULER_AUTOSTART === 'true') {
  startLinkedinScheduler().catch((error) => {
    logger.error('[LinkedIn Scheduler] Autostart failed', { error: safeErrorMessage(error) });
  });
}

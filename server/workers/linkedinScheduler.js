import dotenv from 'dotenv';
import { pool } from '../config/database.js';
import { createLinkedInPost } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';

dotenv.config({ quiet: true });

const POLL_INTERVAL_MS = Number(process.env.LINKEDIN_SCHEDULER_POLL_MS || 15000);
const BATCH_SIZE = Number(process.env.LINKEDIN_SCHEDULER_BATCH_SIZE || 5);
const WORKER_ENABLED = process.env.LINKEDIN_SCHEDULER_ENABLED !== 'false';
const MAX_ATTEMPTS = Number(process.env.LINKEDIN_SCHEDULER_MAX_ATTEMPTS || 5);
const RETRY_BASE_MS = Number(process.env.LINKEDIN_SCHEDULER_RETRY_BASE_MS || 60000);
const RETRY_MAX_MS = Number(process.env.LINKEDIN_SCHEDULER_RETRY_MAX_MS || 900000);
const MAX_ERROR_LENGTH = 900;

const RETRY_COLUMNS = ['retry_count', 'next_retry_at', 'last_attempt_at'];

let tickInProgress = false;
let retrySchemaChecked = false;
let retryColumnsAvailable = false;
let schedulerStarted = false;
let schedulerInterval = null;
let schedulerStartedAt = null;
let lastTickFinishedAt = null;

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

const computeBackoffMs = (retryCount) => {
  const exponent = Math.max(0, retryCount - 1);
  const delay = RETRY_BASE_MS * Math.pow(2, exponent);
  return Math.min(delay, RETRY_MAX_MS);
};

const toIso = (value) => (value ? new Date(value).toISOString() : null);

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
    const { rows: teamRows } = await pool.query(
      `SELECT id, team_id, access_token, linkedin_user_id
       FROM linkedin_team_accounts
       WHERE active = true
         AND (team_id::text = $1 OR id::text = $1)
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [String(post.company_id)]
    );

    if (teamRows[0]?.access_token && teamRows[0]?.linkedin_user_id) {
      return {
        accessToken: teamRows[0].access_token,
        authorUrn: `urn:li:person:${teamRows[0].linkedin_user_id}`,
        linkedinUserId: teamRows[0].linkedin_user_id
      };
    }
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
       $1, $2, $3, $4, $5, $6, $7, 'posted', 0, 0, 0, 0, NOW(), NOW(), NOW()
     )`,
    [
      post.user_id,
      linkedinPostId,
      post.post_content,
      JSON.stringify(parseMediaUrls(post.media_urls)),
      post.post_type,
      post.company_id,
      linkedinUserId,
      initialShares
    ]
  );
}

async function markScheduledPostCompleted(postId) {
  await detectRetrySchemaSupport();

  const query = retryColumnsAvailable
    ? `UPDATE scheduled_linkedin_posts
       SET status = 'completed',
           posted_at = NOW(),
           error_message = NULL,
           next_retry_at = NULL,
           updated_at = NOW()
       WHERE id = $1`
    : `UPDATE scheduled_linkedin_posts
       SET status = 'completed',
           posted_at = NOW(),
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1`;

  await pool.query(query, [postId]);
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

  try {
    await addPostedEntry(post, linkedinResult, context.linkedinUserId);
  } catch (historyError) {
    logger.error('[LinkedIn Scheduler] Published but failed to insert linkedin_posts row', {
      scheduledPostId: post.id,
      error: safeErrorMessage(historyError)
    });
  }

  await markScheduledPostCompleted(post.id);

  return linkedinResult?.id || linkedinResult?.urn || null;
}

async function schedulerTick() {
  if (tickInProgress) return;

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
      schedulerStats.noopTicks += 1;
      lastTickSummary.status = 'noop';
      // Only log noop ticks when explicitly enabled to avoid noisy logs in development
      if (process.env.LINKEDIN_SCHEDULER_LOG_NOOP === 'true') {
        logger.debug('[LinkedIn Scheduler] Tick noop', { tickId });
      }
      return;
    }

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
    logger.error('[LinkedIn Scheduler] Tick failed', {
      tickId,
      error: safeErrorMessage(error)
    });
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

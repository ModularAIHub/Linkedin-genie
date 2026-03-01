
import { pool } from '../config/database.js';
import { create, findByUser, findById, updateStatus, deleteById } from '../models/scheduledPostModel.js';
import { DateTime } from 'luxon';
import { logger } from '../utils/logger.js';
import { getLinkedinSchedulerStatus } from '../workers/linkedinScheduler.js';
import {
  getUserTeamHints,
  isMeaningfulAccountId,
  resolveDefaultTeamAccountForUser,
  resolveTeamAccountForUser,
  shouldResolveLinkedInTeamAccount
} from '../utils/teamAccountScope.js';
import { resolveLinkedInAuthorIdentity } from '../utils/linkedinAuthorIdentity.js';
// LinkedIn Genie Schedule Controller

const MAX_BULK_SCHEDULE_ITEMS = 30;
const MAX_SCHEDULING_WINDOW_DAYS = 15;
const EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT = 100;
const ISO_OFFSET_SUFFIX = /(?:[zZ]|[+\-]\d{2}(?::?\d{2})?)$/;

function normalizeScheduledCrossPostTargets({ crossPostTargets = null, postToTwitter = false, postToX = false } = {}) {
  const raw =
    crossPostTargets && typeof crossPostTargets === 'object' && !Array.isArray(crossPostTargets)
      ? crossPostTargets
      : {};

  return {
    x:
      typeof raw.x === 'boolean'
        ? raw.x
        : (typeof raw.twitter === 'boolean' ? raw.twitter : Boolean(postToTwitter || postToX)),
    threads: typeof raw.threads === 'boolean' ? raw.threads : false,
  };
}

function normalizeScheduledCrossPostTargetAccountIds({ crossPostTargetAccountIds = null } = {}) {
  const raw =
    crossPostTargetAccountIds && typeof crossPostTargetAccountIds === 'object' && !Array.isArray(crossPostTargetAccountIds)
      ? crossPostTargetAccountIds
      : {};

  const normalize = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };

  return {
    x: normalize(raw.x ?? raw.twitter),
    threads: normalize(raw.threads),
  };
}

function normalizeScheduledCrossPostMedia(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
}

function buildScheduledCrossPostMetadata({ targets, optimizeCrossPost = true, routing = null, media = [] } = {}) {
  const x = Boolean(targets?.x);
  const threads = Boolean(targets?.threads);
  if (!x && !threads) return null;
  const normalizedMedia = normalizeScheduledCrossPostMedia(media);

  return {
    cross_post: {
      version: 2,
      source: 'linkedin_genie_schedule',
      createdAt: new Date().toISOString(),
      optimizeCrossPost: optimizeCrossPost !== false,
      targets: {
        x,
        threads,
      },
      ...(routing && typeof routing === 'object' ? { routing } : {}),
      ...(normalizedMedia.length > 0 ? { media: normalizedMedia } : {}),
    },
  };
}

async function resolveTeamAdminAccount(req, userId) {
  const selectedAccountId =
    req.headers['x-selected-account-id'] || req.body?.account_id || req.body?.company_id;
  const preferredTeamIds = getUserTeamHints(req.user);
  const shouldResolveSelectedTeamAccount = shouldResolveLinkedInTeamAccount(selectedAccountId);
  let teamAccount = shouldResolveSelectedTeamAccount
    ? await resolveTeamAccountForUser(userId, selectedAccountId, {
        allowedRoles: ['owner', 'admin']
      })
    : null;

  if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
    teamAccount = await resolveDefaultTeamAccountForUser(userId, {
      allowedRoles: ['owner', 'admin'],
      preferredTeamIds
    });
  }

  return teamAccount;
}

function getScopedCompanyIds(teamAccount) {
  if (!teamAccount) return [];
  return [String(teamAccount.team_id), String(teamAccount.id)];
}

function canManageScheduledPost(post, userId, teamAccount) {
  if (!post) return false;
  if (post.user_id === userId) return true;
  if (!teamAccount || !post.company_id) return false;
  const scopedCompanyIds = getScopedCompanyIds(teamAccount);
  return scopedCompanyIds.includes(String(post.company_id));
}

function parseJsonObject(value, fallback = {}) {
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
}

function toUtcIso(value) {
  if (!value) return null;

  if (typeof value === 'number') {
    const dateTime = DateTime.fromMillis(value, { zone: 'utc' });
    return dateTime.isValid ? dateTime.toUTC().toISO() : null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    // LinkedIn Genie reads external schedule rows directly from other apps' tables.
    // When Postgres TIMESTAMP WITHOUT TIME ZONE values are parsed as JS Dates without
    // a UTC parser override, the local timezone gets applied. Rebuild from local
    // wall-clock components and treat them as UTC to preserve the stored UTC value.
    const rebuiltUtc = DateTime.fromObject(
      {
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        day: value.getDate(),
        hour: value.getHours(),
        minute: value.getMinutes(),
        second: value.getSeconds(),
        millisecond: value.getMilliseconds(),
      },
      { zone: 'utc' }
    );

    return rebuiltUtc.isValid ? rebuiltUtc.toUTC().toISO() : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw.replace(' ', 'T');
  let parsed = null;

  if (ISO_OFFSET_SUFFIX.test(normalized)) {
    parsed = DateTime.fromISO(normalized, { setZone: true });
    if (!parsed.isValid) {
      parsed = DateTime.fromSQL(raw, { setZone: true });
    }
  } else {
    parsed = DateTime.fromISO(normalized, { zone: 'utc' });
    if (!parsed.isValid) {
      parsed = DateTime.fromSQL(raw, { zone: 'utc' });
    }
  }

  return parsed?.isValid ? parsed.toUTC().toISO() : null;
}

function mapTweetGenieLinkedInCrossScheduleStatus(row) {
  const sourceStatus = String(row?.status || '').toLowerCase();
  const metadata = parseJsonObject(row?.metadata, {});
  const linkedinResultStatus = String(
    metadata?.cross_post?.last_result?.linkedin?.status || ''
  ).toLowerCase();

  if (sourceStatus === 'cancelled') return 'cancelled';
  if (sourceStatus === 'failed') return 'failed';
  if (sourceStatus === 'pending' || sourceStatus === 'processing') return 'scheduled';

  if (sourceStatus === 'completed' || sourceStatus === 'partially_completed') {
    if (!linkedinResultStatus) {
      // Older rows or missing metadata result; source tweet completed so mark as posted fallback.
      return 'completed';
    }

    if (linkedinResultStatus === 'posted') return 'completed';
    if (
      [
        'failed',
        'timeout',
        'not_connected',
        'skipped_not_configured',
        'skipped_source_thread_failed',
      ].includes(linkedinResultStatus)
    ) {
      return 'failed';
    }
    return 'completed';
  }

  return 'scheduled';
}

function resolveTweetGenieLinkedInTargetAccountId(metadata) {
  const crossPostMeta =
    metadata?.cross_post && typeof metadata.cross_post === 'object' ? metadata.cross_post : {};
  const routing =
    crossPostMeta?.routing && typeof crossPostMeta.routing === 'object' ? crossPostMeta.routing : {};
  const linkedinRoute =
    routing?.linkedin && typeof routing.linkedin === 'object' ? routing.linkedin : null;

  if (linkedinRoute?.targetAccountId !== undefined && linkedinRoute?.targetAccountId !== null) {
    const normalized = String(linkedinRoute.targetAccountId).trim();
    return normalized || null;
  }

  return null;
}

function buildExternalLinkedInScheduledRow(row) {
  const metadata = parseJsonObject(row?.metadata, {});
  const linkedinCrossPostMeta =
    metadata?.cross_post && typeof metadata.cross_post === 'object' ? metadata.cross_post : {};
  const linkedinLastResult =
    linkedinCrossPostMeta?.last_result?.linkedin &&
    typeof linkedinCrossPostMeta.last_result.linkedin === 'object'
      ? linkedinCrossPostMeta.last_result.linkedin
      : null;
  const targetAccountId = resolveTweetGenieLinkedInTargetAccountId(metadata);
  // Do NOT fall back to row.team_id: that is a Twitter team ID, not a LinkedIn
  // company/team ID. Using it would cause the LinkedIn team-mode company_id filter
  // to never match, hiding cross-posted rows in team mode.
  const companyId = targetAccountId || null;
  const fallbackMedia = Array.isArray(linkedinCrossPostMeta?.media) ? linkedinCrossPostMeta.media : [];

  const mappedStatus = mapTweetGenieLinkedInCrossScheduleStatus(row);

  return {
    id: `tgx-${row.id}`,
    post_content: row.content || '',
    media_urls: row.media_urls || JSON.stringify(fallbackMedia),
    post_type: 'single_post',
    company_id: companyId,
    scheduled_time: toUtcIso(row.scheduled_for) || row.scheduled_for,
    timezone: row.timezone || null,
    status: mappedStatus,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    posted_at: row.posted_at || null,
    error_message:
      row.error_message ||
      (linkedinLastResult?.status && linkedinLastResult.status !== 'posted'
        ? `LinkedIn cross-post status: ${linkedinLastResult.status}`
        : null),
    is_external_cross_post: true,
    external_source: 'tweet-genie',
    external_ref_id: row.id,
    external_target: 'linkedin',
    external_read_only: true,
    external_meta: {
      source_status: row.status || null,
      linkedin_status: linkedinLastResult?.status || null,
      last_attempted_at: linkedinCrossPostMeta?.last_attempted_at || null,
      target_account_id: targetAccountId,
      team_id: null,
    },
  };
}

function mapSocialThreadsLinkedInCrossScheduleStatus(row) {
  const sourceStatus = String(row?.status || '').toLowerCase();
  const metadata = parseJsonObject(row?.metadata, {});
  const linkedinResultStatus = String(
    metadata?.cross_post?.last_result?.linkedin?.status || ''
  ).toLowerCase();

  if (sourceStatus === 'deleted') return 'cancelled';
  if (sourceStatus === 'failed') return 'failed';
  if (sourceStatus === 'publishing') return 'scheduled';
  if (sourceStatus === 'scheduled') return 'scheduled';

  if (sourceStatus === 'posted') {
    if (!linkedinResultStatus) return 'completed';
    if (linkedinResultStatus === 'posted') return 'completed';
    if (
      [
        'failed',
        'timeout',
        'not_connected',
        'skipped_not_configured',
        'skipped_individual_only',
      ].includes(linkedinResultStatus)
    ) {
      return 'failed';
    }
    return 'completed';
  }

  return 'scheduled';
}

function buildExternalLinkedInScheduledRowFromSocial(row) {
  const metadata = parseJsonObject(row?.metadata, {});
  const crossPostMeta =
    metadata?.cross_post && typeof metadata.cross_post === 'object' ? metadata.cross_post : {};
  const linkedinLastResult =
    crossPostMeta?.last_result?.linkedin &&
    typeof crossPostMeta.last_result.linkedin === 'object'
      ? crossPostMeta.last_result.linkedin
      : null;
  const routing =
    crossPostMeta?.routing && typeof crossPostMeta.routing === 'object' ? crossPostMeta.routing : {};
  const linkedinRoute =
    routing?.linkedin && typeof routing.linkedin === 'object' ? routing.linkedin : null;
  const targetAccountId =
    linkedinRoute?.targetAccountId !== undefined && linkedinRoute?.targetAccountId !== null
      ? String(linkedinRoute.targetAccountId).trim() || null
      : null;
  const mappedStatus = mapSocialThreadsLinkedInCrossScheduleStatus(row);

  return {
    id: `sgx-${row.id}`,
    post_content: row.caption || '',
    media_urls: row.media_urls || JSON.stringify([]),
    post_type: 'single_post',
    company_id: targetAccountId || row.team_id || null,
    scheduled_time: toUtcIso(row.scheduled_for) || row.scheduled_for,
    timezone: null,
    status: mappedStatus,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    posted_at: row.posted_at || null,
    error_message:
      row.error_message ||
      (linkedinLastResult?.status && linkedinLastResult.status !== 'posted'
        ? `Threads cross-post to LinkedIn status: ${linkedinLastResult.status}`
        : null),
    is_external_cross_post: true,
    external_source: 'social-genie',
    external_ref_id: row.id,
    external_target: 'linkedin',
    external_read_only: true,
    external_meta: {
      source_status: row.status || null,
      linkedin_status: linkedinLastResult?.status || null,
      last_attempted_at: crossPostMeta?.last_attempted_at || null,
      target_account_id: targetAccountId,
      team_id: row.team_id || null,
    },
  };
}

async function fetchExternalTweetGenieLinkedInCrossSchedules(
  userId,
  {
    status,
    limit = EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT,
  } = {}
) {
  const safeLimit = Math.max(1, Math.min(EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT, Number(limit) || EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT));
  // Always query by user_id — scheduled_tweets.team_id is a Twitter-app team ID
  // which has no relation to LinkedIn team IDs. Cross-app ownership is correctly
  // established through the shared user_id.

  const { rows } = await pool.query(
    `SELECT id, user_id, team_id, content, media_urls, scheduled_for, timezone, status, error_message, metadata, created_at, updated_at, posted_at
     FROM scheduled_tweets
     WHERE user_id = $1
       AND (
         metadata->'cross_post'->'targets'->>'linkedin' = 'true'
       )
     ORDER BY scheduled_for DESC
     LIMIT $2`,
    [userId, safeLimit]
  );

  const mapped = rows
    .map(buildExternalLinkedInScheduledRow);
  // Note: company_id on external rows is the LinkedIn targetAccountId from metadata.
  // We do NOT filter by scopedCompanyIds here – rows with company_id=null are shown
  // because we cannot reliably map Twitter team IDs to LinkedIn company IDs.
  if (!status) return mapped;

  const normalizedStatus = String(status).toLowerCase();
  return mapped.filter((row) => String(row.status || '').toLowerCase() === normalizedStatus);
}

async function fetchExternalSocialGenieLinkedInCrossSchedules(
  userId,
  {
    status,
    limit = EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT,
    teamId = null,
    scopedCompanyIds = [],
  } = {}
) {
  const safeLimit = Math.max(1, Math.min(EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT, Number(limit) || EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT));
  const ownerClause = teamId
    ? `team_id::text = $1`
    : `user_id = $1 AND (team_id IS NULL OR team_id::text = '')`;
  const ownerParam = teamId ? String(teamId) : userId;
  const normalizedScopedCompanyIds = Array.isArray(scopedCompanyIds)
    ? scopedCompanyIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  const { rows } = await pool.query(
    `SELECT *
     FROM social_posts
     WHERE ${ownerClause}
       AND scheduled_for IS NOT NULL
     ORDER BY COALESCE(scheduled_for, created_at) DESC
     LIMIT $2`,
    [ownerParam, safeLimit]
  );

  const mapped = rows
    .filter((row) => {
      const metadata = parseJsonObject(row?.metadata, {});
      const targets = metadata?.cross_post?.targets;
      return Boolean(targets?.linkedin || targets?.linkedIn);
    })
    .map(buildExternalLinkedInScheduledRowFromSocial)
    .filter((row) => {
      if (normalizedScopedCompanyIds.length === 0) return true;
      const companyId = row?.company_id !== undefined && row?.company_id !== null ? String(row.company_id).trim() : '';
      return companyId ? normalizedScopedCompanyIds.includes(companyId) : false;
    });

  if (!status) return mapped;
  const normalizedStatus = String(status).toLowerCase();
  return mapped.filter((row) => String(row.status || '').toLowerCase() === normalizedStatus);
}


// Schedule a LinkedIn post
export async function schedulePost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const {
      post_content,
      media_urls,
      post_type,
      company_id,
      account_id,
      scheduled_time,
      user_timezone,
      crossPostTargets = null,
      optimizeCrossPost = true,
      postToTwitter = false,
      postToX = false,
      crossPostTargetAccountIds = null,
      crossPostTargetAccountLabels = null,
      crossPostMedia = [],
    } = req.body;
    if (!post_content || !scheduled_time) return res.status(400).json({ error: 'Missing post content or scheduled time' });

    const selectedAccountId = account_id || req.headers['x-selected-account-id'] || company_id;
    const preferredTeamIds = getUserTeamHints(req.user);
    const shouldResolveSelectedTeamAccount = shouldResolveLinkedInTeamAccount(selectedAccountId);
    let teamAccount = shouldResolveSelectedTeamAccount
      ? await resolveTeamAccountForUser(userId, selectedAccountId)
      : null;
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }

    if (shouldResolveSelectedTeamAccount && !teamAccount) {
      return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
    }

    // Convert local time + timezone to UTC
    let scheduledTimeUtc;
    if (user_timezone) {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time, { zone: user_timezone }).toUTC().toISO();
    } else {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time).toUTC().toISO();
    }
    const scheduledDateTimeUtc = DateTime.fromISO(scheduledTimeUtc, { zone: 'utc' });
    if (!scheduledDateTimeUtc.isValid) {
      return res.status(400).json({ error: 'Invalid scheduled time' });
    }
    const maxSchedulingUtc = DateTime.utc().plus({ days: MAX_SCHEDULING_WINDOW_DAYS });
    if (scheduledDateTimeUtc > maxSchedulingUtc) {
      return res.status(400).json({
        error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
      });
    }

    let linkedinAccessToken = req.user?.linkedinAccessToken;
    let authorUrn = req.user?.linkedinUrn;
    const fixedCompanyId = teamAccount ? teamAccount.team_id : null;

    if (teamAccount) {
      linkedinAccessToken = teamAccount.access_token;
      authorUrn = resolveLinkedInAuthorIdentity(teamAccount).authorUrn;
    }

    if (!linkedinAccessToken || !authorUrn) {
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }

    const requestedCrossPostTargets = normalizeScheduledCrossPostTargets({
      crossPostTargets,
      postToTwitter,
      postToX,
    });
    const normalizedCrossPostTargetAccountIds = normalizeScheduledCrossPostTargetAccountIds({
      crossPostTargetAccountIds,
    });
    const getTargetLabel = (key) =>
      crossPostTargetAccountLabels &&
      typeof crossPostTargetAccountLabels === 'object' &&
      !Array.isArray(crossPostTargetAccountLabels) &&
      crossPostTargetAccountLabels[key] !== undefined &&
      crossPostTargetAccountLabels[key] !== null
        ? String(crossPostTargetAccountLabels[key]).trim().slice(0, 255) || null
        : null;
    const crossPostRouting = (() => {
      const routing = {};
      if (requestedCrossPostTargets.x && normalizedCrossPostTargetAccountIds.x) {
        routing.x = {
          targetAccountId: normalizedCrossPostTargetAccountIds.x,
          ...(getTargetLabel('x') ? { targetLabel: getTargetLabel('x') } : {}),
        };
      }
      if (requestedCrossPostTargets.threads && normalizedCrossPostTargetAccountIds.threads) {
        routing.threads = {
          targetAccountId: normalizedCrossPostTargetAccountIds.threads,
          ...(getTargetLabel('threads') ? { targetLabel: getTargetLabel('threads') } : {}),
        };
      }
      return Object.keys(routing).length > 0 ? routing : null;
    })();

    const effectiveCrossPostTargets = requestedCrossPostTargets;
    const crossPostMetadata = buildScheduledCrossPostMetadata({
      targets: effectiveCrossPostTargets,
      optimizeCrossPost,
      routing: crossPostRouting,
      media: crossPostMedia,
    });

    // Save to DB
    const scheduledPost = await create({
      user_id: userId,
      post_content,
      media_urls,
      post_type,
      company_id: fixedCompanyId,
      scheduled_time: scheduledTimeUtc,
      timezone: user_timezone || null,
      metadata: crossPostMetadata,
      status: 'scheduled'
    });

    logger.info('[ScheduleController] Scheduled post created', {
      scheduledPostId: scheduledPost.id,
      scheduledTimeUtc,
      crossPostTargets: effectiveCrossPostTargets,
    });
    res.json({ success: true, scheduledPost });
  } catch (error) {
    logger.error('[schedulePost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// List scheduled LinkedIn posts for user
export async function getScheduledPosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { status, limit, offset } = req.query;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    const shouldResolveSelectedTeamAccount = shouldResolveLinkedInTeamAccount(selectedAccountId);
    let teamAccount = shouldResolveSelectedTeamAccount
      ? await resolveTeamAccountForUser(userId, selectedAccountId)
      : null;
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }
    const companyIds = teamAccount
      ? [String(teamAccount.team_id), String(teamAccount.id)]
      : undefined;

    // Fetch internal posts with a wider window (internal + external cap) so that
    // when external rows are merged and the final slice is applied, the page has
    // enough rows to fill correctly without double-cutting.
    const safeOffset = offset ? parseInt(offset) : 0;
    const safeLimit = limit ? parseInt(limit) : 20;
    const internalFetchLimit = safeLimit + EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT;
    const internalPosts = await findByUser(userId, {
      status,
      limit: internalFetchLimit,
      offset: 0,
      companyIds
    });

    // Show Tweet Genie -> LinkedIn cross-schedules as read-only external rows for visibility.
    // These are not scheduled_linkedin_posts rows; Tweet Genie owns execution.
    let externalPosts = [];
    try {
      const [tweetGenieExternalPosts, socialGenieExternalPosts] = await Promise.all([
        fetchExternalTweetGenieLinkedInCrossSchedules(userId, {
          status,
          limit: EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT,
        }),
        fetchExternalSocialGenieLinkedInCrossSchedules(userId, {
          status,
          limit: EXTERNAL_CROSS_SCHEDULE_FETCH_LIMIT,
          teamId: teamAccount ? teamAccount.team_id : null,
          scopedCompanyIds: teamAccount ? companyIds : [],
        }),
      ]);
      externalPosts = [...tweetGenieExternalPosts, ...socialGenieExternalPosts];
    } catch (externalError) {
      logger.warn('[getScheduledPosts] Failed to load external Tweet Genie cross-schedules', {
        userId,
        error: externalError?.message || String(externalError),
      });
      externalPosts = [];
    }

    const mergedPosts = [...internalPosts, ...externalPosts]
      .sort((a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime());

    const pagedPosts = mergedPosts.slice(safeOffset, safeOffset + safeLimit);

    res.json({ posts: pagedPosts });
  } catch (error) {
    logger.error('[getScheduledPosts] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Cancel a scheduled LinkedIn post
export async function cancelScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });
    const post = await findById(id);
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

    await updateStatus(id, 'cancelled');
    res.json({ success: true });
  } catch (error) {
    logger.error('[cancelScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Delete a scheduled LinkedIn post
export async function deleteScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });
    const post = await findById(id);
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

    if (post.user_id === userId) {
      await deleteById(id, userId);
    } else {
      const scopedCompanyIds = getScopedCompanyIds(teamAccount);
      await pool.query(
        `DELETE FROM scheduled_linkedin_posts
         WHERE id = $1
           AND company_id::text = ANY($2::text[])`,
        [id, scopedCompanyIds]
      );
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('[deleteScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Retry a failed scheduled LinkedIn post
export async function retryFailedScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });

    const post = await findById(id);
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

    if (post.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed scheduled posts can be retried' });
    }

    const scopedCompanyIds = getScopedCompanyIds(teamAccount);
    const canUseTeamScope = post.user_id !== userId && scopedCompanyIds.length > 0;

    let updatedRow = null;
    try {
      const { rows } = canUseTeamScope
        ? await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 retry_count = 0,
                 next_retry_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1
               AND company_id::text = ANY($2::text[])
             RETURNING *`,
            [id, scopedCompanyIds]
          )
        : await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 retry_count = 0,
                 next_retry_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
          );
      updatedRow = rows[0] || null;
    } catch (error) {
      if (error?.code !== '42703') {
        throw error;
      }

      // Backward compatibility before retry columns migration.
      const { rows } = canUseTeamScope
        ? await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND company_id::text = ANY($2::text[])
             RETURNING *`,
            [id, scopedCompanyIds]
          )
        : await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1 AND user_id = $2
             RETURNING *`,
            [id, userId]
          );
      updatedRow = rows[0] || null;
    }

    res.json({ success: true, post: updatedRow });
  } catch (error) {
    logger.error('[retryFailedScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Scheduler runtime status for debugging
export async function getSchedulerStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const scheduler = getLinkedinSchedulerStatus();
    const selectedAccountId = req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    const shouldResolveSelectedTeamAccount = shouldResolveLinkedInTeamAccount(selectedAccountId);
    let teamAccount = shouldResolveSelectedTeamAccount
      ? await resolveTeamAccountForUser(userId, selectedAccountId)
      : null;
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }
    const companyIds = teamAccount
      ? [String(teamAccount.team_id), String(teamAccount.id)]
      : undefined;

    let countsByStatus = {};
    const { rows: statusRows } = companyIds
      ? await pool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM scheduled_linkedin_posts
           WHERE company_id::text = ANY($1::text[])
           GROUP BY status`,
          [companyIds]
        )
      : await pool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM scheduled_linkedin_posts
           WHERE user_id = $1
           GROUP BY status`,
          [userId]
        );
    countsByStatus = statusRows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    let dueNowCount = 0;
    try {
      const { rows: dueRows } = companyIds
        ? await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE company_id::text = ANY($1::text[])
               AND status = 'scheduled'
               AND COALESCE(next_retry_at, scheduled_time) <= NOW()`,
            [companyIds]
          )
        : await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE user_id = $1
               AND status = 'scheduled'
               AND COALESCE(next_retry_at, scheduled_time) <= NOW()`,
            [userId]
          );
      dueNowCount = dueRows[0]?.count || 0;
    } catch (error) {
      if (error?.code !== '42703') throw error;
      const { rows: fallbackRows } = companyIds
        ? await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE company_id::text = ANY($1::text[])
               AND status = 'scheduled'
               AND scheduled_time <= NOW()`,
            [companyIds]
          )
        : await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE user_id = $1
               AND status = 'scheduled'
               AND scheduled_time <= NOW()`,
            [userId]
          );
      dueNowCount = fallbackRows[0]?.count || 0;
    }

    res.json({
      scheduler,
      userQueue: {
        countsByStatus,
        dueNowCount
      }
    });
  } catch (error) {
    logger.error('[getSchedulerStatus] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Bulk schedule LinkedIn posts
export async function bulkSchedulePosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { items, frequency, startDate, postsPerDay = 1, dailyTimes = ['09:00'], daysOfWeek, images, timezone = 'UTC', account_id } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }
    if (items.length > MAX_BULK_SCHEDULE_ITEMS) {
      return res.status(400).json({
        error: `Bulk scheduling is limited to ${MAX_BULK_SCHEDULE_ITEMS} prompts at a time.`,
      });
    }

    const selectedAccountId = account_id || req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    const shouldResolveSelectedTeamAccount = shouldResolveLinkedInTeamAccount(selectedAccountId);
    let teamAccount = shouldResolveSelectedTeamAccount
      ? await resolveTeamAccountForUser(userId, selectedAccountId)
      : null;
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }

    if (shouldResolveSelectedTeamAccount && !teamAccount) {
      return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
    }

    const linkedinAccessToken = teamAccount?.access_token || req.user?.linkedinAccessToken;
    const authorUrn = teamAccount
      ? resolveLinkedInAuthorIdentity(teamAccount).authorUrn
      : req.user?.linkedinUrn;
    const companyId = teamAccount ? teamAccount.team_id : null;

    if (!linkedinAccessToken || !authorUrn) {
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    const scheduled = [];
    let scheduledCount = 0;
    let current = DateTime.fromISO(startDate, { zone: timezone });
    if (!current.isValid) {
      return res.status(400).json({ error: 'Invalid start date or timezone' });
    }
    const maxSchedulingUtc = DateTime.utc().plus({ days: MAX_SCHEDULING_WINDOW_DAYS });
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let content = item.text;
      let media = images?.[i] || [];
      
      let scheduledForLocal;
      
      if (frequency === 'daily') {
        const dayOffset = Math.floor(scheduledCount / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        scheduledForLocal = current.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        const postsPerCycle = days.length * postsPerDay;
        const cycleNum = Math.floor(scheduledCount / postsPerCycle);
        const positionInCycle = scheduledCount % postsPerCycle;
        const dayIndex = Math.floor(positionInCycle / postsPerDay);
        const timeIndex = positionInCycle % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        scheduledForLocal = current.plus({ weeks: cycleNum }).set({ weekday: days[dayIndex], hour, minute, second: 0, millisecond: 0 });
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
        const postsPerCycle = daysOfWeek.length * postsPerDay;
        const cycleNum = Math.floor(scheduledCount / postsPerCycle);
        const positionInCycle = scheduledCount % postsPerCycle;
        const dayIndex = Math.floor(positionInCycle / postsPerDay);
        const timeIndex = positionInCycle % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        // daysOfWeek uses Sunday=0, Monday=1, etc.
        // luxon uses Monday=1, Sunday=7, so we need to convert
        const luxonWeekday = daysOfWeek[dayIndex] === 0 ? 7 : daysOfWeek[dayIndex];
        scheduledForLocal = current.plus({ weeks: cycleNum }).set({ weekday: luxonWeekday, hour, minute, second: 0, millisecond: 0 });
      } else {
        // Fallback: daily with first time
        const [hour, minute] = (dailyTimes[0] || '09:00').split(':').map(Number);
        scheduledForLocal = current.plus({ days: scheduledCount }).set({ hour, minute, second: 0, millisecond: 0 });
      }
      
      const scheduledForUtcDateTime = scheduledForLocal.toUTC();
      if (!scheduledForUtcDateTime.isValid) {
        return res.status(400).json({ error: 'Invalid scheduling parameters' });
      }
      if (scheduledForUtcDateTime > maxSchedulingUtc) {
        return res.status(400).json({
          error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
        });
      }

      const scheduledForUTC = scheduledForUtcDateTime.toISO();
      
      // Save to DB
      const scheduledPost = await create({
        user_id: userId,
        post_content: content,
        media_urls: media,
        post_type: 'text',
        company_id: companyId,
        scheduled_time: scheduledForUTC,
        status: 'scheduled'
      });
      
      scheduled.push({
        id: scheduledPost.id,
        content: content.substring(0, 50) + '...',
        scheduledFor: scheduledForLocal.toISO()
      });
      
      scheduledCount++;
    }
    
    res.json({ success: true, scheduled, count: scheduled.length });
  } catch (error) {
    logger.error('[bulkSchedulePosts] Error', error);
    res.status(500).json({ error: error.message });
  }
}

import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import resendEmailService from '../services/resendEmailService.js';
import commentReplyAssistService from '../services/commentReplyAssistService.js';

const DEFAULT_NOTIFICATION_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_USERS_PER_TICK = 25;
const DEFAULT_COMMENT_SAMPLE_LIMIT = 3;
const DEFAULT_READY_POST_LOOKBACK_HOURS = 24;
const DEFAULT_AUTO_REPLY_DRAFTS_PER_USER = 2;
const DEFAULT_AUTO_REPLY_USER_SCAN_LIMIT = 20;
const AUTO_REPLY_MAX_COMMENT_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let notificationTickInProgress = false;
let lastNotificationTickAt = 0;

const toPositiveInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const sanitizeText = (value = '') =>
  String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toShortText = (value = '', max = 320) => {
  const normalized = sanitizeText(value);
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 320;
  return normalized.slice(0, safeMax);
};

const escapeHtml = (value = '') =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isMissingTableError = (error = null) => String(error?.code || '') === '42P01';

const notificationsEnabled = () => {
  const raw = String(process.env.LINKEDIN_EMAIL_NOTIFICATIONS_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
};

const getNotificationIntervalMs = () =>
  toPositiveInt(process.env.LINKEDIN_NOTIFICATION_POLL_MS, DEFAULT_NOTIFICATION_INTERVAL_MS, {
    min: 60 * 1000,
    max: 24 * 60 * 60 * 1000,
  });

const getMaxUsersPerTick = () =>
  toPositiveInt(process.env.LINKEDIN_NOTIFICATION_MAX_USERS_PER_TICK, DEFAULT_MAX_USERS_PER_TICK, {
    min: 1,
    max: 100,
  });

const getCommentSampleLimit = () =>
  toPositiveInt(process.env.LINKEDIN_NOTIFICATION_COMMENT_SAMPLE_LIMIT, DEFAULT_COMMENT_SAMPLE_LIMIT, {
    min: 1,
    max: 5,
  });

const getReadyPostLookbackHours = () =>
  toPositiveInt(process.env.LINKEDIN_NOTIFICATION_READY_LOOKBACK_HOURS, DEFAULT_READY_POST_LOOKBACK_HOURS, {
    min: 6,
    max: 72,
  });

const autoReplyDraftsEnabled = () => {
  const raw = String(process.env.LINKEDIN_AUTO_REPLY_DRAFTS_ENABLED || '').trim().toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'off', 'no'].includes(raw);
};

const getAutoReplyDraftsPerUser = () =>
  toPositiveInt(process.env.LINKEDIN_AUTO_REPLY_DRAFTS_PER_USER, DEFAULT_AUTO_REPLY_DRAFTS_PER_USER, {
    min: 1,
    max: 5,
  });

const getAutoReplyUserScanLimit = () =>
  toPositiveInt(process.env.LINKEDIN_AUTO_REPLY_USER_SCAN_LIMIT, DEFAULT_AUTO_REPLY_USER_SCAN_LIMIT, {
    min: 1,
    max: 50,
  });

const resolveAppBaseUrl = () => {
  const candidate =
    String(process.env.LINKEDIN_APP_URL || process.env.CLIENT_URL || 'http://localhost:5175').trim() ||
    'http://localhost:5175';
  if (/^https?:\/\//i.test(candidate)) return candidate.replace(/\/$/, '');
  return `https://${candidate.replace(/\/$/, '')}`;
};

const buildAppUrl = (path = '/') => {
  try {
    return new URL(path, `${resolveAppBaseUrl()}/`).toString();
  } catch {
    return resolveAppBaseUrl();
  }
};

const buildEmailShell = ({ title, subtitle, bodyHtml, ctaLabel, ctaUrl, footerNote }) => `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#0f172a;color:#ffffff;">
                <div style="font-size:20px;font-weight:700;line-height:1.35;">${escapeHtml(title)}</div>
                <div style="font-size:14px;opacity:0.9;margin-top:8px;line-height:1.45;">${escapeHtml(subtitle)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#111827;">
                ${bodyHtml}
                <div style="margin-top:24px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">
                    ${escapeHtml(ctaLabel)}
                  </a>
                </div>
                <div style="margin-top:24px;font-size:12px;color:#6b7280;">
                  ${escapeHtml(footerNote)}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const toTextList = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => toShortText(item, 180))
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join('\n');

const buildCommentReplyEmail = (target = {}) => {
  const pendingCount = Number(target?.pending_count || 0);
  const sampleComments = Array.isArray(target?.sample_comments) ? target.sample_comments : [];
  const cleanName = toShortText(target?.user_name || 'there', 80);
  const ctaUrl = buildAppUrl('/engagement');
  const subject =
    pendingCount === 1
      ? '1 LinkedIn reply draft is ready for approval'
      : `${pendingCount} LinkedIn reply drafts are ready for approval`;

  const sampleHtml = sampleComments.length
    ? `<p style="margin:0 0 8px 0;font-weight:600;">Recent comments:</p>
       <ul style="margin:0;padding-left:20px;">
         ${sampleComments
           .map((comment) => `<li style="margin-bottom:6px;">${escapeHtml(toShortText(comment, 220))}</li>`)
           .join('')}
       </ul>`
    : '';

  const html = buildEmailShell({
    title: 'Approval needed for AI reply drafts',
    subtitle: `Hi ${cleanName}, we generated grounded comment replies for your latest LinkedIn comments.`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">You currently have <strong>${pendingCount}</strong> reply draft${pendingCount === 1 ? '' : 's'} waiting in Engagement Assistant.</p>
      <p style="margin:0 0 12px 0;">Review the suggestions, approve the one you like, and post directly from the inbox.</p>
      ${sampleHtml}
    `,
    ctaLabel: 'Review Reply Drafts',
    ctaUrl,
    footerNote: 'Approval-required publishing stays unchanged. Replies are not sent automatically.',
  });

  const text = [
    `Hi ${cleanName},`,
    '',
    `You have ${pendingCount} LinkedIn reply draft${pendingCount === 1 ? '' : 's'} waiting for approval.`,
    'Open Engagement Assistant to review and approve:',
    ctaUrl,
    '',
    sampleComments.length ? 'Recent comments:' : '',
    sampleComments.length ? toTextList(sampleComments) : '',
    '',
    'Replies are not sent automatically until you approve and send.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text, ctaUrl };
};

const buildReadyPostsEmail = (target = {}) => {
  const approvedCount = Number(target?.approved_count || 0);
  const needsApprovalCount = Number(target?.needs_approval_count || 0);
  const readyTotal = approvedCount + needsApprovalCount;
  const cleanName = toShortText(target?.user_name || 'there', 80);
  const ctaUrl = buildAppUrl('/strategy?tab=content');
  const subject =
    readyTotal === 1
      ? 'Your next LinkedIn post is ready to schedule'
      : `${readyTotal} LinkedIn posts are ready to schedule`;

  const html = buildEmailShell({
    title: 'Your LinkedIn queue is ready',
    subtitle: `Hi ${cleanName}, you have post ideas ready and no publish activity in the last 24 hours.`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">You currently have <strong>${readyTotal}</strong> queue item${readyTotal === 1 ? '' : 's'} ready:</p>
      <ul style="margin:0 0 12px 0;padding-left:20px;">
        <li style="margin-bottom:6px;"><strong>${approvedCount}</strong> approved and ready to schedule</li>
        <li><strong>${needsApprovalCount}</strong> waiting for review</li>
      </ul>
      <p style="margin:0;">Open your content queue and schedule the day's posts.</p>
    `,
    ctaLabel: 'Open Content Queue',
    ctaUrl,
    footerNote: 'This reminder is sent once per day while your queue is ready and no recent post is published.',
  });

  const text = [
    `Hi ${cleanName},`,
    '',
    `You have ${readyTotal} LinkedIn queue items ready and no post published in the last 24 hours.`,
    `- Approved: ${approvedCount}`,
    `- Waiting review: ${needsApprovalCount}`,
    '',
    `Open queue: ${ctaUrl}`,
  ].join('\n');

  return { subject, html, text, ctaUrl };
};

const fetchPendingCommentReplyTargets = async ({ userLimit, sampleLimit }) => {
  const { rows } = await pool.query(
    `WITH pending AS (
       SELECT
         a.id::text AS assist_id,
         a.user_id,
         a.comment_text,
         a.updated_at,
         ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a.updated_at DESC) AS rn
       FROM linkedin_comment_reply_assist a
       WHERE a.status = 'ready'
         AND NOT EXISTS (
           SELECT 1
           FROM linkedin_notification_events e
           WHERE e.user_id = a.user_id
             AND e.notification_type = 'comment_reply_ready'
             AND e.dedupe_key = a.id::text
         )
     )
     SELECT
       p.user_id::text AS user_id,
       COALESCE(NULLIF(u.name, ''), SPLIT_PART(u.email, '@', 1), 'there') AS user_name,
       u.email,
       COUNT(*)::INT AS pending_count,
       ARRAY_AGG(p.assist_id ORDER BY p.updated_at DESC) AS assist_ids,
       ARRAY_AGG(p.comment_text ORDER BY p.updated_at DESC) FILTER (WHERE p.rn <= $2) AS sample_comments
     FROM pending p
     JOIN users u ON u.id = p.user_id
     WHERE COALESCE(u.email, '') <> ''
     GROUP BY
       p.user_id,
       u.email,
       COALESCE(NULLIF(u.name, ''), SPLIT_PART(u.email, '@', 1), 'there')
     ORDER BY MAX(p.updated_at) DESC
     LIMIT $1`,
    [userLimit, sampleLimit]
  );

  return rows || [];
};

const fetchUsersWithCommentActivity = async ({ userLimit }) => {
  const { rows } = await pool.query(
    `SELECT user_id::text AS user_id
     FROM linkedin_posts
     WHERE status = 'posted'
       AND COALESCE(comments, 0) > 0
       AND COALESCE(linkedin_post_id, '') <> ''
       AND COALESCE(posted_at, created_at) >= NOW() - INTERVAL '30 days'
     GROUP BY user_id
     ORDER BY MAX(COALESCE(posted_at, created_at)) DESC
     LIMIT $1`,
    [userLimit]
  );
  return rows || [];
};

const fetchReadyPostReminderTargets = async ({ userLimit, dailyDedupeKey, lookbackHours }) => {
  const { rows } = await pool.query(
    `WITH queue_summary AS (
       SELECT
         q.user_id,
         COUNT(*) FILTER (WHERE q.status = 'approved')::INT AS approved_count,
         COUNT(*) FILTER (WHERE q.status = 'needs_approval')::INT AS needs_approval_count,
         MAX(q.updated_at) AS latest_queue_at
       FROM linkedin_automation_queue q
       WHERE q.status IN ('approved', 'needs_approval')
       GROUP BY q.user_id
     ),
     inactive_users AS (
       SELECT s.*
       FROM queue_summary s
       WHERE NOT EXISTS (
         SELECT 1
         FROM linkedin_posts p
         WHERE p.user_id = s.user_id
           AND p.status = 'posted'
           AND COALESCE(p.posted_at, p.created_at) >= NOW() - make_interval(hours => $3::INT)
       )
     )
     SELECT
       i.user_id::text AS user_id,
       COALESCE(NULLIF(u.name, ''), SPLIT_PART(u.email, '@', 1), 'there') AS user_name,
       u.email,
       i.approved_count,
       i.needs_approval_count
     FROM inactive_users i
     JOIN users u ON u.id = i.user_id
     WHERE COALESCE(u.email, '') <> ''
       AND (COALESCE(i.approved_count, 0) + COALESCE(i.needs_approval_count, 0)) > 0
       AND NOT EXISTS (
         SELECT 1
         FROM linkedin_notification_events e
         WHERE e.user_id = i.user_id
           AND e.notification_type = 'ready_posts_daily'
           AND e.dedupe_key = $2
       )
     ORDER BY i.latest_queue_at DESC NULLS LAST
     LIMIT $1`,
    [userLimit, dailyDedupeKey, lookbackHours]
  );

  return rows || [];
};

const markCommentReplyNotificationsSent = async ({ userId, email, assistIds = [], payload = {} }) => {
  const dedupeKeys = (Array.isArray(assistIds) ? assistIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (dedupeKeys.length === 0) return;

  await pool.query(
    `INSERT INTO linkedin_notification_events (
       user_id, notification_type, dedupe_key, email_to, status, payload, sent_at, created_at, updated_at
     )
     SELECT
       $1, 'comment_reply_ready', dedupe_key, $2, 'sent', $3::jsonb, NOW(), NOW(), NOW()
     FROM UNNEST($4::text[]) AS t(dedupe_key)
     ON CONFLICT (user_id, notification_type, dedupe_key) DO NOTHING`,
    [userId, toShortText(email, 320), JSON.stringify(payload || {}), dedupeKeys]
  );
};

const markReadyPostNotificationSent = async ({ userId, email, dedupeKey, payload = {} }) => {
  await pool.query(
    `INSERT INTO linkedin_notification_events (
       user_id, notification_type, dedupe_key, email_to, status, payload, sent_at, created_at, updated_at
     )
     VALUES ($1, 'ready_posts_daily', $2, $3, 'sent', $4::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (user_id, notification_type, dedupe_key) DO NOTHING`,
    [userId, String(dedupeKey || ''), toShortText(email, 320), JSON.stringify(payload || {})]
  );
};

export function getLinkedinEmailNotifierStatus() {
  const intervalMs = getNotificationIntervalMs();
  const now = Date.now();
  const elapsed = lastNotificationTickAt ? now - lastNotificationTickAt : null;
  const nextInMs =
    elapsed === null
      ? 0
      : Math.max(0, intervalMs - elapsed);

  return {
    enabled: notificationsEnabled() && resendEmailService.isEnabled(),
    inProgress: notificationTickInProgress,
    intervalMs,
    lastRunAt: lastNotificationTickAt ? new Date(lastNotificationTickAt).toISOString() : null,
    nextRunInMs: nextInMs,
    autoReplyDraftsEnabled: autoReplyDraftsEnabled(),
  };
}

export async function runLinkedinEmailNotificationTick({ force = false, trigger = 'scheduler', tickId = null } = {}) {
  if (!notificationsEnabled()) {
    return { status: 'disabled', reason: 'feature_flag_off' };
  }

  if (!resendEmailService.isEnabled()) {
    return { status: 'disabled', reason: 'missing_resend_api_key' };
  }

  if (notificationTickInProgress) {
    return { status: 'busy' };
  }

  const intervalMs = getNotificationIntervalMs();
  const now = Date.now();
  if (!force && lastNotificationTickAt && now - lastNotificationTickAt < intervalMs) {
    return {
      status: 'throttled',
      nextRunInMs: Math.max(0, intervalMs - (now - lastNotificationTickAt)),
    };
  }

  notificationTickInProgress = true;
  const startedAt = Date.now();
  const userLimit = getMaxUsersPerTick();
  const sampleLimit = getCommentSampleLimit();
  const lookbackHours = getReadyPostLookbackHours();
  const dailyDedupeKey = new Date().toISOString().slice(0, 10);

  const stats = {
    autoReplyUsersScanned: 0,
    autoReplyDraftsGenerated: 0,
    commentReplyTargets: 0,
    commentReplyEmailsSent: 0,
    readyPostTargets: 0,
    readyPostEmailsSent: 0,
    errors: 0,
  };

  try {
    if (autoReplyDraftsEnabled()) {
      const autoReplyUsers = await fetchUsersWithCommentActivity({
        userLimit: Math.min(userLimit, getAutoReplyUserScanLimit()),
      });
      stats.autoReplyUsersScanned = autoReplyUsers.length;

      for (const userRow of autoReplyUsers) {
        const userId = String(userRow?.user_id || '').trim();
        if (!userId) continue;

        let inbox = null;
        try {
          inbox = await commentReplyAssistService.listInboxComments({
            userId,
            postLimit: 6,
            perPostLimit: 6,
            limit: 24,
          });
        } catch (error) {
          stats.errors += 1;
          logger.warn('[LinkedIn EmailNotifier] Failed to fetch comment inbox for auto-drafts', {
            userId,
            error: error?.message || String(error),
          });
          continue;
        }

        const unrepliedComments = (Array.isArray(inbox?.comments) ? inbox.comments : [])
          .filter((item) => !item?.isEngaged)
          .filter((item) => {
            const timestamp = new Date(item?.commentedAt || item?.postCreatedAt || 0).getTime();
            if (!Number.isFinite(timestamp) || timestamp <= 0) return true;
            return Date.now() - timestamp <= AUTO_REPLY_MAX_COMMENT_AGE_MS;
          })
          .slice(0, getAutoReplyDraftsPerUser());

        for (const comment of unrepliedComments) {
          const sourceCommentId = toShortText(comment?.sourceCommentId || '', 220);
          const commentText = toShortText(comment?.commentText || '', 1200);
          if (!sourceCommentId || !commentText) continue;

          try {
            const existing = await commentReplyAssistService.getLatestReadyAssistByComment({
              userId,
              sourceCommentId,
              suggestionCount: 1,
            });
            if (existing?.requestId) continue;

            await commentReplyAssistService.generateSuggestions({
              userId,
              strategyId: null,
              postId: comment?.postId || null,
              sourceCommentId,
              commentText,
              commenterName: toShortText(comment?.commenterName || '', 120),
              tone: 'professional',
              objective: 'engage',
              contextNotes: 'Auto-generated from new LinkedIn comments. User approval is required before sending.',
              suggestionCount: 3,
            });
            stats.autoReplyDraftsGenerated += 1;
          } catch (error) {
            if (isMissingTableError(error)) {
              logger.warn('[LinkedIn EmailNotifier] Comment-reply tables not available; auto-drafts skipped');
              break;
            }
            stats.errors += 1;
            logger.warn('[LinkedIn EmailNotifier] Failed to auto-generate reply draft', {
              userId,
              sourceCommentId,
              error: error?.message || String(error),
            });
          }
        }
      }
    }

    const commentTargets = await fetchPendingCommentReplyTargets({
      userLimit,
      sampleLimit,
    });
    stats.commentReplyTargets = commentTargets.length;

    for (const target of commentTargets) {
      const email = toShortText(target?.email, 320);
      const userId = String(target?.user_id || '').trim();
      if (!userId || !email) continue;

      const assistIds = Array.isArray(target?.assist_ids) ? target.assist_ids : [];
      if (assistIds.length === 0) continue;

      const mail = buildCommentReplyEmail(target);
      try {
        const sendResult = await resendEmailService.sendEmail({
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });

        await markCommentReplyNotificationsSent({
          userId,
          email,
          assistIds,
          payload: {
            trigger,
            tickId,
            message_id: sendResult?.messageId || null,
            pending_count: Number(target?.pending_count || assistIds.length || 0),
            cta_url: mail.ctaUrl,
          },
        });

        stats.commentReplyEmailsSent += 1;
      } catch (error) {
        stats.errors += 1;
        logger.error('[LinkedIn EmailNotifier] Failed to send comment-reply email', {
          userId,
          email,
          error: error?.message || String(error),
        });
      }
    }

    const readyTargets = await fetchReadyPostReminderTargets({
      userLimit,
      dailyDedupeKey,
      lookbackHours,
    });
    stats.readyPostTargets = readyTargets.length;

    for (const target of readyTargets) {
      const email = toShortText(target?.email, 320);
      const userId = String(target?.user_id || '').trim();
      if (!userId || !email) continue;

      const mail = buildReadyPostsEmail(target);
      try {
        const sendResult = await resendEmailService.sendEmail({
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });

        await markReadyPostNotificationSent({
          userId,
          email,
          dedupeKey: dailyDedupeKey,
          payload: {
            trigger,
            tickId,
            message_id: sendResult?.messageId || null,
            approved_count: Number(target?.approved_count || 0),
            needs_approval_count: Number(target?.needs_approval_count || 0),
            cta_url: mail.ctaUrl,
          },
        });

        stats.readyPostEmailsSent += 1;
      } catch (error) {
        stats.errors += 1;
        logger.error('[LinkedIn EmailNotifier] Failed to send ready-post email', {
          userId,
          email,
          error: error?.message || String(error),
        });
      }
    }
  } catch (error) {
    if (isMissingTableError(error)) {
      logger.warn('[LinkedIn EmailNotifier] Notification tables not available yet; skipping tick');
      return { status: 'skipped_missing_table' };
    }

    logger.error('[LinkedIn EmailNotifier] Tick failed', {
      trigger,
      tickId,
      error: error?.message || String(error),
    });
    return {
      status: 'error',
      error: error?.message || String(error),
    };
  } finally {
    lastNotificationTickAt = Date.now();
    notificationTickInProgress = false;
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    status: 'ok',
    durationMs,
    trigger,
    tickId,
    ...stats,
  };

  if (stats.commentReplyEmailsSent > 0 || stats.readyPostEmailsSent > 0) {
    logger.info('[LinkedIn EmailNotifier] Notifications sent', summary);
  } else {
    logger.debug('[LinkedIn EmailNotifier] Tick complete (no notifications sent)', summary);
  }

  return summary;
}

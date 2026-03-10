import crypto from 'crypto';
import { pool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import strategyService from '../services/strategyService.js';
import linkedinAutomationService from '../services/linkedinAutomationService.js';
import { runLinkedinEmailNotificationTick } from './linkedinEmailNotifier.js';

const DEFAULT_DAILY_QUEUE_TARGET = 2;
const DEFAULT_USER_LIMIT = 25;
const MAX_USER_LIMIT = 200;
const MAX_QUEUE_TARGET = 6;

const isDailyContentCronEnabled = () => {
  const raw = String(process.env.LINKEDIN_DAILY_CONTENT_CRON_ENABLED || 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(raw);
};

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const toShortText = (value = '', max = 260) => {
  const normalized = String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 260;
  return normalized.slice(0, safeMax);
};

const dedupeStrings = (values = [], max = 20) => {
  const seen = new Set();
  const output = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
};

const toBoundedInt = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const resolveTimezone = () => {
  const candidate = String(process.env.LINKEDIN_CONTENT_PLAN_CRON_TIMEZONE || 'UTC').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
};

const getDateKeyForTimezone = (value = new Date(), timeZone = 'UTC') => {
  const dateValue = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateValue.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dateValue);
  const partByType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = partByType.year || '';
  const month = partByType.month || '';
  const day = partByType.day || '';
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

const getTodayDateKey = (timeZone = 'UTC') => getDateKeyForTimezone(new Date(), timeZone);

const getEligibleStrategies = async ({ userLimit }) => {
  const { rows } = await pool.query(
    `WITH ranked_strategies AS (
       SELECT
         s.id::text AS strategy_id,
         s.user_id::text AS user_id,
         s.status,
         s.posting_frequency,
         COALESCE(s.metadata, '{}'::jsonb) AS metadata,
         s.updated_at,
         s.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY s.user_id
           ORDER BY
             CASE WHEN s.status = 'active' THEN 0 WHEN s.status = 'draft' THEN 1 ELSE 2 END,
             COALESCE(s.updated_at, s.created_at) DESC
         ) AS rn
       FROM user_strategies s
       WHERE COALESCE(s.metadata->>'product', '') = 'linkedin-genie'
         AND s.status IN ('active', 'draft')
     )
     SELECT
       rs.strategy_id,
       rs.user_id,
       rs.status,
       rs.posting_frequency,
       rs.metadata,
       COALESCE(pc.consent_use_posts, false) AS consent_use_posts,
       COALESCE(pc.consent_store_profile, false) AS consent_store_profile
     FROM ranked_strategies rs
     LEFT JOIN linkedin_automation_profile_context pc
       ON pc.user_id::text = rs.user_id
     WHERE rs.rn = 1
       AND EXISTS (
         SELECT 1
         FROM social_connected_accounts a
         WHERE a.user_id::text = rs.user_id
           AND COALESCE(a.access_token, '') <> ''
       )
     ORDER BY COALESCE(rs.updated_at, rs.created_at) DESC
     LIMIT $1`,
    [userLimit]
  );
  return Array.isArray(rows) ? rows : [];
};

const getPendingCountForRun = async ({ userId, runId }) => {
  if (!runId) return 0;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM linkedin_automation_queue
     WHERE user_id = $1
       AND run_id = $2
       AND status <> ALL($3::text[])`,
    [userId, runId, ['posted', 'completed', 'rejected']]
  );
  return Number(rows?.[0]?.count || 0);
};

const getLatestAnalysisRun = async ({ userId, strategyId, cachedAnalysisId }) => {
  if (cachedAnalysisId) {
    const { rows: byIdRows } = await pool.query(
      `SELECT id::text AS id
       FROM linkedin_automation_runs
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [cachedAnalysisId, userId]
    );
    if (byIdRows[0]?.id) return byIdRows[0].id;
  }

  const { rows } = await pool.query(
    `SELECT id::text AS id
     FROM linkedin_automation_runs
     WHERE user_id = $1
       AND metadata->>'strategy_id' = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, strategyId]
  );
  return rows[0]?.id || null;
};

const markContentPlanPromptsUsed = async ({
  userId,
  strategyId,
  queueCount,
} = {}) => {
  const safeQueueCount = toBoundedInt(queueCount, DEFAULT_DAILY_QUEUE_TARGET, {
    min: 1,
    max: MAX_QUEUE_TARGET,
  });
  const prompts = await strategyService.getPrompts(strategyId, {
    limit: Math.max(12, safeQueueCount * 3),
  });
  if (!Array.isArray(prompts) || prompts.length === 0) return [];

  const ranked = [...prompts].sort((left, right) => {
    const leftUsage = Number(left?.usage_count || 0);
    const rightUsage = Number(right?.usage_count || 0);
    if (leftUsage !== rightUsage) return leftUsage - rightUsage;
    return new Date(right?.created_at || 0).getTime() - new Date(left?.created_at || 0).getTime();
  });

  const selected = ranked.slice(0, safeQueueCount).filter((item) => Boolean(item?.id));
  const usedPromptIds = [];

  for (const prompt of selected) {
    try {
      await strategyService.markPromptUsed(prompt.id, userId, { strategyId });
      usedPromptIds.push(prompt.id);
    } catch (error) {
      logger.warn('[DailyContentPlanCron] Prompt usage mark failed', {
        userId,
        strategyId,
        promptId: prompt?.id || null,
        error: error?.message || String(error),
      });
    }
  }

  return dedupeStrings(usedPromptIds, safeQueueCount);
};

const updateGeneratedRunMetadata = async ({ runId, userId, strategyId, generatedAt }) => {
  if (!runId) return;
  const metadataPatch = {
    strategy_id: strategyId,
    cron_source: 'daily_content_plan',
    cron_generated_at: generatedAt,
  };

  await pool.query(
    `UPDATE linkedin_automation_runs
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
       AND user_id = $3`,
    [JSON.stringify(metadataPatch), runId, userId]
  );
};

const shouldSkipForPending = async ({ userId, strategyMetadata, queueTarget }) => {
  const currentRunId = String(strategyMetadata?.content_plan_run_id || '').trim();
  if (!currentRunId) return { skip: false, pendingCount: 0 };

  const pendingCount = await getPendingCountForRun({ userId, runId: currentRunId });
  if (pendingCount <= 0) return { skip: false, pendingCount };

  return {
    skip: pendingCount >= Math.max(1, Number(queueTarget || DEFAULT_DAILY_QUEUE_TARGET)),
    pendingCount,
  };
};

export async function runDailyContentPlanCronTick({
  trigger = 'cron',
  force = false,
  userLimit = null,
  queueTarget = null,
  notify = true,
  tickId = null,
} = {}) {
  const startedAt = Date.now();
  const runId = tickId || `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  if (!isDailyContentCronEnabled()) {
    return {
      status: 'disabled',
      trigger,
      tickId: runId,
      reason: 'feature_flag_off',
      generatedStrategies: 0,
      scannedUsers: 0,
      durationMs: 0,
    };
  }
  const timeZone = resolveTimezone();
  const todayDateKey = getTodayDateKey(timeZone);
  const safeUserLimit = toBoundedInt(userLimit, DEFAULT_USER_LIMIT, { min: 1, max: MAX_USER_LIMIT });
  const safeQueueTarget = toBoundedInt(
    queueTarget ?? process.env.LINKEDIN_DAILY_CONTENT_QUEUE_TARGET,
    DEFAULT_DAILY_QUEUE_TARGET,
    { min: 1, max: MAX_QUEUE_TARGET }
  );
  const shouldNotify =
    notify !== false &&
    String(process.env.LINKEDIN_DAILY_CONTENT_NOTIFY || 'true').trim().toLowerCase() !== 'false';

  const summary = {
    status: 'ok',
    trigger,
    tickId: runId,
    timezone: timeZone,
    dateKey: todayDateKey,
    userLimit: safeUserLimit,
    queueTarget: safeQueueTarget,
    scannedUsers: 0,
    generatedStrategies: 0,
    skippedAlreadyGenerated: 0,
    skippedPending: 0,
    skippedNoConsent: 0,
    skippedNoAnalysis: 0,
    failedStrategies: 0,
    notificationTick: null,
    details: [],
  };

  const candidates = await getEligibleStrategies({ userLimit: safeUserLimit });
  summary.scannedUsers = candidates.length;

  for (const candidate of candidates) {
    const strategyId = String(candidate?.strategy_id || '').trim();
    const userId = String(candidate?.user_id || '').trim();
    if (!strategyId || !userId) continue;

    const consentUsePosts = Boolean(candidate?.consent_use_posts);
    const consentStoreProfile = Boolean(candidate?.consent_store_profile);
    if (!consentUsePosts || !consentStoreProfile) {
      summary.skippedNoConsent += 1;
      summary.details.push({
        strategyId,
        userId,
        status: 'skipped_no_consent',
      });
      continue;
    }

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || String(strategy?.user_id || '').trim() !== userId) {
      summary.failedStrategies += 1;
      summary.details.push({
        strategyId,
        userId,
        status: 'failed_strategy_not_found',
      });
      continue;
    }

    const strategyMetadata = parseJsonObject(strategy.metadata, {});
    const generatedAt = strategyMetadata?.content_plan_generated_at || null;
    if (!force && generatedAt) {
      const generatedDateKey = getDateKeyForTimezone(generatedAt, timeZone);
      if (generatedDateKey && generatedDateKey === todayDateKey) {
        summary.skippedAlreadyGenerated += 1;
        summary.details.push({
          strategyId,
          userId,
          status: 'skipped_already_generated_today',
          generatedAt,
        });
        continue;
      }
    }

    const pendingCheck = await shouldSkipForPending({
      userId,
      strategyMetadata,
      queueTarget: safeQueueTarget,
    });
    if (!force && pendingCheck.skip) {
      summary.skippedPending += 1;
      summary.details.push({
        strategyId,
        userId,
        status: 'skipped_pending_queue',
        pendingCount: pendingCheck.pendingCount,
      });
      continue;
    }

    const cachedAnalysisId = String(
      parseJsonObject(strategyMetadata.analysis_cache, {}).analysis_id || ''
    ).trim();
    const analysisId = await getLatestAnalysisRun({ userId, strategyId, cachedAnalysisId });
    if (!analysisId) {
      summary.skippedNoAnalysis += 1;
      summary.details.push({
        strategyId,
        userId,
        status: 'skipped_no_analysis',
      });
      continue;
    }

    try {
      const runResult = await linkedinAutomationService.runPipeline({
        userId,
        queueTarget: safeQueueTarget,
        strategyId,
      });
      const generatedAtIso = new Date().toISOString();
      const generatedCount = Array.isArray(runResult?.queue) ? runResult.queue.length : 0;
      await updateGeneratedRunMetadata({
        runId: runResult?.runId || null,
        userId,
        strategyId,
        generatedAt: generatedAtIso,
      });
      const promptIds = await markContentPlanPromptsUsed({
        userId,
        strategyId,
        queueCount: generatedCount || safeQueueTarget,
      });
      const mergedPromptIds = dedupeStrings(
        [
          ...(Array.isArray(strategyMetadata.content_plan_prompt_ids)
            ? strategyMetadata.content_plan_prompt_ids
            : []),
          ...promptIds,
        ],
        20
      );

      const nextMetadata = {
        ...strategyMetadata,
        content_plan_run_id: runResult?.runId || null,
        content_plan_generated_at: generatedAtIso,
        content_plan_queue_count: Number(generatedCount || 0),
        content_plan_status: 'ready',
        content_plan_prompt_ids: mergedPromptIds,
        content_plan_prompt_used_at: generatedAtIso,
        content_plan_mode: 'replace',
        content_plan_cron_last_run_at: generatedAtIso,
        content_plan_cron_last_result: 'generated',
        content_plan_cron_last_reason: null,
      };
      delete nextMetadata.content_plan_warning;

      await strategyService.updateStrategy(strategyId, {
        metadata: nextMetadata,
      });

      summary.generatedStrategies += 1;
      summary.details.push({
        strategyId,
        userId,
        status: 'generated',
        queueCount: Number(generatedCount || 0),
        runId: runResult?.runId || null,
      });
    } catch (error) {
      summary.failedStrategies += 1;
      const message = toShortText(error?.message || String(error), 260) || 'unknown_error';

      try {
        const nowIso = new Date().toISOString();
        const refreshedStrategy = await strategyService.getStrategy(strategyId);
        const refreshedMetadata = parseJsonObject(refreshedStrategy?.metadata, strategyMetadata);
        const nextMetadata = {
          ...refreshedMetadata,
          content_plan_cron_last_run_at: nowIso,
          content_plan_cron_last_result: 'failed',
          content_plan_cron_last_reason: message,
        };
        await strategyService.updateStrategy(strategyId, {
          metadata: nextMetadata,
        });
      } catch (metadataError) {
        logger.warn('[DailyContentPlanCron] Failed to persist strategy cron error metadata', {
          strategyId,
          userId,
          error: metadataError?.message || String(metadataError),
        });
      }

      summary.details.push({
        strategyId,
        userId,
        status: 'failed',
        error: message,
      });
      logger.error('[DailyContentPlanCron] Strategy generation failed', {
        strategyId,
        userId,
        error: message,
      });
    }
  }

  if (shouldNotify && (summary.generatedStrategies > 0 || force)) {
    try {
      summary.notificationTick = await runLinkedinEmailNotificationTick({
        force: true,
        trigger: 'daily_content_plan_cron',
        tickId: runId,
      });
    } catch (error) {
      summary.notificationTick = {
        status: 'error',
        error: toShortText(error?.message || String(error), 260) || 'unknown_error',
      };
      logger.warn('[DailyContentPlanCron] Notification tick failed', {
        tickId: runId,
        error: error?.message || String(error),
      });
    }
  } else {
    summary.notificationTick = {
      status: 'skipped',
      reason: shouldNotify ? 'no_new_generation' : 'notify_disabled',
    };
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

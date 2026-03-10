import { pool } from '../config/database.js';
import linkedinAutomationService from './linkedinAutomationService.js';
import personaVaultService from './personaVaultService.js';

const PRODUCT_SCOPE = 'linkedin-genie';
const VAULT_VERSION = 1;
const MAX_PREVIEW_TEXT = 320;
const MAX_TOP_POSTS = 5;

const TOPIC_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or',
  'that', 'the', 'their', 'this', 'to', 'with', 'you', 'your', 'our', 'we', 'they',
  'post', 'posts', 'linkedin', 'content', 'social', 'media', 'suitegenie',
  'about', 'after', 'before', 'while', 'when', 'where', 'what', 'why', 'how',
  'has', 'have', 'had', 'was', 'were', 'will', 'would', 'can', 'could', 'should',
  'build', 'building', 'built', 'share', 'sharing', 'more', 'most', 'just',
  'agency', 'client', 'platform', 'workflow', 'analytic', 'tool', 'tools',
  'service', 'solution', 'product', 'creator', 'update', 'growth', 'strategy',
  'brand', 'marketing', 'business', 'team',
]);

const sanitizeUnicodeString = (value = '') => {
  const input = String(value ?? '');
  if (!input) return '';

  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = input.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    output += input[index];
  }

  return output;
};

const sanitizeControlChars = (value = '') =>
  sanitizeUnicodeString(String(value || ''))
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toShortText = (value = '', max = MAX_PREVIEW_TEXT) => {
  const normalized = sanitizeControlChars(value);
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_PREVIEW_TEXT;
  if (normalized.length <= safeMax) return normalized;
  return sanitizeUnicodeString(normalized.slice(0, safeMax)).trim();
};

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};

const sanitizeJsonSafeValue = (value) => {
  if (typeof value === 'string') {
    return sanitizeControlChars(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSafeValue(item));
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = sanitizeJsonSafeValue(item);
    }
    return output;
  }
  return value;
};

const safeJsonStringify = (value, fallback = '{}') => {
  try {
    const serialized = JSON.stringify(sanitizeJsonSafeValue(value));
    return serialized === undefined ? fallback : serialized;
  } catch {
    return fallback;
  }
};

const dedupeStrings = (items = [], max = 20) => {
  const seen = new Set();
  const output = [];

  for (const item of Array.isArray(items) ? items : []) {
    const value = sanitizeControlChars(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
};

const normalizeTopic = (value = '') => {
  const cleaned = sanitizeControlChars(value)
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const words = cleaned
    .split(' ')
    .filter((word) => word.length >= 3 && !TOPIC_STOP_WORDS.has(word))
    .slice(0, 4);

  if (words.length === 0) return '';
  const phrase = words.join(' ');
  if (phrase.length < 3 || phrase.length > 36) return '';
  return phrase;
};

const normalizeTopicList = (items = [], max = 12) =>
  dedupeStrings(
    (Array.isArray(items) ? items : [items])
      .map((item) => normalizeTopic(item))
      .filter(Boolean),
    max
  );

const toEngagement = (post = {}) =>
  Number(post.likes || 0) + Number(post.comments || 0) + Number(post.shares || 0);

const summarizePosts = (rows = [], max = MAX_TOP_POSTS) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      id: row.id,
      snippet: toShortText(row.post_content || '', 220),
      engagement: toEngagement(row),
      likes: Number(row.likes || 0),
      comments: Number(row.comments || 0),
      shares: Number(row.shares || 0),
      views: Number(row.views || 0),
      createdAt: row.created_at || null,
    }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, Math.max(1, max));

const computeVoiceSignals = (rows = []) => {
  const posts = Array.isArray(rows) ? rows : [];
  if (!posts.length) return [];

  const metrics = posts.reduce(
    (acc, post) => {
      const text = String(post.post_content || '');
      const normalized = text.toLowerCase();
      const length = sanitizeControlChars(text).length;
      const hasQuestion = text.includes('?');
      const hasCTA = /(comment|follow|dm|message me|reply|share your)/i.test(normalized);
      const hasStory = /\b(i|my|we|our)\b/.test(normalized);
      const hasList = /(?:\n\s*[-*•])|(?:\b\d+\.)/.test(text);

      acc.totalLength += length;
      if (hasQuestion) acc.questionCount += 1;
      if (hasCTA) acc.ctaCount += 1;
      if (hasStory) acc.storyCount += 1;
      if (hasList) acc.listCount += 1;
      return acc;
    },
    { totalLength: 0, questionCount: 0, ctaCount: 0, storyCount: 0, listCount: 0 }
  );

  const total = posts.length;
  const avgLength = metrics.totalLength / Math.max(1, total);
  const signals = [];

  if (metrics.questionCount / total >= 0.35) signals.push('Uses question-led hooks often.');
  if (metrics.ctaCount / total >= 0.3) signals.push('Strong CTA pattern (comment/reply/follow prompts).');
  if (metrics.storyCount / total >= 0.45) signals.push('Founder-style first-person narrative appears frequently.');
  if (metrics.listCount / total >= 0.3) signals.push('Framework/list format is a recurring delivery style.');
  if (avgLength >= 900) signals.push('Long-form depth is the dominant post format.');
  if (avgLength > 0 && avgLength <= 260) signals.push('Short punchy post style is currently dominant.');

  return signals.slice(0, 5);
};

const buildTopicPerformance = ({ topicCandidates = [], posts = [], globalAvg = 0 }) => {
  const scored = [];
  const normalizedPosts = (Array.isArray(posts) ? posts : []).map((post) => ({
    ...post,
    _content: sanitizeControlChars(post.post_content || '').toLowerCase(),
    _engagement: toEngagement(post),
  }));

  for (const topic of normalizeTopicList(topicCandidates, 24)) {
    const normalizedTopic = normalizeTopic(topic);
    if (!normalizedTopic) continue;
    const topicRegex = new RegExp(`\\b${normalizedTopic.replace(/\s+/g, '\\s+')}\\b`, 'i');
    const matched = normalizedPosts.filter((post) => topicRegex.test(post._content));
    if (!matched.length) {
      scored.push({
        topic: normalizedTopic,
        matches: 0,
        avgEngagement: 0,
        score: 0,
      });
      continue;
    }
    const totalEngagement = matched.reduce((sum, item) => sum + Number(item._engagement || 0), 0);
    const avgEngagement = totalEngagement / Math.max(1, matched.length);
    const score = Number((avgEngagement - globalAvg).toFixed(2));
    scored.push({
      topic: normalizedTopic,
      matches: matched.length,
      avgEngagement: Number(avgEngagement.toFixed(2)),
      score,
    });
  }

  const winningTopics = scored
    .filter((item) => item.matches > 0)
    .sort((a, b) => (b.avgEngagement - a.avgEngagement) || (b.matches - a.matches))
    .slice(0, 8)
    .map((item) => item.topic);

  const underusedTopics = scored
    .filter((item) => item.matches === 0 || item.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((item) => item.topic);

  return {
    scored: scored.slice(0, 16),
    winningTopics,
    underusedTopics,
  };
};

const normalizeContentSignature = (value = '') =>
  sanitizeControlChars(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);

const REVIEW_ACCEPTED_STATUSES = new Set(['approved', 'scheduled', 'posted']);
const REVIEW_DECISION_STATUSES = new Set(['approved', 'scheduled', 'posted', 'rejected']);

const buildReviewFeedbackSignals = (queueRows = []) => {
  const rows = Array.isArray(queueRows) ? queueRows : [];
  const statusBreakdown = {};
  const rejectionReasonCounts = new Map();
  let reviewedCount = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let postedCount = 0;
  let lastReviewedAt = null;

  for (const row of rows) {
    const status = String(row?.status || 'needs_approval').trim().toLowerCase() || 'needs_approval';
    statusBreakdown[status] = Number(statusBreakdown[status] || 0) + 1;

    const reviewTimestamp = row?.updated_at || row?.created_at || null;
    if (reviewTimestamp) {
      const reviewedDate = new Date(reviewTimestamp).getTime();
      const currentDate = lastReviewedAt ? new Date(lastReviewedAt).getTime() : 0;
      if (!currentDate || reviewedDate > currentDate) {
        lastReviewedAt = reviewTimestamp;
      }
    }

    if (REVIEW_DECISION_STATUSES.has(status)) {
      reviewedCount += 1;
      if (REVIEW_ACCEPTED_STATUSES.has(status)) {
        acceptedCount += 1;
      }
      if (status === 'rejected') {
        rejectedCount += 1;
        const reason = toShortText(row?.rejection_reason || '', 140);
        if (reason) {
          const key = reason.toLowerCase();
          rejectionReasonCounts.set(key, {
            reason,
            count: Number(rejectionReasonCounts.get(key)?.count || 0) + 1,
          });
        }
      }
      if (status === 'posted') {
        postedCount += 1;
      }
    }
  }

  const topRejectionReasons = [...rejectionReasonCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    totalQueueItems: rows.length,
    reviewedCount,
    acceptedCount,
    rejectedCount,
    postedCount,
    approvalRate: reviewedCount > 0 ? Number((acceptedCount / reviewedCount).toFixed(2)) : 0,
    rejectionRate: reviewedCount > 0 ? Number((rejectedCount / reviewedCount).toFixed(2)) : 0,
    topRejectionReasons,
    statusBreakdown,
    lastReviewedAt,
  };
};

const collectQueueTopics = (queueItem = {}) => {
  const hashtags = Array.isArray(queueItem?.hashtags)
    ? queueItem.hashtags
    : parseJsonArray(queueItem?.hashtags, []);

  return normalizeTopicList(
    [
      queueItem?.title || '',
      toShortText(queueItem?.content || '', 120),
      ...(Array.isArray(hashtags) ? hashtags : []),
    ],
    8
  );
};

const buildQueueAnalyticsSignals = ({ queueRows = [], posts = [] } = {}) => {
  const rows = Array.isArray(queueRows) ? queueRows : [];
  const postedRows = rows.filter((row) => String(row?.status || '').toLowerCase() === 'posted');
  const recentPosts = Array.isArray(posts) ? posts : [];

  const postLookup = new Map();
  for (const post of recentPosts) {
    const signature = normalizeContentSignature(post?.post_content || '');
    if (!signature) continue;
    if (!postLookup.has(signature)) {
      postLookup.set(signature, []);
    }
    postLookup.get(signature).push(post);
  }

  for (const bucket of postLookup.values()) {
    bucket.sort((a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime());
  }

  let matchedPublishedItems = 0;
  let totalEngagement = 0;
  let totalViews = 0;
  const topicAgg = new Map();

  for (const row of postedRows) {
    const signature = normalizeContentSignature(row?.content || '');
    if (!signature) continue;
    const match = postLookup.get(signature)?.[0] || null;
    if (!match) continue;

    const engagement = toEngagement(match);
    matchedPublishedItems += 1;
    totalEngagement += engagement;
    totalViews += Number(match?.views || 0);

    const queueTopics = collectQueueTopics(row);
    for (const topic of queueTopics) {
      if (!topicAgg.has(topic)) {
        topicAgg.set(topic, { topic, matches: 0, totalEngagement: 0 });
      }
      const current = topicAgg.get(topic);
      current.matches += 1;
      current.totalEngagement += engagement;
      topicAgg.set(topic, current);
    }
  }

  const topicScores = [...topicAgg.values()]
    .map((item) => ({
      ...item,
      avgEngagement: item.matches > 0 ? Number((item.totalEngagement / item.matches).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  return {
    postedQueueItems: postedRows.length,
    matchedPublishedItems,
    coverageRate:
      postedRows.length > 0 ? Number((matchedPublishedItems / postedRows.length).toFixed(2)) : 0,
    avgEngagement:
      matchedPublishedItems > 0 ? Number((totalEngagement / matchedPublishedItems).toFixed(2)) : 0,
    avgViews:
      matchedPublishedItems > 0 ? Number((totalViews / matchedPublishedItems).toFixed(2)) : 0,
    bestTopics: topicScores.slice(0, 6).map((item) => item.topic),
    weakTopics: topicScores.slice(-4).map((item) => item.topic).filter(Boolean),
    topicScores: topicScores.slice(0, 12),
  };
};

const buildPromptRecommendation = (strategyMetadata = {}, usage = {}) => {
  const existing = String(strategyMetadata?.prompts_refresh_recommendation || '').trim().toLowerCase();
  if (existing === 'partial' || existing === 'full') return existing;

  const used = Number(usage.usedPrompts || 0);
  const total = Number(usage.totalPrompts || 0);
  if (!total) return null;
  if (used >= 10 || used / total >= 0.85) return 'full';
  if (used >= 6 || used / total >= 0.55) return 'partial';
  return null;
};

const mapVaultRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    status: String(row.status || 'ready').toLowerCase(),
    snapshot: parseJsonObject(row.snapshot, {}),
    metadata: parseJsonObject(row.metadata, {}),
    lastRefreshedAt: row.last_refreshed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

class ContextVaultService {
  async getByStrategy({ userId, strategyId }) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_context_vault
       WHERE user_id = $1 AND strategy_id = $2
       LIMIT 1`,
      [userId, strategyId]
    );
    return mapVaultRow(rows[0] || null);
  }

  async refresh({ userId, strategy, reason = 'manual_refresh' }) {
    if (!strategy?.id) {
      throw new Error('Strategy is required for context vault refresh');
    }
    if (String(strategy.user_id) !== String(userId)) {
      throw new Error('Strategy does not belong to current user');
    }

    const strategyMetadata = parseJsonObject(strategy.metadata, {});

    const [profileRow, personaVault, latestRunRows, recentPostRows, promptUsageRows, reviewQueueRows] = await Promise.all([
      linkedinAutomationService.getProfileContextRow(userId),
      personaVaultService.getByUser({ userId }),
      pool.query(
        `SELECT *
         FROM linkedin_automation_runs
         WHERE user_id = $1
           AND metadata->>'strategy_id' = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, strategy.id]
      ),
      pool.query(
        `SELECT id, post_content, likes, comments, shares, views, created_at, updated_at
         FROM linkedin_posts
         WHERE user_id = $1
           AND status = 'posted'
         ORDER BY created_at DESC
         LIMIT 120`,
        [userId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_prompts,
           COUNT(*) FILTER (WHERE COALESCE(usage_count, 0) > 0)::int AS used_prompts,
           COALESCE(SUM(usage_count), 0)::int AS total_uses,
           MAX(last_used_at) AS last_used_at
         FROM strategy_prompts
         WHERE strategy_id = $1`,
        [strategy.id]
      ),
      pool.query(
        `SELECT
           q.id,
           q.run_id,
           q.status,
           q.rejection_reason,
           q.title,
           q.content,
           q.hashtags,
           q.created_at,
           q.updated_at
         FROM linkedin_automation_queue q
         INNER JOIN linkedin_automation_runs r
           ON r.id = q.run_id
         WHERE q.user_id = $1
           AND r.metadata->>'strategy_id' = $2
         ORDER BY q.created_at DESC
         LIMIT 240`,
        [userId, strategy.id]
      ),
    ]);

    const profileContext = linkedinAutomationService.mapProfileContext(profileRow);
    const profileMetadata = parseJsonObject(profileContext?.metadata, {});
    const latestRun = latestRunRows?.rows?.[0] || null;
    const latestRunMetadata = parseJsonObject(latestRun?.metadata, {});
    const latestRunSnapshot = parseJsonObject(latestRun?.analysis_snapshot, {});
    const analysisData = parseJsonObject(
      latestRunMetadata.analysis_data || strategyMetadata.analysis_cache || {},
      {}
    );
    const postSummaryFromRun = parseJsonObject(latestRunSnapshot.postSummary, {});

    let postSummary = postSummaryFromRun;
    if (!postSummary || Number(postSummary.postCount || 0) <= 0) {
      postSummary = await linkedinAutomationService.getPostSummary(userId, { limit: 60 });
    }

    const recentPosts = Array.isArray(recentPostRows?.rows) ? recentPostRows.rows : [];
    const reviewQueue = Array.isArray(reviewQueueRows?.rows) ? reviewQueueRows.rows : [];
    const topPosts = summarizePosts(recentPosts, MAX_TOP_POSTS);
    const averageEngagement = Number(postSummary?.averageEngagement || 0);
    const reviewFeedback = buildReviewFeedbackSignals(reviewQueue);
    const queueAnalytics = buildQueueAnalyticsSignals({
      queueRows: reviewQueue,
      posts: recentPosts,
    });

    const candidateTopics = dedupeStrings(
      [
        ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
        ...(Array.isArray(analysisData?.top_topics) ? analysisData.top_topics : []),
        ...(Array.isArray(strategy?.topics) ? strategy.topics : []),
        ...(Array.isArray(queueAnalytics?.bestTopics) ? queueAnalytics.bestTopics : []),
        ...(Array.isArray(queueAnalytics?.weakTopics) ? queueAnalytics.weakTopics : []),
        ...(Array.isArray(personaVault?.signals?.topic_signals) ? personaVault.signals.topic_signals : []),
        ...(Array.isArray(personaVault?.signals?.niche_candidates) ? personaVault.signals.niche_candidates : []),
        strategy?.niche || '',
      ],
      24
    );
    const topicPerformance = buildTopicPerformance({
      topicCandidates: candidateTopics,
      posts: recentPosts,
      globalAvg: averageEngagement,
    });
    const strategyTopics = normalizeTopicList(Array.isArray(strategy?.topics) ? strategy.topics : [], 20);
    const newWinningTopics = topicPerformance.winningTopics.filter(
      (topic) => !strategyTopics.includes(topic)
    );

    const promptUsage = promptUsageRows?.rows?.[0] || {};
    const totalPrompts = Number(promptUsage.total_prompts || 0);
    const usedPrompts = Number(promptUsage.used_prompts || 0);
    const totalPromptUses = Number(promptUsage.total_uses || 0);
    const remainingPrompts = Math.max(0, totalPrompts - usedPrompts);
    const refreshRecommendation = buildPromptRecommendation(strategyMetadata, {
      totalPrompts,
      usedPrompts,
    });

    const contentPlanRunId = String(strategyMetadata.content_plan_run_id || '').trim();
    const queueStatusRows = contentPlanRunId
      ? await pool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM linkedin_automation_queue
           WHERE user_id = $1 AND run_id = $2
           GROUP BY status`,
          [userId, contentPlanRunId]
        )
      : { rows: [] };
    const queueStatusBreakdown = (queueStatusRows.rows || []).reduce((acc, row) => {
      const key = String(row.status || 'unknown').toLowerCase();
      acc[key] = Number(row.count || 0);
      return acc;
    }, {});
    const queueCount = Object.values(queueStatusBreakdown).reduce((sum, count) => sum + Number(count || 0), 0);

    const topSkills = dedupeStrings(
      [
        ...(Array.isArray(profileMetadata.linkedin_skills) ? profileMetadata.linkedin_skills : []),
        ...(Array.isArray(profileMetadata.portfolio_skills) ? profileMetadata.portfolio_skills : []),
        ...(Array.isArray(personaVault?.signals?.skills) ? personaVault.signals.skills : []),
      ],
      14
    );

    const aboutPreview = toShortText(
      profileMetadata.linkedin_about ||
        profileMetadata.portfolio_about ||
        personaVault?.signals?.about ||
        strategyMetadata.linkedin_about ||
        strategyMetadata.portfolio_about ||
        '',
      360
    );
    const experiencePreview = toShortText(
      profileMetadata.linkedin_experience ||
        profileMetadata.portfolio_experience ||
        personaVault?.signals?.experience ||
        strategyMetadata.linkedin_experience ||
        strategyMetadata.portfolio_experience ||
        '',
      360
    );
    const voiceSignals = computeVoiceSignals(recentPosts);

    const sources = {
      posts: {
        count: Number(postSummary?.postCount || recentPosts.length || 0),
        averageEngagement: averageEngagement,
        sourceScope: String(postSummary?.sourceScope || 'all_user_posts'),
        lastPostAt: recentPosts[0]?.created_at || null,
        lastAnalyticsSyncAt:
          recentPosts
            .map((post) => post.updated_at)
            .filter(Boolean)
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
        topPosts,
      },
      portfolio: {
        active: Boolean(profileMetadata.portfolio_about || profileMetadata.portfolio_experience),
        title: toShortText(profileMetadata.portfolio_title || '', 140),
        hasAbout: Boolean(profileMetadata.portfolio_about),
        hasExperience: Boolean(profileMetadata.portfolio_experience),
        skillsCount: Array.isArray(profileMetadata.portfolio_skills) ? profileMetadata.portfolio_skills.length : 0,
        fetchedAt: profileMetadata.portfolio_fetched_at || null,
        status: profileMetadata.portfolio_fetch_status || null,
      },
      linkedinProfile: {
        hasAbout: Boolean(profileMetadata.linkedin_about),
        hasExperience: Boolean(profileMetadata.linkedin_experience),
        skillsCount: Array.isArray(profileMetadata.linkedin_skills) ? profileMetadata.linkedin_skills.length : 0,
        hasPdf: Boolean(profileMetadata.linkedin_profile_pdf_uploaded_at),
        pdfUploadedAt: profileMetadata.linkedin_profile_pdf_uploaded_at || null,
        pdfExtractionSource: profileMetadata.linkedin_profile_pdf_extraction_source || null,
      },
      persona: {
        status: personaVault?.status || 'missing',
        available: Boolean(personaVault),
        lastEnrichedAt: personaVault?.lastEnrichedAt || null,
        freshnessHours: personaVault?.lastEnrichedAt
          ? Number(
              (
                (Date.now() - new Date(personaVault.lastEnrichedAt).getTime()) /
                (1000 * 60 * 60)
              ).toFixed(2)
            )
          : null,
        nicheSignals: Array.isArray(personaVault?.signals?.niche_candidates)
          ? personaVault.signals.niche_candidates.slice(0, 6)
          : [],
        skillsCount: Array.isArray(personaVault?.signals?.skills) ? personaVault.signals.skills.length : 0,
        sourceHealth: parseJsonObject(personaVault?.sourceHealth, {}),
        evidenceSummary: parseJsonObject(personaVault?.evidenceSummary, {}),
      },
      references: {
        count: Array.isArray(latestRunMetadata.reference_accounts) ? latestRunMetadata.reference_accounts.length : 0,
      },
      reviews: {
        queueItems: Number(reviewFeedback.totalQueueItems || 0),
        reviewed: Number(reviewFeedback.reviewedCount || 0),
        rejected: Number(reviewFeedback.rejectedCount || 0),
        topRejectionReasons: Array.isArray(reviewFeedback.topRejectionReasons)
          ? reviewFeedback.topRejectionReasons.slice(0, 4)
          : [],
      },
    };

    const discoveries = {
      winningTopics: dedupeStrings(
        [
          ...topicPerformance.winningTopics,
          ...(Array.isArray(queueAnalytics.bestTopics) ? queueAnalytics.bestTopics : []),
        ],
        8
      ),
      underusedTopics: dedupeStrings(
        [
          ...topicPerformance.underusedTopics,
          ...(Array.isArray(queueAnalytics.weakTopics) ? queueAnalytics.weakTopics : []),
        ],
        8
      ),
      voiceSignals,
      nextAngles: dedupeStrings(
        [
          ...(Array.isArray(latestRunMetadata?.analysis_data?.top_topics) ? latestRunMetadata.analysis_data.top_topics : []),
          ...(Array.isArray(latestRunMetadata?.analysis?.nextAngles) ? latestRunMetadata.analysis.nextAngles : []),
          ...(Array.isArray(parseJsonObject(strategyMetadata.analysis_cache, {}).next_angles)
            ? parseJsonObject(strategyMetadata.analysis_cache, {}).next_angles
            : []),
          ...(Array.isArray(personaVault?.signals?.proof_points)
            ? personaVault.signals.proof_points.slice(0, 4).map((point) => `Ground at least one post in this proof point: ${point}`)
            : []),
          ...topicPerformance.underusedTopics.slice(0, 3).map((topic) => `Create proof-backed posts on ${topic}.`),
          ...(Array.isArray(queueAnalytics.bestTopics)
            ? queueAnalytics.bestTopics.slice(0, 3).map((topic) => `Repeat ${topic} with fresh project updates and measurable outcomes.`)
            : []),
          ...(Array.isArray(queueAnalytics.weakTopics)
            ? queueAnalytics.weakTopics.slice(0, 2).map((topic) => `Rework ${topic} with tighter hooks and concrete results.`)
            : []),
        ],
        12
      ),
      personaSignals: {
        nicheCandidates: Array.isArray(personaVault?.signals?.niche_candidates)
          ? personaVault.signals.niche_candidates.slice(0, 8)
          : [],
        audienceCandidates: Array.isArray(personaVault?.signals?.audience_candidates)
          ? personaVault.signals.audience_candidates.slice(0, 8)
          : [],
        proofPoints: Array.isArray(personaVault?.signals?.proof_points)
          ? personaVault.signals.proof_points.slice(0, 10)
          : [],
      },
      topicPerformance: topicPerformance.scored,
      queueTopicPerformance: Array.isArray(queueAnalytics.topicScores) ? queueAnalytics.topicScores : [],
    };

    const highRejectionRate =
      Number(reviewFeedback.reviewedCount || 0) >= 4 &&
      Number(reviewFeedback.rejectionRate || 0) >= 0.35;
    const lowPostedCoverage =
      Number(queueAnalytics.postedQueueItems || 0) > 0 &&
      Number(queueAnalytics.coverageRate || 0) < 0.5;

    const recommendations = {
      applyWinningTopics: newWinningTopics.length >= 2,
      regeneratePrompts:
        Boolean(refreshRecommendation) ||
        newWinningTopics.length >= 2 ||
        (remainingPrompts <= 4 && totalPrompts > 0) ||
        highRejectionRate,
      regenerateContentPlan:
        Number(queueCount || 0) === 0 ||
        Boolean(refreshRecommendation) ||
        newWinningTopics.length >= 3 ||
        highRejectionRate ||
        lowPostedCoverage,
      reasons: dedupeStrings(
        [
          newWinningTopics.length >= 2
            ? `${newWinningTopics.length} winning topics are not yet reflected in strategy topics.`
            : '',
          refreshRecommendation === 'full'
            ? 'Prompt usage indicates full refresh is recommended.'
            : '',
          refreshRecommendation === 'partial'
            ? 'Prompt usage indicates a top-up refresh is recommended.'
            : '',
          Number(queueCount || 0) === 0
            ? 'No content-plan queue found for latest run.'
            : '',
          highRejectionRate
            ? `Rejection rate is ${Math.round(Number(reviewFeedback.rejectionRate || 0) * 100)}%; refine prompt angles before next run.`
            : '',
          lowPostedCoverage
            ? 'Only part of posted queue content is reflected in current analytics history; sync analytics before next generation.'
            : '',
          !personaVault
            ? 'Persona Vault is empty. Run persona enrichment to improve niche and proof-point grounding.'
            : '',
          personaVault?.lastEnrichedAt &&
          (Date.now() - new Date(personaVault.lastEnrichedAt).getTime()) > 1000 * 60 * 60 * 24 * 14
            ? 'Persona Vault is older than 14 days. Refresh persona enrichment for fresher signals.'
            : '',
        ],
        8
      ),
      suggestedTopics: newWinningTopics.slice(0, 8),
    };

    const refreshedAt = new Date().toISOString();
    const snapshot = {
      version: VAULT_VERSION,
      strategyId: strategy.id,
      refreshedAt,
      context: {
        niche: toShortText(analysisData.niche || strategy.niche || profileContext.role_niche || '', 180),
        audience: toShortText(analysisData.audience || strategy.target_audience || profileContext.target_audience || '', 220),
        tone: toShortText(analysisData.tone || strategy.tone_style || profileContext.tone_style || 'professional', 80),
        postingFrequency: toShortText(strategy.posting_frequency || analysisData.posting_frequency || '3-5 times per week', 80),
        goals: dedupeStrings(
          [
            ...(Array.isArray(strategy.content_goals) ? strategy.content_goals : []),
            ...(Array.isArray(analysisData.goals) ? analysisData.goals : []),
          ],
          12
        ),
        topics: normalizeTopicList(
          [
            ...(Array.isArray(strategy.topics) ? strategy.topics : []),
            ...(Array.isArray(analysisData.top_topics) ? analysisData.top_topics : []),
            ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
            ...(Array.isArray(personaVault?.signals?.topic_signals) ? personaVault.signals.topic_signals : []),
          ],
          12
        ),
        aboutPreview,
        experiencePreview,
        topSkills,
      },
      sources,
      usage: {
        prompts: {
          totalPrompts,
          usedPrompts,
          remainingPrompts,
          totalUses: totalPromptUses,
          lastUsedAt: promptUsage.last_used_at || strategyMetadata.prompts_last_used_at || null,
          refreshRecommendation,
        },
        contentPlan: {
          runId: contentPlanRunId || null,
          queueCount: Number(queueCount || 0),
          status: toShortText(strategyMetadata.content_plan_status || 'not_generated', 32),
          generatedAt: strategyMetadata.content_plan_generated_at || null,
          statusBreakdown: queueStatusBreakdown,
        },
        reviews: {
          reviewedCount: Number(reviewFeedback.reviewedCount || 0),
          acceptedCount: Number(reviewFeedback.acceptedCount || 0),
          rejectedCount: Number(reviewFeedback.rejectedCount || 0),
          approvalRate: Number(reviewFeedback.approvalRate || 0),
          rejectionRate: Number(reviewFeedback.rejectionRate || 0),
          lastReviewedAt: reviewFeedback.lastReviewedAt || null,
        },
      },
      feedback: {
        reviews: reviewFeedback,
        analyticsLearning: {
          postedQueueItems: Number(queueAnalytics.postedQueueItems || 0),
          matchedPublishedItems: Number(queueAnalytics.matchedPublishedItems || 0),
          coverageRate: Number(queueAnalytics.coverageRate || 0),
          avgEngagement: Number(queueAnalytics.avgEngagement || 0),
          avgViews: Number(queueAnalytics.avgViews || 0),
          bestTopics: Array.isArray(queueAnalytics.bestTopics) ? queueAnalytics.bestTopics : [],
          weakTopics: Array.isArray(queueAnalytics.weakTopics) ? queueAnalytics.weakTopics : [],
          topicScores: Array.isArray(queueAnalytics.topicScores) ? queueAnalytics.topicScores : [],
        },
      },
      discoveries,
      recommendations,
    };

    const snapshotJson = safeJsonStringify(snapshot, '{}');
    const snapshotBytes = Buffer.byteLength(snapshotJson, 'utf8');
    const rowMetadata = {
      product: PRODUCT_SCOPE,
      reason: toShortText(reason, 80),
      snapshotBytes,
      computedAt: refreshedAt,
    };

    const { rows } = await pool.query(
      `INSERT INTO linkedin_context_vault (
         user_id, strategy_id, status, snapshot, metadata, last_refreshed_at
       )
       VALUES ($1, $2, 'ready', $3::jsonb, $4::jsonb, NOW())
       ON CONFLICT (user_id, strategy_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         snapshot = EXCLUDED.snapshot,
         metadata = EXCLUDED.metadata,
         last_refreshed_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [userId, strategy.id, snapshotJson, safeJsonStringify(rowMetadata, '{}')]
    );

    const contextVaultSummary = {
      status: 'ready',
      version: VAULT_VERSION,
      last_refreshed_at: refreshedAt,
      snapshot_bytes: snapshotBytes,
      source_counts: {
        posts: Number(sources.posts.count || 0),
        portfolio: sources.portfolio.active ? 1 : 0,
        pdf: sources.linkedinProfile.hasPdf ? 1 : 0,
        persona: sources.persona.available ? 1 : 0,
        references: Number(sources.references.count || 0),
        reviews: Number(reviewFeedback.reviewedCount || 0),
      },
      winning_topics: discoveries.winningTopics.slice(0, 8),
      underused_topics: discoveries.underusedTopics.slice(0, 8),
      voice_signals: discoveries.voiceSignals.slice(0, 5),
      top_skills: topSkills.slice(0, 12),
      persona: {
        status: sources.persona.status,
        last_enriched_at: sources.persona.lastEnrichedAt,
        freshness_hours: sources.persona.freshnessHours,
        niche_signals: Array.isArray(sources.persona.nicheSignals) ? sources.persona.nicheSignals.slice(0, 8) : [],
      },
      prompts: {
        total: totalPrompts,
        used: usedPrompts,
        remaining: remainingPrompts,
        recommendation: refreshRecommendation,
      },
      feedback: {
        reviewed: Number(reviewFeedback.reviewedCount || 0),
        approval_rate: Number(reviewFeedback.approvalRate || 0),
        rejection_rate: Number(reviewFeedback.rejectionRate || 0),
        posted_queue_items: Number(queueAnalytics.postedQueueItems || 0),
        analytics_coverage: Number(queueAnalytics.coverageRate || 0),
      },
      recommendations: {
        apply_winning_topics: recommendations.applyWinningTopics,
        regenerate_prompts: recommendations.regeneratePrompts,
        regenerate_content_plan: recommendations.regenerateContentPlan,
        suggested_topics: recommendations.suggestedTopics.slice(0, 8),
      },
    };

    const metadataPatch = sanitizeJsonSafeValue({
      context_vault: contextVaultSummary,
      ...(personaVault
        ? {
            persona_vault: personaVaultService.buildStrategyPersonaSummary(personaVault),
          }
        : {}),
    });

    await pool.query(
      `UPDATE user_strategies
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
         AND user_id = $3`,
      [safeJsonStringify(metadataPatch, '{}'), strategy.id, userId]
    );

    return mapVaultRow(rows[0] || null);
  }

  async refreshAllForUser({ userId, reason = 'analytics_sync' } = {}) {
    const { rows } = await pool.query(
      `SELECT *
       FROM user_strategies
       WHERE user_id = $1
         AND COALESCE(metadata->>'product', '') = $2
         AND status IN ('active', 'draft')
       ORDER BY updated_at DESC
       LIMIT 8`,
      [userId, PRODUCT_SCOPE]
    );

    const results = [];
    for (const strategy of rows || []) {
      try {
        const vault = await this.refresh({ userId, strategy, reason });
        if (vault) {
          results.push({
            strategyId: strategy.id,
            success: true,
            vaultId: vault.id,
            refreshedAt: vault.lastRefreshedAt,
          });
        } else {
          results.push({
            strategyId: strategy.id,
            success: false,
            error: 'No vault row returned',
          });
        }
      } catch (error) {
        results.push({
          strategyId: strategy.id,
          success: false,
          error: error?.message || 'Failed to refresh strategy vault',
        });
      }
    }

    return {
      totalStrategies: Number((rows || []).length),
      refreshedStrategies: results.filter((item) => item.success).length,
      failedStrategies: results.filter((item) => !item.success).length,
      results,
    };
  }
}

export const contextVaultService = new ContextVaultService();
export default contextVaultService;

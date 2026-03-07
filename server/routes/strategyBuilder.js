import express from 'express';
import { strategyService } from '../services/strategyService.js';
import creditService from '../services/creditService.js';
import aiService from '../services/aiService.js';
import { pool } from '../config/database.js';
import linkedinAutomationService from '../services/linkedinAutomationService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Strategy Builder'));

const stripMarkdownCodeFences = (value = '') =>
  String(value)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

const parseAddonAIOutput = (content) => {
  const normalizedContent = stripMarkdownCodeFences(content);
  let parsed = null;

  try {
    parsed = JSON.parse(normalizedContent);
  } catch (directParseError) {
    const jsonMatch = normalizedContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI response is not valid JSON');
    }
    parsed = JSON.parse(jsonMatch[0]);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response is not a valid object');
  }

  return {
    content_goals: Array.isArray(parsed.content_goals) ? parsed.content_goals : [],
    topics: Array.isArray(parsed.topics) ? parsed.topics : [],
  };
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

const dedupeStrings = (items = [], max = 20) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
};

const LOW_SIGNAL_TOPIC_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'to', 'the',
  'our', 'we', 'you', 'your', 'i', 'me', 'my', 'us',
  'am', 'are', 'be', 'been', 'being', 'was', 'were',
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'between', 'both', 'from',
  'have', 'having', 'into', 'just', 'more', 'most', 'over', 'than', 'that', 'their', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'using', 'very', 'with', 'your',
  'will', 'what', 'when', 'where', 'which', 'while', 'were', 'them', 'then', 'does', 'did',
  'each', 'such', 'like', 'make', 'made', 'many', 'some', 'because', 'would', 'could', 'should',
  'only', 'linkedin', 'post', 'posts', 'content', 'feature', 'features', 'user', 'users',
  'every', 'plan', 'plans', 'genie', 'suitegenie', 'linkedinstrategy', 'thread', 'threads',
  'twitter', 'tweet', 'tweets', 'account', 'accounts', 'team', 'now', 'one', 'hashtag',
  'published', 'edited', 'reposted', 'repost',
  'competitor', 'competitors', 'profile', 'configured', 'yet', 'mapped', 'opportunity', 'analysis',
  'connected', 'current', 'angle', 'score', 'sharpen', 'gap', 'gaps',
  'build', 'built', 'client', 'platform', 'workflow', 'analytic', 'tool', 'tools',
  'service', 'solution', 'product', 'creator', 'update',
  'add', 'unlock', 'precise', 'analysi', 'analysis', 'analyses', 'analyzing',
]);

const SHORT_TOPIC_ALLOWLIST = new Set(['ai', 'ux', 'ui', 'seo', 'b2b', 'b2c', 'api']);
const TOPIC_BLACKLIST_PATTERNS = [
  /competitor\s+profile\s+configured\s+yet/i,
  /add\s+competitors?\s+to\s+sharpen/i,
  /opportunity\s+analysis/i,
  /current\s+content\s+gaps?/i,
  /no\s+competitor\s+profile/i,
];
const WEAK_SINGLE_TOPIC_TOKENS = new Set([
  'build', 'built', 'agency', 'client', 'platform', 'workflow', 'analytic', 'social', 'growth',
]);
const ACRONYM_WORDS = new Set(['ai', 'ux', 'ui', 'seo', 'b2b', 'b2c', 'api', 'saas']);
const titleCaseWords = (value = '') =>
  String(value || '')
    .split(' ')
    .map((word) => (ACRONYM_WORDS.has(word) ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ')
    .trim();

const normalizeCompoundTokens = (value = '') =>
  String(value || '')
    .replace(/\bcontentcreation\b/gi, 'content creation')
    .replace(/\bsocialmediamanagement\b/gi, 'social media management')
    .replace(/\bmarketingtool\b/gi, 'marketing tool')
    .replace(/\bproductupdate\b/gi, 'product update')
    .replace(/\bagencylife\b/gi, 'agency life')
    .replace(/\bbuildinpublic\b/gi, 'build in public');

const normalizeTopicCandidate = (rawValue = '') => {
  const rawText = String(rawValue || '').trim();
  if (!rawText) return '';
  if (TOPIC_BLACKLIST_PATTERNS.some((pattern) => pattern.test(rawText))) return '';

  let value = normalizeCompoundTokens(String(rawValue || ''))
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/^#+/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return '';

  const words = value
    .split(' ')
    .map((word) => {
      if (!word) return '';
      if (word.endsWith("'s")) return word.slice(0, -2);
      if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
      if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('is') && word.length > 4) return word.slice(0, -1);
      return word;
    })
    .filter((word) => {
      if (!word) return false;
      if (/^\d+$/.test(word)) return false;
      if (!SHORT_TOPIC_ALLOWLIST.has(word) && word.length < 3) return false;
      if (LOW_SIGNAL_TOPIC_WORDS.has(word)) return false;
      return true;
    });

  if (words.length === 0) return '';
  if (words.length > 4) return '';
  if (words.length === 1 && WEAK_SINGLE_TOPIC_TOKENS.has(words[0])) return '';
  if (words.length === 2 && words.every((word) => WEAK_SINGLE_TOPIC_TOKENS.has(word))) return '';

  const compact = words.join(' ').trim();
  if (compact.length > 36) return '';

  return compact;
};

const normalizeTopicList = (items = [], max = 10) =>
  dedupeStrings(
    (Array.isArray(items) ? items : [items])
      .map((item) => normalizeTopicCandidate(item))
      .filter(Boolean),
    max
  );

const isWeakTopicCandidate = (value = '') => {
  const normalized = normalizeTopicCandidate(value);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1) {
    return WEAK_SINGLE_TOPIC_TOKENS.has(tokens[0]);
  }
    if (tokens.length === 2) {
      return tokens.every((token) => WEAK_SINGLE_TOPIC_TOKENS.has(token));
    }
    if (tokens.length >= 3) {
      const weakCount = tokens.filter((token) => WEAK_SINGLE_TOPIC_TOKENS.has(token)).length;
      return weakCount >= 2;
    }
    return false;
};

const sanitizeTrendingTopics = (items = [], max = 12) => {
  const seen = new Set();
  const result = [];

  for (const item of Array.isArray(items) ? items : []) {
    const topic = normalizeTopicCandidate(
      typeof item === 'string' ? item : item?.topic
    );
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({
      topic,
      volume: Number.isFinite(Number(item?.volume)) ? Number(item.volume) : 1,
      relevance:
        String(item?.relevance || '').toLowerCase() === 'high'
          ? 'high'
          : 'medium',
      context: typeof item?.context === 'string' ? item.context.slice(0, 200) : '',
    });

    if (result.length >= max) break;
  }

  return result;
};

const sanitizeAnalysisData = (value = {}) => {
  const raw = parseJsonObject(value, {});
  return {
    ...raw,
    niche: extractCompactNicheFromText(raw?.niche || '') || 'LinkedIn Growth Strategy',
    audience: String(raw?.audience || '').trim(),
    tone: String(raw?.tone || '').trim(),
    goals: dedupeStrings(
      Array.isArray(raw?.goals) ? raw.goals : splitToList(raw?.goals || '', 10),
      10
    ),
    top_topics: normalizeTopicList(raw?.top_topics || [], 12).filter((topic) => {
      if (isWeakTopicCandidate(topic)) return false;
      const tokenCount = String(topic || '').split(' ').filter(Boolean).length;
      return tokenCount <= 2;
    }),
  };
};

const splitToList = (value = '', max = 20) =>
  dedupeStrings(
    String(value || '')
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
    max
  );

const normalizeToneEnum = (value = '') => {
  const normalized = String(value || '').toLowerCase().trim();
  if (['professional', 'educational', 'founder', 'personal-story'].includes(normalized)) {
    return normalized;
  }
  if (normalized.includes('educat')) return 'educational';
  if (normalized.includes('founder') || normalized.includes('build in public')) return 'founder';
  if (normalized.includes('story') || normalized.includes('personal')) return 'personal-story';
  return 'professional';
};

const toneLabelFromEnum = (tone = '') => {
  const normalized = normalizeToneEnum(tone);
  if (normalized === 'educational') return 'Educational & helpful';
  if (normalized === 'founder') return 'Build-in-public storytelling';
  if (normalized === 'personal-story') return 'Personal story & reflective';
  return 'Professional & informative';
};

const normalizeHandle = (rawValue = '') => {
  let value = String(rawValue || '').trim();
  if (!value) return '';
  const urlMatch = value.match(
    /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|x\.com\/|twitter\.com\/)?@?([a-zA-Z0-9._-]+)/i
  );
  if (urlMatch?.[1]) {
    value = urlMatch[1];
  }
  value = value.replace(/^@+/, '').replace(/[^a-zA-Z0-9._-]/g, '');
  return value.slice(0, 80);
};

const getUserTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const bearerToken =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
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

const hashtagsFromQueue = (queue = []) => {
  const frequency = new Map();
  for (const item of Array.isArray(queue) ? queue : []) {
    const tags = Array.isArray(item?.hashtags) ? item.hashtags : [];
    for (const rawTag of tags) {
      const tag = String(rawTag || '').replace(/^#+/, '').trim().toLowerCase();
      if (!tag) continue;
      frequency.set(tag, (frequency.get(tag) || 0) + 1);
    }
  }
  return [...frequency.entries()].sort((a, b) => b[1] - a[1]);
};

const buildTrendingTopics = (queue = [], fallbackTopics = [], excludeTopics = []) => {
  const excluded = new Set(normalizeTopicList(excludeTopics, 40).map((topic) => topic.toLowerCase()));
  const seen = new Set();
  const weighted = [];

  for (const [rawTopic, volume] of hashtagsFromQueue(queue)) {
    const topic = normalizeTopicCandidate(String(rawTopic || '').replace(/[-_]/g, ' '));
    if (!topic) continue;
    if (excluded.has(topic)) continue;
    if (seen.has(topic)) continue;
    seen.add(topic);
    weighted.push({ topic, volume });
    if (weighted.length >= 8) break;
  }

  if (weighted.length > 0) return weighted;

  return normalizeTopicList(fallbackTopics, 12)
    .filter((topic) => !excluded.has(topic.toLowerCase()))
    .slice(0, 8)
    .map((topic, index) => ({
      topic,
      volume: Math.max(1, 8 - index),
    }));
};

const extractTopicsFromInsights = (insights = [], max = 8) => {
  const candidates = [];
  for (const rawInsight of Array.isArray(insights) ? insights : []) {
    const insight = String(rawInsight || '').trim();
    if (!insight) continue;

    const source = insight.includes(':') ? insight.split(':').slice(1).join(' ') : insight;
    const segments = source.split(/[,\n/|]/).map((part) => part.trim()).filter(Boolean);
    for (const segment of segments) {
      const normalizedSegment = normalizeTopicCandidate(segment);
      if (normalizedSegment) candidates.push(normalizedSegment);
    }

    const normalizedSource = normalizeTopicCandidate(source);
    if (normalizedSource) candidates.push(normalizedSource);
  }

  return normalizeTopicList(candidates, max);
};

const sanitizeGapMap = (items = [], max = 6) => {
  const seen = new Set();
  const result = [];

  for (const entry of Array.isArray(items) ? items : []) {
    const topic = normalizeTopicCandidate(typeof entry === 'string' ? entry : entry?.topic);
    if (!topic) continue;
    if (isWeakTopicCandidate(topic)) continue;

    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const rawScore = Number(entry?.score ?? entry?.gap_score ?? entry?.gapScore);
    const score = Number.isFinite(rawScore)
      ? Math.max(5, Math.min(95, Math.round(rawScore)))
      : 50;

    result.push({
      topic,
      score,
      reason: String(entry?.reason || '').trim().slice(0, 220),
    });

    if (result.length >= max) break;
  }

  return result;
};

const buildGapMap = ({
  topTopics = [],
  niche = '',
  postSummary = {},
  runAnalysis = {},
  competitorConfig = {},
} = {}) => {
  const summaryThemes = normalizeTopicList(postSummary?.themes || [], 10);
  const analysisTopics = normalizeTopicList(
    [
      ...extractTopicsFromInsights(runAnalysis?.opportunities || [], 10),
      ...extractTopicsFromInsights(runAnalysis?.gaps || [], 10),
    ],
    10
  );
  const candidateTopics = normalizeTopicList(
    [...(Array.isArray(topTopics) ? topTopics : []), ...summaryThemes, ...analysisTopics],
    10
  ).filter((topic) => {
    if (isWeakTopicCandidate(topic)) return false;
    const tokenCount = String(topic || '').split(' ').filter(Boolean).length;
    return tokenCount <= 2;
  });
  const fallbackNicheTopic = normalizeTopicCandidate(niche);

  const competitorCount = Array.isArray(competitorConfig?.competitor_profiles)
    ? competitorConfig.competitor_profiles.length
    : 0;
  const opportunityText = Array.isArray(runAnalysis?.opportunities)
    ? runAnalysis.opportunities.join(' ').toLowerCase()
    : '';
  const gapText = Array.isArray(runAnalysis?.gaps)
    ? runAnalysis.gaps.join(' ').toLowerCase()
    : '';

  const themeSet = new Set(summaryThemes.map((topic) => topic.toLowerCase()));
  const topTopicSet = new Set(normalizeTopicList(topTopics, 12).map((topic) => topic.toLowerCase()));

  const sourceTopics = candidateTopics.length > 0
    ? candidateTopics
    : (
      fallbackNicheTopic && !isWeakTopicCandidate(fallbackNicheTopic)
        ? [fallbackNicheTopic]
        : ['practical framework', 'audience pain point', 'industry insight']
    );

  const scored = sourceTopics.map((topic) => {
    const words = topic
      .toLowerCase()
      .split(' ')
      .map((word) => word.trim())
      .filter((word) => word.length >= 3);
    const hasOpportunitySignal = words.some((word) => opportunityText.includes(word));
    const hasGapSignal = words.some((word) => gapText.includes(word));

    let score = 45;
    if (themeSet.has(topic.toLowerCase())) score += 8;
    if (topTopicSet.has(topic.toLowerCase())) score += 10;
    if (hasOpportunitySignal) score += 18;
    if (hasGapSignal) score += 10;
    if (competitorCount >= 3) score += 12;
    else if (competitorCount > 0) score += 6;
    else score -= 5;
    score = Math.max(5, Math.min(95, Math.round(score)));

    const reasonParts = [];
    if (themeSet.has(topic.toLowerCase())) {
      reasonParts.push('repeats in your recent posts');
    }
    if (hasOpportunitySignal || hasGapSignal) {
      reasonParts.push('matches current opportunity signals');
    }
    if (competitorCount > 0) {
      reasonParts.push(`checked against ${competitorCount} competitor profile(s)`);
    } else {
      reasonParts.push('add competitors to improve precision');
    }

    return {
      topic,
      score,
      reason: reasonParts.length > 0 ? `This angle ${reasonParts.join(', ')}.` : 'Promising angle for your current strategy.',
    };
  });

  return sanitizeGapMap(scored.sort((a, b) => b.score - a.score), 5);
};

const WEAK_NICHE_TOKENS = new Set([
  'suitegenie', 'linkedin', 'growth', 'strategy', 'content', 'social', 'post', 'marketing',
  'brand', 'company', 'business', 'team', 'hashtag',
  'build', 'built', 'agency', 'client', 'platform', 'workflow', 'analytic',
]);

const isWeakNicheValue = (value = '') => {
  const normalized = normalizeTopicCandidate(value);
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length <= 2) {
    return tokens.every((token) => WEAK_NICHE_TOKENS.has(token));
  }
  if (tokens.length === 3) {
    return tokens.filter((token) => WEAK_NICHE_TOKENS.has(token)).length >= 2;
  }
  return false;
};

const extractCompactNicheFromText = (value = '') => {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const directNormalized = normalizeTopicCandidate(raw);
  if (directNormalized && !isWeakNicheValue(directNormalized)) {
    return titleCaseWords(directNormalized);
  }

  const cleaned = raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/what we do:?/gi, ' ')
    .replace(/key features:?/gi, ' ')
    .replace(/why [^:]{1,60}:/gi, ' ')
    .replace(/perfect for:?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const segments = cleaned
    .split(/[\n\r.!?;|]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const normalized = normalizeTopicCandidate(segment);
    if (!normalized) continue;
    if (isWeakNicheValue(normalized)) continue;
    return titleCaseWords(normalized);
  }

  const compressed = normalizeTopicCandidate(
    cleaned
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/-/g, ' ')
      .split(' ')
      .filter((word) => word && !LOW_SIGNAL_TOPIC_WORDS.has(word) && !WEAK_NICHE_TOKENS.has(word))
      .slice(0, 6)
      .join(' ')
  );

  if (compressed && !isWeakNicheValue(compressed)) {
    return titleCaseWords(compressed);
  }

  return '';
};

const deriveNicheValue = ({ profileContext, strategy, accountSnapshot, topTopics }) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const directCandidates = [
    accountSnapshot?.headline,
    accountSnapshot?.about,
    metadata?.profile_headline,
    metadata?.profile_about,
    metadata?.organization_name,
    profileContext?.role_niche,
    strategy?.niche,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of directCandidates) {
    const compact = extractCompactNicheFromText(candidate);
    if (compact) return compact;
  }

  const topicBased = normalizeTopicList(topTopics || [], 6);
  const strongTopicBased = topicBased.filter(
    (topic) => !isWeakNicheValue(topic) && !isWeakTopicCandidate(topic)
  );
  if (strongTopicBased.length >= 2) {
    return titleCaseWords(`${strongTopicBased[0]} ${strongTopicBased[1]}`);
  }
  if (strongTopicBased.length === 1) {
    return titleCaseWords(strongTopicBased[0]);
  }

  const fallbackStrategyNiche = extractCompactNicheFromText(strategy?.niche || '');
  if (fallbackStrategyNiche) {
    return fallbackStrategyNiche;
  }

  return 'LinkedIn Growth Strategy';
};

const deriveAudienceValue = ({ profileContext, strategy, topTopics }) => {
  const direct = String(profileContext?.target_audience || strategy?.target_audience || '').trim();
  if (direct) return direct;

  const topical = normalizeTopicList(topTopics || [], 4).filter((topic) => !isWeakNicheValue(topic)).slice(0, 2);
  if (topical.length > 0) {
    return `Professionals interested in ${topical.join(' and ')}`;
  }

  return 'Professionals in your niche';
};

const buildAnalysisData = ({
  strategy,
  profileContext,
  accountSnapshot,
  queue,
  runAnalysis,
  postSummary,
}) => {
  const fallbackGoals = Array.isArray(strategy?.content_goals) ? strategy.content_goals : [];
  const profileGoals = splitToList(profileContext?.outcomes_30_90 || '', 10);
  const goals = dedupeStrings([...profileGoals, ...fallbackGoals], 10);

  const queueTopics = hashtagsFromQueue(queue).map(([tag]) => tag.replace(/[-_]/g, ' '));
  const strategyTopics = Array.isArray(strategy?.topics) ? strategy.topics : [];
  const summaryThemes = Array.isArray(postSummary?.themes) ? postSummary.themes : [];
  const analysisTopics = [
    ...extractTopicsFromInsights(runAnalysis?.opportunities || [], 8),
    ...extractTopicsFromInsights(runAnalysis?.gaps || [], 8),
  ];
  let topTopics = normalizeTopicList(
    [...summaryThemes, ...analysisTopics, ...strategyTopics, ...queueTopics],
    12
  ).filter((topic) => {
    if (isWeakTopicCandidate(topic)) return false;
    const tokenCount = String(topic || '').split(' ').filter(Boolean).length;
    return tokenCount <= 2;
  });
  if (topTopics.length < 4) {
    const fallbackTopics = normalizeTopicList(
      [
        strategy?.niche,
        profileContext?.role_niche,
        strategy?.target_audience,
        profileContext?.target_audience,
        ...strategyTopics,
      ],
      10
    ).filter((topic) => {
      if (isWeakTopicCandidate(topic)) return false;
      const tokenCount = String(topic || '').split(' ').filter(Boolean).length;
      return tokenCount <= 2;
    });
    topTopics = dedupeStrings([...topTopics, ...fallbackTopics], 12);
  }
  if (topTopics.length === 0) {
    topTopics = ['practical framework', 'audience pain point', 'industry insight'];
  }

  const niche = deriveNicheValue({
    profileContext,
    strategy,
    accountSnapshot,
    topTopics,
  });
  const audience = deriveAudienceValue({
    profileContext,
    strategy,
    topTopics,
  });

  return {
    niche,
    audience,
    tone: toneLabelFromEnum(profileContext?.tone_style || strategy?.tone_style || 'professional'),
    goals,
    top_topics: topTopics,
    posting_frequency: strategy?.posting_frequency || '3-5 times per week',
    best_days: ['Tuesday', 'Thursday'],
    best_hours: '9am-11am',
    summary:
      runAnalysis?.opportunities?.[0] ||
      'Focus on practical, proof-backed posts to improve consistency and engagement.',
  };
};

const getRunById = async (runId, userId) => {
  const { rows } = await pool.query(
    `SELECT *
     FROM linkedin_automation_runs
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [runId, userId]
  );
  return rows[0] || null;
};

const updateRunMetadata = async (runId, metadata = {}) => {
  await pool.query(
    `UPDATE linkedin_automation_runs
     SET metadata = $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(metadata || {}), runId]
  );
};

// Get or create current strategy
router.get('/current', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;

    const strategy = await strategyService.getOrCreateStrategy(userId, teamId);
    const chatHistory = await strategyService.getChatHistory(strategy.id);

    res.json({
      strategy,
      chatHistory
    });
  } catch (error) {
    console.error('Error getting strategy:', error);
    res.status(500).json({ error: 'Failed to get strategy' });
  }
});

// Create new strategy
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;
    const {
      niche,
      target_audience,
      posting_frequency,
      content_goals,
      topics,
      status = 'draft',
      metadata = {},
    } = req.body;

    if (!niche || !niche.trim()) {
      return res.status(400).json({ error: 'Niche/strategy name is required' });
    }

    const strategy = await strategyService.createStrategy(userId, teamId, {
      niche: niche.trim(),
      target_audience: target_audience?.trim() || '',
      posting_frequency: posting_frequency?.trim() || '',
      content_goals: Array.isArray(content_goals) ? content_goals : [],
      topics: Array.isArray(topics) ? topics : [],
      status,
      metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    });

    res.status(201).json(strategy);
  } catch (error) {
    console.error('Error creating strategy:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Send chat message
router.post('/chat', async (req, res) => {
  try {
    const userId = req.user.id;
    const { message, strategyId, currentStep = 0 } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let strategy;
    if (strategyId) {
      strategy = await strategyService.getStrategy(strategyId);
      if (!strategy || strategy.user_id !== userId) {
        return res.status(404).json({ error: 'Strategy not found' });
      }
    } else {
      const teamId = req.headers['x-team-id'] || null;
      strategy = await strategyService.getOrCreateStrategy(userId, teamId);
    }

    // Check and deduct credits (0.5 credits per message)
    const creditResult = await creditService.checkAndDeductCredits(
      userId,
      'strategy_chat',
      0.5
    );
    
    if (!creditResult.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        available: creditResult.available ?? creditResult.creditsAvailable ?? 0,
        required: creditResult.required ?? creditResult.creditsRequired ?? 0.5
      });
    }

    // Process message
    const response = await strategyService.processChatMessage(
      strategy.id,
      userId,
      message.trim(),
      currentStep
    );

    res.json(response);
  } catch (error) {
    console.error('Error processing chat:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Generate prompts for strategy
router.post('/:id/generate-prompts', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if strategy belongs to user
    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Check and deduct credits (10 credits for generating prompts)
    const creditResult = await creditService.checkAndDeductCredits(
      userId,
      'strategy_prompts_generation',
      10
    );
    
    if (!creditResult.success) {
      return res.status(402).json({ 
        error: 'Insufficient credits. Need 10 credits to generate prompts.',
        available: creditResult.available ?? creditResult.creditsAvailable ?? 0,
        required: creditResult.required ?? creditResult.creditsRequired ?? 10
      });
    }

    // Generate prompts
    const result = await strategyService.generatePrompts(id, userId);

    res.json(result);
  } catch (error) {
    console.error('Error generating prompts:', error);
    res.status(500).json({ error: 'Failed to generate prompts' });
  }
});

// Incremental add-on for goals/topics
router.post('/:id/add-on', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { source, content_goals, topics, prompt } = req.body || {};

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    if (!source || !['manual', 'ai'].includes(source)) {
      return res.status(400).json({ error: 'Invalid source. Use "manual" or "ai".' });
    }

    let additions = {
      content_goals: [],
      topics: [],
    };

    if (source === 'manual') {
      if (!Array.isArray(content_goals) && !Array.isArray(topics)) {
        return res.status(400).json({
          error: 'Invalid payload. Provide content_goals and/or topics arrays.'
        });
      }

      additions = {
        content_goals: Array.isArray(content_goals) ? content_goals : [],
        topics: Array.isArray(topics) ? topics : [],
      };
    } else {
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
        return res.status(400).json({ error: 'Prompt is required for AI add-on and must be at least 5 characters.' });
      }

      const creditResult = await creditService.checkAndDeductCredits(
        userId,
        'strategy_addon_ai',
        0.5
      );

      if (!creditResult.success) {
        return res.status(402).json({
          error: 'Insufficient credits',
          available: creditResult.available ?? creditResult.creditsAvailable ?? 0,
          required: creditResult.required ?? creditResult.creditsRequired ?? 0.5
        });
      }

      const authHeader = req.headers['authorization'];
      const token = req.cookies?.accessToken || (authHeader && authHeader.split(' ')[1]) || null;
      const refreshToken = req.cookies?.refreshToken;
      const cookieParts = [];
      if (token) cookieParts.push(`accessToken=${token}`);
      if (refreshToken) cookieParts.push(`refreshToken=${refreshToken}`);
      const cookieHeader = cookieParts.length > 0 ? cookieParts.join('; ') : null;

      try {
        const aiPrompt = [
          'Return ONLY valid JSON. No markdown, no extra keys.',
          'Schema: {"content_goals": string[], "topics": string[]}',
          'Rules: max 20 items each, concise phrases, no numbering.',
          `User request: ${prompt.trim()}`
        ].join('\n');

        const aiResult = await aiService.generateStrategyContent(
          aiPrompt,
          'professional',
          token,
          userId,
          cookieHeader
        );

        additions = parseAddonAIOutput(aiResult?.content || '');
      } catch (aiError) {
        await creditService.refund(userId, 0.5, 'strategy_addon_ai_failed', 'refund');
        throw aiError;
      }
    }

    if (
      (!Array.isArray(additions.content_goals) || additions.content_goals.length === 0) &&
      (!Array.isArray(additions.topics) || additions.topics.length === 0)
    ) {
      if (source === 'ai') {
        await creditService.refund(userId, 0.5, 'strategy_addon_ai_empty', 'refund');
      }
      return res.status(400).json({
        error: 'No valid goals/topics to add.'
      });
    }

    const result = await strategyService.appendStrategyFields(
      id,
      additions,
      { source: source === 'ai' ? 'ai_add_on' : 'manual_add_on' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('Error processing strategy add-on:', error);
    res.status(500).json({ error: 'Failed to process strategy add-on' });
  }
});

// POST /api/strategy/init-analysis - Tweet Genie parity flow for LinkedIn
router.post('/init-analysis', async (req, res) => {
  let analysisCreditsDeducted = false;
  try {
    const userId = req.user.id;
    const {
      strategyId,
      portfolioUrl = '',
      userContext = '',
      account_id: accountId = null,
      account_type: accountType = null,
    } = req.body || {};

    console.log('[Strategy] init-analysis request', {
      userId,
      strategyId,
      accountId,
      accountType,
      hasPortfolioUrl: Boolean(String(portfolioUrl || '').trim()),
      hasUserContext: Boolean(String(userContext || '').trim()),
    });

    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required' });
    }

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const creditResult = await creditService.checkAndDeductCredits(userId, 'profile_analysis', 5);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 5 credits required for account analysis.',
        available: creditResult.creditsAvailable ?? 0,
        required: creditResult.creditsRequired ?? 5,
      });
    }
    analysisCreditsDeducted = true;

    const currentMetadata = parseJsonObject(strategy.metadata, {});
    const derivedGoals = Array.isArray(strategy.content_goals) ? strategy.content_goals.join(', ') : '';
    const accountSnapshot = await linkedinAutomationService.getLinkedinAccountSnapshot(userId, {
      accountId,
      accountType,
    });
    const profileHeadline = String(
      accountSnapshot?.headline || currentMetadata.profile_headline || ''
    ).trim();
    const strategyNiche = String(strategy.niche || '').trim();
    const metadataNiche = String(currentMetadata.role_niche || '').trim();
    const seededRoleNiche = (
      (!isWeakNicheValue(profileHeadline) && profileHeadline) ||
      (!isWeakNicheValue(metadataNiche) && metadataNiche) ||
      (!isWeakNicheValue(strategyNiche) && strategyNiche) ||
      profileHeadline ||
      metadataNiche ||
      strategyNiche ||
      ''
    ).trim();

    await linkedinAutomationService.upsertProfileContext(userId, {
      role_niche: seededRoleNiche,
      target_audience: strategy.target_audience || '',
      outcomes_30_90: derivedGoals || currentMetadata.outcomes_30_90 || '',
      proof_points: String(userContext || currentMetadata.extra_context || '').slice(0, 1200),
      tone_style: normalizeToneEnum(strategy.tone_style),
      consent_use_posts: true,
      consent_store_profile: true,
      metadata: {
        ...currentMetadata,
        portfolio_url: String(portfolioUrl || '').trim(),
        user_context: String(userContext || '').trim(),
        profile_headline: profileHeadline || null,
        profile_display_name: accountSnapshot?.display_name || null,
        sourced_from: 'strategy_init_analysis',
      },
    });

    const runResult = await linkedinAutomationService.runPipeline({
      userId,
      queueTarget: 7,
      userToken: getUserTokenFromRequest(req),
      cookieHeader: buildCookieHeader(req),
      accountId,
      accountType,
    });

    const runRow = await getRunById(runResult.runId, userId);
    const snapshot = parseJsonObject(runRow?.analysis_snapshot, {});
    const profileContext = parseJsonObject(snapshot.profileContext, {});
    const postSummary = parseJsonObject(snapshot.postSummary, {});
    const runAnalysis = parseJsonObject(snapshot.analysis, {});
    const competitorConfig = parseJsonObject(snapshot.competitorConfig, {});
    const analysisAccountSnapshot = parseJsonObject(snapshot.accountSnapshot, {});

    const analysisData = sanitizeAnalysisData(buildAnalysisData({
      strategy,
      profileContext,
      accountSnapshot: analysisAccountSnapshot,
      queue: runResult.queue,
      runAnalysis,
      postSummary,
    }));
    const trendingTopics = sanitizeTrendingTopics(buildTrendingTopics(
      runResult.queue,
      [
        ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
        ...(Array.isArray(strategy?.topics) ? strategy.topics : []),
        analysisData.niche,
      ],
      analysisData.top_topics
    ));
    const gapMap = sanitizeGapMap(buildGapMap({
      topTopics: analysisData.top_topics,
      niche: analysisData.niche,
      postSummary,
      runAnalysis,
      competitorConfig,
    }));

    const tweetsAnalysed = Number(postSummary.postCount || 0);
    const confidence = tweetsAnalysed >= 20 ? 'high' : tweetsAnalysed >= 8 ? 'medium' : 'low';
    const confidenceReason =
      tweetsAnalysed >= 20
        ? 'Sufficient LinkedIn post history available for higher-confidence recommendations.'
        : tweetsAnalysed >= 8
          ? 'Moderate post history available. Recommendations are usable and improve as more posts are added.'
          : 'Limited historical post data. Recommendations rely more on strategy context and heuristics.';

    const existingMetadata = parseJsonObject(runRow?.metadata, {});
    const nextMetadata = {
      ...existingMetadata,
      strategy_id: strategyId,
      analysis_data: analysisData,
      trending_topics: trendingTopics,
      reference_accounts: [],
      gap_map: gapMap,
      tweets_analysed: tweetsAnalysed,
      confidence,
      confidence_reason: confidenceReason,
      portfolio_url: String(portfolioUrl || '').trim(),
      user_context: String(userContext || '').trim(),
      queue_preview_count: Array.isArray(runResult.queue) ? runResult.queue.length : 0,
    };
    await updateRunMetadata(runResult.runId, nextMetadata);

    console.log('[Strategy] init-analysis completed', {
      userId,
      strategyId,
      analysisId: runResult.runId,
      accountId,
      accountType,
      tweetsAnalysed,
      confidence,
      topTopics: Array.isArray(analysisData?.top_topics) ? analysisData.top_topics : [],
      gapMap,
      queueItems: Array.isArray(runResult.queue) ? runResult.queue.length : 0,
      sourceScope: postSummary?.sourceScope || 'unknown',
    });

    return res.json({
      success: true,
      analysisId: runResult.runId,
      analysis: analysisData,
      trending: trendingTopics,
      gapMap,
      tweetsAnalysed,
      tweetSource: 'linkedin_posts',
      confidence,
      confidenceReason: confidenceReason,
    });
  } catch (error) {
    console.error('[Strategy] init-analysis error:', error);
    if (analysisCreditsDeducted) {
      try {
        await creditService.refund(req.user.id, 5, 'profile_analysis_failed', 'refund');
      } catch (refundError) {
        console.error('[Strategy] init-analysis refund failed:', refundError);
      }
    }
    return res.status(500).json({ error: error.message || 'Analysis failed' });
  }
});

// POST /api/strategy/apply-analysis - confirm/edit analysis step
router.post('/apply-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const { analysisId, step, value } = req.body || {};

    if (!analysisId || !step || value === undefined) {
      return res.status(400).json({ error: 'analysisId, step, and value are required' });
    }

    const allowedSteps = ['niche', 'audience', 'tone', 'goals', 'topics', 'posting_frequency', 'extra_context'];
    if (!allowedSteps.includes(step)) {
      return res.status(400).json({ error: `Invalid step. Allowed: ${allowedSteps.join(', ')}` });
    }

    const run = await getRunById(analysisId, userId);
    if (!run) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const metadata = parseJsonObject(run.metadata, {});
    const analysisData = sanitizeAnalysisData(metadata.analysis_data);
    const snapshot = parseJsonObject(run.analysis_snapshot, {});
    const runAnalysis = parseJsonObject(snapshot.analysis, {});
    const postSummary = parseJsonObject(snapshot.postSummary, {});
    const competitorConfig = parseJsonObject(snapshot.competitorConfig, {});

    if (step === 'niche') {
      analysisData.niche = String(value || '').trim();
    } else if (step === 'audience') {
      analysisData.audience = String(value || '').trim();
    } else if (step === 'tone') {
      analysisData.tone = String(value || '').trim();
    } else if (step === 'goals') {
      const goals = Array.isArray(value) ? value : splitToList(value, 10);
      analysisData.goals = dedupeStrings(goals, 10);
    } else if (step === 'topics') {
      const topics = Array.isArray(value) ? value : splitToList(value, 12);
      analysisData.top_topics = normalizeTopicList(topics, 12);
    } else if (step === 'posting_frequency') {
      const postingString = String(value || '').trim();
      const firstLine = postingString.split('\n')[0]?.trim();
      if (firstLine) {
        analysisData.posting_frequency = firstLine;
      }
    } else if (step === 'extra_context') {
      const extra = value && typeof value === 'object' ? value : {};
      metadata.extra_context = {
        deeper_url: String(extra.deeper_url || '').trim(),
        deeper_context: String(extra.deeper_context || '').trim(),
      };
      const strategyId = metadata.strategy_id;
      if (strategyId) {
        const strategy = await strategyService.getStrategy(strategyId);
        if (strategy && strategy.user_id === userId) {
          const existing = parseJsonObject(strategy.metadata, {});
          await strategyService.updateStrategy(strategyId, {
            metadata: {
              ...existing,
              extra_context: metadata.extra_context.deeper_context,
              extra_context_url: metadata.extra_context.deeper_url,
            },
          });
        }
      }
    }

    const sanitizedAnalysisData = sanitizeAnalysisData(analysisData);
    metadata.analysis_data = sanitizedAnalysisData;
    metadata.gap_map = sanitizeGapMap(buildGapMap({
      topTopics: sanitizedAnalysisData.top_topics,
      niche: sanitizedAnalysisData.niche,
      postSummary,
      runAnalysis,
      competitorConfig,
    }));
    await updateRunMetadata(analysisId, metadata);

    return res.json({
      success: true,
      analysisData: sanitizedAnalysisData,
      gapMap: metadata.gap_map,
    });
  } catch (error) {
    console.error('[Strategy] apply-analysis error:', error);
    return res.status(500).json({ error: error.message || 'Failed to save analysis step' });
  }
});

// POST /api/strategy/reference-analysis - analyse competitor/reference accounts
router.post('/reference-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const { analysisId, handles } = req.body || {};

    if (!analysisId || !Array.isArray(handles) || handles.length === 0) {
      return res.status(400).json({ error: 'analysisId and handles array are required' });
    }

    const run = await getRunById(analysisId, userId);
    if (!run) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const cleanHandles = dedupeStrings(handles.map((handle) => normalizeHandle(handle)).filter(Boolean), 2);
    if (cleanHandles.length === 0) {
      return res.status(400).json({ error: 'No valid handles found' });
    }

    const metadata = parseJsonObject(run.metadata, {});
    const analysisData = parseJsonObject(metadata.analysis_data, {});
    const snapshot = parseJsonObject(run.analysis_snapshot, {});
    const analysis = parseJsonObject(snapshot.analysis, {});

    const referenceAccounts = cleanHandles.map((handle) => ({
      handle: handle.startsWith('@') ? handle : `@${handle}`,
      key_takeaway:
        `This account leans into ${analysisData.niche || 'its niche'} with consistent positioning. ` +
        'Use stronger hooks and proof points to stand out.',
      content_angles: dedupeStrings(analysisData.top_topics || [], 3),
      what_works: dedupeStrings(analysis.strengths || [], 3),
      gaps_you_can_fill: dedupeStrings(analysis.gaps || analysis.opportunities || [], 3),
    }));

    metadata.reference_accounts = referenceAccounts;
    const snapshotCompetitors = parseJsonObject(snapshot.competitorConfig, {});
    metadata.gap_map = sanitizeGapMap(buildGapMap({
      topTopics: analysisData.top_topics,
      niche: analysisData.niche,
      postSummary: parseJsonObject(snapshot.postSummary, {}),
      runAnalysis: analysis,
      competitorConfig: {
        ...snapshotCompetitors,
        competitor_profiles: cleanHandles,
      },
    }));
    await updateRunMetadata(analysisId, metadata);

    // Persist handles for future deep-dive runs
    await linkedinAutomationService.upsertCompetitors(userId, {
      competitor_profiles: cleanHandles,
      competitor_examples: [],
      win_angle: 'authority',
    });

    return res.json({
      success: true,
      referenceAccounts,
      gapMap: metadata.gap_map,
    });
  } catch (error) {
    console.error('[Strategy] reference-analysis error:', error);
    return res.status(500).json({ error: error.message || 'Failed to analyse reference accounts' });
  }
});

// POST /api/strategy/generate-analysis-prompts - generate prompt library from analysis
router.post('/generate-analysis-prompts', async (req, res) => {
  let promptCreditsDeducted = false;
  try {
    const userId = req.user.id;
    const { analysisId, strategyId } = req.body || {};

    if (!analysisId || !strategyId) {
      return res.status(400).json({ error: 'analysisId and strategyId are required' });
    }

    const run = await getRunById(analysisId, userId);
    if (!run) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const creditResult = await creditService.checkAndDeductCredits(userId, 'analysis_prompt_generation', 10);
    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits. 10 credits required for prompt generation.',
        available: creditResult.creditsAvailable ?? 0,
        required: creditResult.creditsRequired ?? 10,
      });
    }
    promptCreditsDeducted = true;

    const metadata = parseJsonObject(run.metadata, {});
    const analysisData = parseJsonObject(metadata.analysis_data, {});
    const runSnapshot = parseJsonObject(run.analysis_snapshot, {});
    const runAnalysis = parseJsonObject(runSnapshot.analysis, {});
    const strategyMetadata = parseJsonObject(strategy.metadata, {});

    await strategyService.updateStrategy(strategyId, {
      niche: analysisData.niche || strategy.niche,
      target_audience: analysisData.audience || strategy.target_audience,
      tone_style: analysisData.tone || strategy.tone_style,
      posting_frequency: analysisData.posting_frequency || strategy.posting_frequency || '3-5 times per week',
      content_goals: dedupeStrings(
        [...(Array.isArray(strategy.content_goals) ? strategy.content_goals : []), ...(analysisData.goals || [])],
        20
      ),
      topics: dedupeStrings(
        [...(Array.isArray(strategy.topics) ? strategy.topics : []), ...(analysisData.top_topics || [])],
        20
      ),
      status: 'active',
      metadata: {
        ...strategyMetadata,
        basic_profile_completed: true,
        analysis_cache: {
          analysis_id: analysisId,
          tweets_analysed: metadata.tweets_analysed || 0,
          confidence: metadata.confidence || 'low',
          confidence_reason: metadata.confidence_reason || '',
          trending_topics: metadata.trending_topics || [],
          gap_map: metadata.gap_map || [],
          strengths: Array.isArray(runAnalysis?.strengths) ? runAnalysis.strengths : [],
          gaps: Array.isArray(runAnalysis?.gaps) ? runAnalysis.gaps : [],
          opportunities: Array.isArray(runAnalysis?.opportunities) ? runAnalysis.opportunities : [],
          next_angles: Array.isArray(runAnalysis?.nextAngles) ? runAnalysis.nextAngles : [],
        },
      },
    });

    const result = await strategyService.generatePrompts(strategyId, userId);

    metadata.prompt_generation = {
      generated_at: new Date().toISOString(),
      count: result?.count || 0,
      success: true,
    };
    await updateRunMetadata(analysisId, metadata);

    return res.json({
      success: true,
      promptCount: result?.count || 0,
      prompts: result?.prompts || [],
    });
  } catch (error) {
    console.error('[Strategy] generate-analysis-prompts error:', error);
    if (promptCreditsDeducted) {
      try {
        await creditService.refund(req.user.id, 10, 'analysis_prompt_generation_failed', 'refund');
      } catch (refundError) {
        console.error('[Strategy] prompt refund failed:', refundError);
      }
    }
    return res.status(500).json({ error: error.message || 'Failed to generate prompts from analysis' });
  }
});

// GET /api/strategy/analysis-status/:analysisId - poll analysis status
router.get('/analysis-status/:analysisId', async (req, res) => {
  try {
    const run = await getRunById(req.params.analysisId, req.user.id);
    if (!run) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const metadata = parseJsonObject(run.metadata, {});
    const safeAnalysisData = sanitizeAnalysisData(metadata.analysis_data);
    const safeTrendingTopics = sanitizeTrendingTopics(metadata.trending_topics);
    const safeGapMap = sanitizeGapMap(metadata.gap_map);

    return res.json({
      id: run.id,
      status: run.status || 'completed',
      confidence: metadata.confidence || 'low',
      confidenceReason: metadata.confidence_reason || '',
      tweetsAnalysed: metadata.tweets_analysed || 0,
      analysisData: safeAnalysisData,
      trendingTopics: safeTrendingTopics,
      gapMap: safeGapMap,
      referenceAccounts: Array.isArray(metadata.reference_accounts) ? metadata.reference_accounts : [],
      error: null,
      createdAt: run.created_at,
    });
  } catch (error) {
    console.error('[Strategy] analysis-status error:', error);
    return res.status(500).json({ error: 'Failed to get analysis status' });
  }
});

// GET /api/strategy/latest-analysis - latest analysis for strategy/user
router.get('/latest-analysis', async (req, res) => {
  try {
    const userId = req.user.id;
    const strategyId = String(req.query.strategyId || '').trim() || null;

    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_runs
       WHERE user_id = $1
         AND ($2::text IS NULL OR metadata->>'strategy_id' = $2::text)
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, strategyId]
    );

    const run = rows[0];
    if (!run) {
      return res.status(404).json({ error: 'No analysis found' });
    }

    const metadata = parseJsonObject(run.metadata, {});
    const safeAnalysisData = sanitizeAnalysisData(metadata.analysis_data);
    const safeTrendingTopics = sanitizeTrendingTopics(metadata.trending_topics);
    const safeGapMap = sanitizeGapMap(metadata.gap_map);
    return res.json({
      id: run.id,
      status: run.status || 'completed',
      confidence: metadata.confidence || 'low',
      confidenceReason: metadata.confidence_reason || '',
      tweetsAnalysed: metadata.tweets_analysed || 0,
      analysisData: safeAnalysisData,
      trendingTopics: safeTrendingTopics,
      gapMap: safeGapMap,
      referenceAccounts: Array.isArray(metadata.reference_accounts) ? metadata.reference_accounts : [],
      error: null,
      createdAt: run.created_at,
    });
  } catch (error) {
    console.error('[Strategy] latest-analysis error:', error);
    return res.status(500).json({ error: 'Failed to get latest analysis' });
  }
});

// Get all strategies for user
router.get('/list', async (req, res) => {
  try {
    const userId = req.user.id;
    const teamId = req.headers['x-team-id'] || null;

    const strategies = await strategyService.getUserStrategies(userId, teamId);
    res.json(strategies);
  } catch (error) {
    console.error('Error getting strategies:', error);
    res.status(500).json({ error: 'Failed to get strategies' });
  }
});

// Get strategy by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const strategy = await strategyService.getStrategy(id);
    
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const chatHistory = await strategyService.getChatHistory(id);
    const prompts = await strategyService.getPrompts(id);

    res.json({
      strategy,
      chatHistory,
      prompts
    });
  } catch (error) {
    console.error('Error getting strategy:', error);
    res.status(500).json({ error: 'Failed to get strategy' });
  }
});

// Get prompts for strategy
router.get('/:id/prompts', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { category, favorite, limit } = req.query;

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const filters = {
      category,
      isFavorite: favorite === 'true',
      limit: limit ? parseInt(limit) : undefined
    };

    const prompts = await strategyService.getPrompts(id, filters);
    res.json(prompts);
  } catch (error) {
    console.error('Error getting prompts:', error);
    res.status(500).json({ error: 'Failed to get prompts' });
  }
});

// Toggle favorite prompt
router.post('/prompts/:promptId/favorite', async (req, res) => {
  try {
    const { promptId } = req.params;
    const prompt = await strategyService.toggleFavoritePrompt(promptId);
    res.json(prompt);
  } catch (error) {
    console.error('Error toggling favorite:', error);
    res.status(500).json({ error: 'Failed to toggle favorite' });
  }
});

// Update strategy
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const updates = req.body;

    const strategy = await strategyService.getStrategy(id);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const updated = await strategyService.updateStrategy(id, updates);
    res.json(updated);
  } catch (error) {
    console.error('Error updating strategy:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

// Delete strategy
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await strategyService.deleteStrategy(id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting strategy:', error);
    res.status(500).json({ error: 'Failed to delete strategy' });
  }
});

export default router;

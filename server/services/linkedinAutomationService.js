import crypto from 'crypto';
import { DateTime } from 'luxon';
import axios from 'axios';
import { pool } from '../config/database.js';
import aiService from './aiService.js';
import { create as createScheduledPost } from '../models/scheduledPostModel.js';
import { resolveTeamAccountForUser } from '../utils/teamAccountScope.js';

const DEFAULT_QUEUE_TARGET = 7;
const MAX_QUEUE_TARGET = 14;
const MAX_COMPETITOR_PROFILES = 5;
const MAX_COMPETITOR_EXAMPLES = 12;
const MAX_POSTS_FOR_ANALYSIS = 60;
const MAX_TEXT_FIELD_LENGTH = 1200;
const MAX_STRATEGY_PROMPT_LENGTH = 3400;
const DEFAULT_TONE = 'professional';
const ALLOWED_TONES = new Set(['professional', 'educational', 'founder', 'personal-story']);
const QUEUE_STATUSES = new Set([
  'draft',
  'needs_approval',
  'approved',
  'scheduled',
  'posted',
  'rejected',
]);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'to', 'the',
  'our', 'we', 'you', 'your', 'i', 'me', 'my', 'us',
  'am', 'are', 'be', 'was', 'were',
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'between', 'both', 'from',
  'have', 'having', 'into', 'just', 'more', 'most', 'over', 'than', 'that', 'their', 'there',
  'these', 'they', 'this', 'those', 'through', 'under', 'using', 'very', 'with', 'your',
  'will', 'what', 'when', 'where', 'which', 'while', 'were', 'them', 'then', 'does', 'did',
  'each', 'such', 'like', 'make', 'made', 'many', 'some', 'because', 'would', 'could', 'should',
  'into', 'been', 'only', 'ours', 'ourselves', 'hers', 'himself', 'herself', 'itself',
  'myself', 'ourselves', 'yourselves', 'themselves', 'linkedin', 'post', 'posts', 'content',
  'feature', 'features', 'user', 'users', 'every', 'plan', 'plans', 'genie', 'suitegenie',
  'linkedinstrategy', 'account', 'accounts', 'thread', 'threads', 'twitter', 'tweet', 'tweets',
  'published', 'edited', 'reposted', 'repost', 'posting', 'posted', 'hashtag', 'team', 'now', 'one',
  'competitor', 'competitors', 'profile', 'configured', 'yet', 'mapped', 'opportunity', 'analysis',
  'connected', 'current', 'angle', 'score', 'sharpen', 'gap', 'gaps',
  'build', 'built', 'agency', 'client', 'platform', 'workflow', 'analytic', 'social',
  'tool', 'tools', 'service', 'solution', 'product', 'creator',
  'add', 'unlock', 'precise', 'analysis', 'analyses', 'analyzing'
  , 'didn', 'don', 'isn', 'aren', 'wasn', 'weren', 'hasn', 'haven', 'hadn',
  'won', 'wouldn', 'couldn', 'shouldn', 'mustn', 'needn', 'shan',
  'properly'
]);
const SHORT_KEYWORD_ALLOWLIST = new Set(['ai', 'ux', 'ui', 'seo', 'b2b', 'b2c', 'api']);
const KEYWORD_CANONICAL_MAP = new Map([
  ['softwareengineering', 'software engineering'],
  ['socialmedia', 'social media'],
  ['machinelearning', 'machine learning'],
  ['webdevelopment', 'web development'],
  ['mobiledevelopment', 'mobile development'],
  ['cloudcomputing', 'cloud computing'],
  ['websecurity', 'web security'],
  ['cicd', 'ci/cd'],
  ['datascience', 'data science'],
  ['devop', 'devops'],
]);
const QUEUE_SUGGESTED_TIMES = ['09:30', '18:30'];
const GENERIC_QUEUE_PATTERNS = [
  /insight for (your|the) audience/i,
  /most people overlook/i,
  /comment ["']template["']/i,
  /practical move they can apply this week/i,
  /double down on/i,
  /improve results/i,
];
const LOW_SIGNAL_KEYWORDS = new Set([
  'share',
  'journey',
  'building',
  'properly',
  'thing',
  'things',
  'week',
  'news',
  'update',
  'today',
  'right',
  'working',
  'looked',
  'users',
  'feedback',
  'from',
  'with',
  'that',
  'this',
  'just',
  'more',
  'soon',
  'post',
  'posts',
  'platform',
  'tool',
  'tools',
]);
const PROJECT_SIGNAL_BLACKLIST = new Set([
  'linkedin',
  'portfolio',
  'resume',
  'professional experience',
  'experience',
  'skills',
  'professional',
  'personal growth',
  'automation businesses',
]);
const TECHNOLOGY_SIGNAL_ALLOWLIST = new Set([
  'react',
  'react.js',
  'node',
  'node.js',
  'express',
  'express.js',
  'aws',
  'docker',
  'kubernetes',
  'jenkins',
  'postgres',
  'postgresql',
  'supabase',
  'redis',
  'devops',
  'ci/cd',
  'cloud',
  'cloud computing',
  'cybersecurity',
  'pentesting',
  'web security',
  'seo',
  'typescript',
  'javascript',
  'html',
  'css',
  'api',
  'automation',
]);

const SETUP_QUESTIONS = [
  'What do you do? (role + niche)',
  'Who are you trying to reach?',
  'What outcomes do you want from LinkedIn in 30-90 days?',
  'What proof points should AI use? (wins/case studies/experience)',
  'Preferred tone? (professional, educational, founder, personal-story)',
];

const COMPETITOR_QUESTIONS = [
  'Add 1-5 competitor profiles',
  'Optional: add specific posts to benchmark',
  'What angle do you want to win on? (authority, clarity, originality, consistency)',
];

const CONSENT_CHECKLIST = [
  'Use my stored LinkedIn posts/metrics for analysis',
  'Store my profile context to improve generation',
];
const STRATEGY_ANALYSIS_VERBOSE = String(process.env.STRATEGY_ANALYSIS_VERBOSE || 'true').toLowerCase() !== 'false';
const STRATEGY_ANALYSIS_FETCH_DUMP =
  String(process.env.STRATEGY_ANALYSIS_FETCH_DUMP || 'true').toLowerCase() !== 'false';
const STRATEGY_LINKEDIN_API_FALLBACK =
  String(process.env.STRATEGY_LINKEDIN_API_FALLBACK || 'true').toLowerCase() !== 'false';
const STRATEGY_LINKEDIN_ROLLING_VERSION =
  String(process.env.STRATEGY_LINKEDIN_ROLLING_VERSION || 'true').toLowerCase() !== 'false';
const REJECTED_LINKEDIN_VERSIONS = new Set();

class AutomationError extends Error {
  constructor(message, statusCode = 400, code = 'AUTOMATION_ERROR') {
    super(message);
    this.name = 'AutomationError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const sanitizeUnicodeString = (value = '') => {
  const input = String(value ?? '');
  if (!input) return '';

  let output = '';
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);

    // Keep only valid surrogate pairs; drop lone high/low surrogates.
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = input.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    output += input[index];
  }

  return output;
};

const toShortText = (value, max = MAX_TEXT_FIELD_LENGTH) => {
  if (value === undefined || value === null) return '';
  const normalized = sanitizeUnicodeString(String(value)).trim();
  if (!normalized) return '';
  if (!Number.isFinite(max) || max <= 0) return normalized;
  // Slice then sanitize again in case the slice boundary splits a surrogate pair.
  return sanitizeUnicodeString(normalized.slice(0, max));
};

const safeJsonStringify = (value, fallback = '{}') => {
  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => (
      typeof currentValue === 'string' ? sanitizeUnicodeString(currentValue) : currentValue
    ));
    return serialized === undefined ? fallback : serialized;
  } catch {
    return fallback;
  }
};

const trimPromptForProvider = (prompt = '', max = MAX_STRATEGY_PROMPT_LENGTH) => {
  const normalized = sanitizeUnicodeString(String(prompt || ''));
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 200 ? Math.floor(max) : MAX_STRATEGY_PROMPT_LENGTH;
  if (normalized.length <= safeMax) return normalized;

  const tailNote = '\n\n[Context trimmed for provider length limit]';
  const allowed = Math.max(0, safeMax - tailNote.length);
  return `${normalized.slice(0, allowed)}${tailNote}`;
};

const previewText = (value, max = 180) => {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 180;
  const normalized = toShortText(value, safeMax + 1);
  if (!normalized) return '';
  if (normalized.length > safeMax) return `${normalized.slice(0, safeMax)}...`;
  return normalized;
};

const previewPostRows = (rows = [], max = 3) => {
  const safeRows = Array.isArray(rows) ? rows.slice(0, Math.max(1, max)) : [];
  return safeRows.map((row) => ({
    id: row?.id || null,
    account_id: row?.account_id || null,
    company_id: row?.company_id || null,
    linkedin_user_id: row?.linkedin_user_id || null,
    created_at: row?.created_at || null,
    status: row?.status || null,
    snippet: previewText(row?.post_content || '', 140),
  }));
};

const normalizeTone = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ALLOWED_TONES.has(normalized) ? normalized : DEFAULT_TONE;
};

const parseJsonObject = (value, fallback = {}) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...fallback, ...value };
  }
  if (typeof value === 'string' && value.trim()) {
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

const dedupeStrings = (items = []) => {
  const seen = new Set();
  const result = [];

  for (const value of items) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const logAnalysis = (...args) => {
  if (!STRATEGY_ANALYSIS_VERBOSE) return;
  console.log('[StrategyAnalysis]', ...args);
};

const warnAnalysis = (...args) => {
  if (!STRATEGY_ANALYSIS_VERBOSE) return;
  console.warn('[StrategyAnalysis]', ...args);
};

const sanitizeForFetchDump = (value, depth = 0) => {
  if (depth > 4) return '[truncated]';
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return sanitizeUnicodeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeForFetchDump(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 40);
    const next = {};
    const secretFieldPattern = /(token|secret|password|authorization|cookie)/i;
    for (const [key, currentValue] of entries) {
      if (secretFieldPattern.test(String(key))) {
        next[key] = '[redacted]';
        continue;
      }
      next[key] = sanitizeForFetchDump(currentValue, depth + 1);
    }
    return next;
  }
  return String(value);
};

const logFetchDump = (label, payload) => {
  if (!STRATEGY_ANALYSIS_VERBOSE || !STRATEGY_ANALYSIS_FETCH_DUMP) return;
  console.log('[StrategyFetch]', label, sanitizeForFetchDump(payload));
};

const normalizeLinkedInVersion = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(0, 6);
  return null;
};

const hasConfiguredLinkedInVersion = () =>
  Boolean(normalizeLinkedInVersion(process.env.LINKEDIN_API_VERSION)) ||
  Boolean(normalizeLinkedInVersion(process.env.LINKEDIN_VERSION)) ||
  STRATEGY_LINKEDIN_ROLLING_VERSION;

const buildLinkedInVersionCandidates = () => {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value) => {
    if (value === null) {
      if (seen.has('__none__')) return;
      seen.add('__none__');
      candidates.push(null);
      return;
    }
    const normalized = normalizeLinkedInVersion(value);
    if (!normalized || seen.has(normalized)) return;
    if (REJECTED_LINKEDIN_VERSIONS.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  pushCandidate(process.env.LINKEDIN_API_VERSION);
  pushCandidate(process.env.LINKEDIN_VERSION);

  if (STRATEGY_LINKEDIN_ROLLING_VERSION) {
    const now = DateTime.utc();
    pushCandidate(`${now.year}${String(now.month).padStart(2, '0')}`);
    for (let offset = 1; offset <= 3; offset += 1) {
      const previous = now.minus({ months: offset });
      pushCandidate(`${previous.year}${String(previous.month).padStart(2, '0')}`);
    }
  }

  // Final fallback: let LinkedIn choose default if possible.
  pushCandidate(null);

  return candidates;
};

const isNonexistentLinkedInVersionError = (error) => {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.response?.data?.code || '').toUpperCase();
  return status === 426 || code === 'NONEXISTENT_VERSION';
};

const linkedinGetWithVersionRetry = async ({ url, headers = {}, timeout = 15000, context = {} }) => {
  const candidates = buildLinkedInVersionCandidates();
  let lastError = null;

  for (const version of candidates) {
    const requestHeaders = { ...headers };
    if (version) requestHeaders['LinkedIn-Version'] = version;
    else delete requestHeaders['LinkedIn-Version'];

    try {
      return await axios.get(url, { headers: requestHeaders, timeout });
    } catch (error) {
      lastError = error;
      if (isNonexistentLinkedInVersionError(error)) {
        if (version) {
          REJECTED_LINKEDIN_VERSIONS.add(version);
        }
        warnAnalysis('LinkedIn version candidate rejected, retrying', {
          ...context,
          endpoint: url,
          attemptedVersion: version || 'none',
          status: error?.response?.status || null,
          code: error?.response?.data?.code || null,
          message: error?.response?.data?.message || error?.message || String(error),
        });
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('LinkedIn API request failed after version retries');
};

const normalizeLinkedInActorId = (rawId) => {
  const value = String(rawId || '').trim();
  if (!value) return null;
  if (value.startsWith('org:')) return value.slice(4) || null;
  if (value.startsWith('urn:li:organization:')) return value.slice('urn:li:organization:'.length) || null;
  if (value.startsWith('urn:li:person:')) return value.slice('urn:li:person:'.length) || null;
  return value;
};

const inferLinkedInAccountType = (row = {}) => {
  const metadata = parseJsonObject(row?.metadata, {});
  const fromMetadata = String(metadata?.account_type || '').trim().toLowerCase();
  if (fromMetadata === 'organization' || fromMetadata === 'personal') return fromMetadata;
  if (String(row?.account_id || '').trim().startsWith('org:')) return 'organization';
  return 'personal';
};

const LOW_SIGNAL_POST_TOKENS = new Set([
  'published', 'edited', 'post', 'posted', 'reposted', 'repost', 'article', 'update',
]);

const isLowSignalPostSnippet = (value = '') => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 4) return false;
  return tokens.every((token) => LOW_SIGNAL_POST_TOKENS.has(token));
};

const extractTextFromUnknownNode = (node) => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') {
    const text = node.trim();
    return isLowSignalPostSnippet(text) ? '' : text;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const text = extractTextFromUnknownNode(item);
      if (text) return text;
    }
    return '';
  }
  if (typeof node === 'object') {
    const directKeys = [
      'text',
      'commentary',
      'description',
      'summary',
      'title',
      'body',
      'message',
      'content',
      'shareCommentary',
    ];
    for (const key of directKeys) {
      if (!(key in node)) continue;
      const text = extractTextFromUnknownNode(node[key]);
      if (text) return text;
    }
    for (const value of Object.values(node)) {
      const text = extractTextFromUnknownNode(value);
      if (text) return text;
    }
  }
  return '';
};

const tryParseFollowerCount = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return 0;

  const directCandidates = [
    payload.firstDegreeSize,
    payload.followerCount,
    payload.count,
    payload.total,
    payload.totalFollowers,
  ];

  for (const candidate of directCandidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }

  const associationStats = Array.isArray(payload?.followerCountsByAssociationType)
    ? payload.followerCountsByAssociationType
    : [];
  for (const stat of associationStats) {
    const numeric = Number(stat?.followerCounts ?? stat?.count ?? stat?.followerCount);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }

  if (Array.isArray(payload.elements)) {
    for (const element of payload.elements) {
      const parsed = tryParseFollowerCount(element);
      if (parsed > 0) return parsed;
    }
  }

  return 0;
};

const extractOrganizationAboutText = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return '';
  const directCandidates = [
    payload.localizedDescription,
    payload.description,
    payload.tagline,
    payload.localizedTagline,
    payload.overview,
    payload.summary,
  ];
  for (const candidate of directCandidates) {
    const normalized = toShortText(candidate, 800);
    if (normalized) return normalized;
  }

  const nestedCandidates = [
    payload.description?.localized?.en_US,
    payload.description?.localized?.en_GB,
    payload.tagline?.localized?.en_US,
    payload.tagline?.localized?.en_GB,
    payload.overview?.localized?.en_US,
    payload.overview?.localized?.en_GB,
  ];
  for (const candidate of nestedCandidates) {
    const normalized = toShortText(candidate, 800);
    if (normalized) return normalized;
  }
  return '';
};

const extractSkillListFromPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return [];
  const rawContainers = [
    payload.skills,
    payload.skills?.values,
    payload.skills?.elements,
    payload.profile?.skills,
    payload.profile?.skills?.values,
    payload.profile?.skills?.elements,
  ];

  const flattened = [];
  for (const container of rawContainers) {
    if (!container) continue;
    if (Array.isArray(container)) {
      flattened.push(...container);
    } else if (typeof container === 'object') {
      flattened.push(container);
    } else if (typeof container === 'string') {
      flattened.push(...container.split(/[,\n/|]+/));
    }
  }

  const normalized = dedupeStrings(
    flattened
      .map((entry) => {
        if (typeof entry === 'string') return toShortText(entry, 60);
        if (!entry || typeof entry !== 'object') return '';
        return toShortText(
          entry.name ||
            entry.skill ||
            entry.localizedName ||
            entry.title ||
            extractTextFromUnknownNode(entry),
          60
        );
      })
      .filter(Boolean)
      .filter((value) => !/^(skills?|profile|about|experience)$/i.test(String(value).trim()))
      .slice(0, 30),
    20
  );

  return normalized;
};

const extractExperienceTextFromPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') return '';

  const positionArrays = [
    payload.positions?.values,
    payload.positions?.elements,
    payload.positionGroups?.elements,
    payload.experience?.positions,
    payload.experience,
    payload.workExperience,
  ].filter(Array.isArray);

  const snippets = [];
  for (const list of positionArrays) {
    for (const item of list.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      const title = toShortText(
        item.title || item.positionTitle || item.role || item.localizedTitle || '',
        120
      );
      const company = toShortText(
        item.companyName ||
          item.company ||
          item.organization ||
          item.employer ||
          item.company?.name ||
          '',
        120
      );
      const summary = toShortText(
        item.summary || item.description || item.localizedSummary || '',
        220
      );
      const line = [title, company].filter(Boolean).join(' @ ');
      if (line || summary) {
        snippets.push([line, summary].filter(Boolean).join(' - '));
      }
    }
  }

  if (snippets.length > 0) {
    return toShortText(dedupeStrings(snippets, 8).join('; '), 800);
  }

  const fallback = toShortText(
    payload.experienceSummary ||
      payload.workSummary ||
      payload.summary ||
      payload.localizedSummary ||
      '',
    800
  );
  return fallback;
};

const extractPersonalProfileInsights = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return { headline: '', about: '', skills: [], experience: '' };
  }

  const headline = toShortText(
    payload.localizedHeadline ||
      payload.headline ||
      payload.profile?.headline ||
      '',
    255
  );

  const about = toShortText(
    payload.localizedSummary ||
      payload.summary ||
      payload.about ||
      payload.biography ||
      payload.profile?.summary ||
      payload.profile?.about ||
      '',
    800
  );

  const skills = extractSkillListFromPayload(payload);
  const experience = extractExperienceTextFromPayload(payload);

  return { headline, about, skills, experience };
};

const normalizeCompetitorProfiles = (profiles = []) => {
  const normalized = [];

  for (const entry of profiles) {
    if (typeof entry === 'string') {
      const value = entry.trim();
      if (value) normalized.push(value.slice(0, 255));
      continue;
    }

    if (entry && typeof entry === 'object') {
      const source = String(entry.url || entry.handle || entry.profile || '').trim();
      if (source) normalized.push(source.slice(0, 255));
    }
  }

  return dedupeStrings(normalized).slice(0, MAX_COMPETITOR_PROFILES);
};

const normalizeCompetitorExamples = (examples = []) => {
  const normalized = [];

  for (const entry of examples) {
    if (typeof entry === 'string') {
      const value = entry.trim();
      if (value) normalized.push(value.slice(0, 800));
      continue;
    }

    if (entry && typeof entry === 'object') {
      const source = String(entry.url || entry.text || '').trim();
      if (source) normalized.push(source.slice(0, 800));
    }
  }

  return dedupeStrings(normalized).slice(0, MAX_COMPETITOR_EXAMPLES);
};

const parseAiJson = (rawContent = '') => {
  const text = String(rawContent || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const buildJsonRepairPrompt = ({
  queueTarget = DEFAULT_QUEUE_TARGET,
  rawOutput = '',
  profileContext = {},
  postSummary = {},
} = {}) => {
  const rawPreview = toShortText(rawOutput || '', 1200);
  const profilePreview = safeJsonStringify({
    role_niche: toShortText(profileContext?.role_niche, 120),
    target_audience: toShortText(profileContext?.target_audience, 120),
    outcomes_30_90: toShortText(profileContext?.outcomes_30_90, 140),
    proof_points: toShortText(profileContext?.proof_points, 180),
    tone_style: profileContext?.tone_style || DEFAULT_TONE,
  }, '{}');
  const postPreview = safeJsonStringify({
    themes: Array.isArray(postSummary?.themes) ? postSummary.themes.slice(0, 6) : [],
    postCount: Number(postSummary?.postCount || 0),
    averageEngagement: Number(postSummary?.averageEngagement || 0),
  }, '{}');

  return [
    'Your previous response was invalid or truncated.',
    'Return ONLY valid JSON object (no markdown).',
    'Required schema:',
    '{"analysis":{"strengths":[],"gaps":[],"opportunities":[],"nextAngles":[]},"queue":[{"title":"","content":"","hashtags":[],"reason":"","suggested_day_offset":0,"suggested_local_time":"HH:mm"}]}',
    `Generate exactly ${queueTarget} queue items.`,
    'Constraints: concise but concrete, LinkedIn-native, max 4 hashtags each.',
    'Do not use generic phrases (e.g., "most people overlook", "comment template").',
    'Do not repeat recent posted snippets; keep each item novel.',
    `Profile: ${profilePreview}`,
    `Post summary: ${postPreview}`,
    `Previous invalid output (repair intent only): ${rawPreview}`,
  ].join('\n');
};

const normalizeKeywordToken = (rawToken = '') => {
  let token = String(rawToken || '')
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (!token) return '';
  if (!SHORT_KEYWORD_ALLOWLIST.has(token) && token.length < 3) return '';
  if (/^\d+$/.test(token)) return '';

  if (token.endsWith('ies') && token.length > 5) token = `${token.slice(0, -3)}y`;
  else if (
    token.endsWith('s') &&
    !token.endsWith('ss') &&
    !token.endsWith('is') &&
    !token.endsWith('ops') &&
    !token.endsWith('ics') &&
    token.length > 4
  ) {
    token = token.slice(0, -1);
  }

  token = KEYWORD_CANONICAL_MAP.get(token) || token;

  if (!token || STOP_WORDS.has(token)) return '';
  if (token.length > 32) return '';
  return token;
};

const canonicalIdentityToken = (value = '') =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

const buildIdentityBlocklist = ({ profileContext = {}, accountSnapshot = {} } = {}) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const candidates = dedupeStrings([
    accountSnapshot?.display_name,
    accountSnapshot?.username,
    metadata?.profile_display_name,
    metadata?.portfolio_title,
    metadata?.portfolio_url,
    metadata?.organization_name,
  ]).filter(Boolean);

  const blocklist = new Set();
  for (const candidate of candidates) {
    const plain = toShortText(candidate, 180);
    if (!plain) continue;
    const fullToken = canonicalIdentityToken(plain);
    if (fullToken && fullToken.length >= 6) {
      blocklist.add(fullToken);
    }

    const words = plain
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const filteredWords = words.filter((word) => word.length >= 4 && !STOP_WORDS.has(word));
    for (const word of filteredWords) {
      const token = canonicalIdentityToken(word);
      if (token.length >= 4) blocklist.add(token);
    }

    const domainPart = plain
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .split('.')[0]
      .trim();
    const domainToken = canonicalIdentityToken(domainPart);
    if (domainToken && domainToken.length >= 6) {
      blocklist.add(domainToken);
    }
  }

  return blocklist;
};

const isIdentityLikeSignal = (value = '', identityBlocklist = new Set()) => {
  const token = canonicalIdentityToken(value);
  if (!token) return false;
  if (identityBlocklist?.has(token)) return true;
  return false;
};

const extractKeywords = (posts = []) => {
  const frequency = new Map();
  const safePosts = Array.isArray(posts) ? posts : [];

  for (const post of safePosts) {
    const rawText = String(post?.post_content || '');
    const hashtagMatches = rawText.match(/#([a-zA-Z0-9_]{2,40})/g) || [];
    for (const hashtag of hashtagMatches) {
      const normalized = normalizeKeywordToken(hashtag);
      if (!normalized) continue;
      if (LOW_SIGNAL_KEYWORDS.has(normalized)) continue;
      // Hashtags usually represent author intent, so give them higher weight.
      frequency.set(normalized, (frequency.get(normalized) || 0) + 3);
    }

    const text = rawText
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/www\.\S+/g, ' ')
      .replace(/[^a-z0-9\s#]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (const token of text) {
      const normalized = normalizeKeywordToken(token);
      if (!normalized) continue;
      if (LOW_SIGNAL_KEYWORDS.has(normalized)) continue;
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
    }
  }

  const minFrequency = safePosts.length >= 10 ? 2 : 1;
  let ranked = [...frequency.entries()].filter(([, count]) => count >= minFrequency);
  if (ranked.length === 0) ranked = [...frequency.entries()];

  return ranked
    .filter(([keyword, score]) => {
      if (!keyword) return false;
      if (LOW_SIGNAL_KEYWORDS.has(keyword)) return false;
      // Drop noisy single-hit keywords when there is enough signal elsewhere.
      if (score <= 1 && frequency.size > 10 && keyword.length <= 4) return false;
      return true;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([keyword]) => keyword);
};

const getQueueScheduleHint = (index = 0) => {
  const normalizedIndex = Math.max(0, Number(index) || 0);
  return {
    suggested_day_offset: Math.floor(normalizedIndex / QUEUE_SUGGESTED_TIMES.length),
    suggested_local_time: QUEUE_SUGGESTED_TIMES[normalizedIndex % QUEUE_SUGGESTED_TIMES.length] || '09:30',
  };
};

const buildHistoricalCorpus = (postSummary = {}) => dedupeStrings([
  ...(Array.isArray(postSummary?.recentPosts)
    ? postSummary.recentPosts.map((post) => toShortText(post?.snippet || post?.content || '', 240))
    : []),
  ...(Array.isArray(postSummary?.topPosts)
    ? postSummary.topPosts.map((post) => toShortText(post?.snippet || post?.content || '', 240))
    : []),
]).filter(Boolean).slice(0, 12);

const tokenizeForSimilarity = (value = '') => {
  const rawTokens = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/www\.\S+/g, ' ')
    .replace(/[^a-z0-9\s#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const normalized = [];
  for (const token of rawTokens) {
    const normalizedToken = normalizeKeywordToken(token);
    if (!normalizedToken) continue;
    normalized.push(normalizedToken);
  }

  return new Set(normalized);
};

const similarityScore = (left = '', right = '') => {
  const leftTokens = tokenizeForSimilarity(left);
  const rightTokens = tokenizeForSimilarity(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
};

const countConcreteSignals = (value = '') => {
  const text = String(value || '');
  if (!text.trim()) return 0;

  let score = 0;
  if (/\b\d+(\.\d+)?\s?(%|x|hrs?|hours?|days?|weeks?|users?|followers?|bugs?|tests?|posts?)\b/i.test(text)) score += 1;
  if (/\b(context|execution|result|baseline|change|outcome|checklist|playbook)\s*:/i.test(text)) score += 1;
  if (/\b(i|we)\s+(built|shipped|launched|deployed|automated|migrated|fixed|scaled|tested)\b/i.test(text)) score += 1;
  if (/\b(suitegenie|anicafe|sparklehood|fotographiya)\b/i.test(text)) score += 1;
  if (/\b(aws|docker|jenkins|react|node|seo|security|ci\/cd|kubernetes|supabase|postgres|automation|pipeline|cloud|devops|cybersecurity|pentesting)\b/i.test(text)) score += 1;
  return score;
};

const isGenericQueueContent = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return true;
  if (GENERIC_QUEUE_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const concreteSignals = countConcreteSignals(text);
  if (concreteSignals >= 2) return false;

  const tokenCount = tokenizeForSimilarity(text).size;
  return tokenCount < 10 || concreteSignals < 2;
};

const scoreQueueDraftQuality = (item = {}, historyCorpus = []) => {
  const content = toShortText(item?.content, 3000);
  const title = toShortText(item?.title, 220);
  const hashtags = normalizeHashtags(item?.hashtags);
  const reason = toShortText(item?.reason, 240);
  if (!content) return -1;

  const lengthScore = content.length >= 320 && content.length <= 1600 ? 2 : 0;
  const hashtagScore = hashtags.length > 0 ? 1 : 0;
  const reasonScore = reason ? 1 : 0;
  const specificityScore = isGenericQueueContent(content) ? -2 : 2;
  const concreteSignalScore = Math.min(3, countConcreteSignals(content));
  const similarityPenalty = historyCorpus.some((history) => similarityScore(content, history) >= 0.58) ? -3 : 0;
  const titleScore = title ? 1 : 0;

  return lengthScore + hashtagScore + reasonScore + specificityScore + concreteSignalScore + similarityPenalty + titleScore;
};

const normalizeProjectSignal = (value = '') => {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[|:]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!cleaned) return '';
  const compact = cleaned.slice(0, 64);
  const key = compact.toLowerCase();
  if (!key || PROJECT_SIGNAL_BLACKLIST.has(key)) return '';
  if (compact.length <= 2) return '';
  return compact;
};

const extractProjectSignalsFromText = (value = '') => {
  const text = toShortText(value, 2000);
  if (!text) return [];
  const found = [];

  const domainMatches = text.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]{1,30})\.(?:in|com|io|app|dev|me)\b/gi) || [];
  for (const match of domainMatches) {
    const base = String(match || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('.')[0]
      .replace(/-/g, ' ');
    const normalized = normalizeProjectSignal(base);
    if (normalized) found.push(normalized);
  }

  const actionPattern =
    /\b(?:building|built|launching|launched|shipping|shipped|founded|founder of|working on|maintaining)\s+([A-Za-z0-9][A-Za-z0-9.\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.\-]*){0,3})/gi;
  for (const match of text.matchAll(actionPattern)) {
    const normalized = normalizeProjectSignal(match?.[1] || '');
    if (normalized) found.push(normalized);
  }

  const explicitPattern = /\b(SuiteGenie|Anicafe|Sparklehood|Fotographiya)\b/gi;
  for (const match of text.matchAll(explicitPattern)) {
    const normalized = normalizeProjectSignal(match?.[1] || '');
    if (normalized) found.push(normalized);
  }

  return dedupeStrings(found).slice(0, 8);
};

const collectProjectSignals = ({
  profileContext = {},
  postSummary = {},
  accountSnapshot = {},
  identityBlocklist = new Set(),
} = {}) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const sources = [
    metadata.portfolio_title,
    metadata.portfolio_url,
    metadata.portfolio_about,
    metadata.portfolio_experience,
    metadata.linkedin_about,
    metadata.linkedin_experience,
    profileContext?.proof_points,
    profileContext?.outcomes_30_90,
    accountSnapshot?.about,
    accountSnapshot?.experience,
    ...(Array.isArray(postSummary?.recentPosts) ? postSummary.recentPosts.map((item) => item?.snippet || item?.content || '') : []),
    ...(Array.isArray(postSummary?.topPosts) ? postSummary.topPosts.map((item) => item?.snippet || item?.content || '') : []),
  ];

  const projects = [];
  for (const source of sources) {
    projects.push(...extractProjectSignalsFromText(source));
  }

  const normalized = dedupeStrings(projects.map((value) => normalizeProjectSignal(value)).filter(Boolean));
  return normalized
    .filter((value) => !PROJECT_SIGNAL_BLACKLIST.has(value.toLowerCase()))
    .filter((value) => !isIdentityLikeSignal(value, identityBlocklist))
    .slice(0, 8);
};

const collectTechnologySignals = ({ profileContext = {}, postSummary = {}, accountSnapshot = {} } = {}) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const pool = dedupeStrings([
    ...(Array.isArray(metadata.linkedin_skills) ? metadata.linkedin_skills : []),
    ...(Array.isArray(metadata.portfolio_skills) ? metadata.portfolio_skills : []),
    ...(Array.isArray(accountSnapshot?.skills) ? accountSnapshot.skills : []),
    ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
  ]);

  const normalized = [];
  for (const value of pool) {
    const candidate = String(value || '').trim();
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (!TECHNOLOGY_SIGNAL_ALLOWLIST.has(key)) continue;
    normalized.push(candidate);
  }

  return dedupeStrings(normalized).slice(0, 12);
};

const collectOutcomeSignals = ({ profileContext = {}, postSummary = {}, accountSnapshot = {} } = {}) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const pool = dedupeStrings([
    toShortText(profileContext?.proof_points, 220),
    toShortText(profileContext?.outcomes_30_90, 220),
    toShortText(metadata.extra_context, 220),
    toShortText(metadata.linkedin_experience, 220),
    toShortText(metadata.portfolio_experience, 220),
    toShortText(accountSnapshot?.about, 220),
    toShortText(accountSnapshot?.experience, 220),
    ...(Array.isArray(postSummary?.topPosts)
      ? postSummary.topPosts.map((item) => toShortText(item?.snippet || item?.content || '', 220))
      : []),
  ]).filter(Boolean);

  return pool.slice(0, 10);
};

const deriveFallbackThemes = ({
  profileContext = {},
  postSummary = {},
  accountSnapshot = {},
  projectSignals = [],
  technologySignals = [],
  identityBlocklist = new Set(),
} = {}) => {
  const themeCandidates = dedupeStrings([
    ...projectSignals,
    ...technologySignals,
    ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
    toShortText(profileContext?.role_niche, 120),
    toShortText(profileContext?.target_audience, 120),
  ]);

  const cleaned = [];
  for (const candidate of themeCandidates) {
    const normalizedKeyword = normalizeKeywordToken(candidate);
    if (normalizedKeyword && LOW_SIGNAL_KEYWORDS.has(normalizedKeyword)) continue;
    const value = toShortText(candidate, 80);
    if (!value) continue;
    if (PROJECT_SIGNAL_BLACKLIST.has(String(value).toLowerCase())) continue;
    if (isIdentityLikeSignal(value, identityBlocklist)) continue;
    cleaned.push(value);
  }

  const fallback = ['web development', 'cloud', 'devops', 'cybersecurity'];
  return dedupeStrings([...cleaned, ...fallback]).slice(0, 10);
};

const buildReferenceSignals = ({ profileContext = {}, competitorConfig = {}, postSummary = {}, accountSnapshot = {} } = {}) => {
  const metadata = parseJsonObject(profileContext?.metadata, {});
  const skillSignals = Array.isArray(metadata.linkedin_skills)
    ? metadata.linkedin_skills.slice(0, 10)
    : [];
  const portfolioSignals = Array.isArray(metadata.portfolio_skills)
    ? metadata.portfolio_skills.slice(0, 10)
    : [];
  const projectSignals = collectProjectSignals({ profileContext, postSummary, accountSnapshot });
  const outcomeSignals = collectOutcomeSignals({ profileContext, postSummary, accountSnapshot });

  return dedupeStrings([
    ...projectSignals,
    ...outcomeSignals,
    ...(Array.isArray(postSummary?.themes) ? postSummary.themes.slice(0, 10) : []),
    ...skillSignals,
    ...portfolioSignals,
    toShortText(metadata.linkedin_about, 140),
    toShortText(metadata.linkedin_experience, 180),
    toShortText(metadata.portfolio_about, 140),
    toShortText(metadata.portfolio_experience, 180),
    toShortText(profileContext?.proof_points, 180),
    toShortText(profileContext?.outcomes_30_90, 140),
    toShortText(accountSnapshot?.headline, 140),
    ...(Array.isArray(competitorConfig?.competitor_examples)
      ? competitorConfig.competitor_examples.map((example) => toShortText(example, 120))
      : []),
    ...(Array.isArray(competitorConfig?.competitor_profiles)
      ? competitorConfig.competitor_profiles.map((profile) => `reference:${profile}`)
      : []),
  ]).filter(Boolean).slice(0, 14);
};

const buildHighQualityFallbackItem = ({
  index = 0,
  theme = 'practical framework',
  profileContext = {},
  postSummary = {},
  referenceSignals = [],
  projectSignals = [],
  technologySignals = [],
  outcomeSignals = [],
  winAngle = 'authority',
  identityBlocklist = new Set(),
} = {}) => {
  const scheduleHint = getQueueScheduleHint(index);
  const audience = toShortText(profileContext?.target_audience || 'builders and operators', 120);
  const proofPoint = toShortText(profileContext?.proof_points || profileContext?.outcomes_30_90 || '', 180);
  const topPostSnippet = toShortText(postSummary?.topPosts?.[index % Math.max(1, (postSummary?.topPosts || []).length)]?.snippet || '', 160);
  const themeKeyword = normalizeKeywordToken(theme);
  const normalizedTheme = isIdentityLikeSignal(theme, identityBlocklist) ||
    (themeKeyword && LOW_SIGNAL_KEYWORDS.has(themeKeyword))
    ? ''
    : toShortText(theme, 72);
  const fallbackThemePool = ['web development', 'cloud', 'devops', 'cybersecurity'];
  const safeTheme = normalizedTheme ||
    toShortText(technologySignals[index % Math.max(1, technologySignals.length)] || '', 72) ||
    fallbackThemePool[index % fallbackThemePool.length];

  const rawProjectCue = toShortText(projectSignals[index % Math.max(1, projectSignals.length)] || '', 80);
  const projectCue = isIdentityLikeSignal(rawProjectCue, identityBlocklist)
    ? ''
    : rawProjectCue;
  const toolCue = toShortText(technologySignals[index % Math.max(1, technologySignals.length)] || '', 80);
  const outcomeCue = toShortText(outcomeSignals[index % Math.max(1, outcomeSignals.length)] || '', 180);
  const referenceCue = toShortText(referenceSignals[index % Math.max(1, referenceSignals.length)] || '', 120);
  const concreteCue = outcomeCue || proofPoint || topPostSnippet || referenceCue || toShortText(safeTheme, 100);
  const opening = projectCue
    ? `Build update from ${projectCue}: improving ${safeTheme}.`
    : `Build update: improving ${safeTheme} for ${audience}.`;
  const workflowCue = toolCue
    ? `Execution stack: ${toolCue}. I converted this into a repeatable workflow instead of a one-off fix.`
    : 'Execution: I converted this into a repeatable workflow that can be reused next sprint.';
  const resultLine = outcomeCue
    ? `Measured outcome: ${outcomeCue}.`
    : 'Measured outcome: include one real metric (time saved, reliability gain, or defect reduction).';

  const content = [
    opening,
    '',
    `Context signal: ${concreteCue}.`,
    workflowCue,
    resultLine,
    '',
    `For ${audience}, structure this as: trigger -> action -> measurable outcome -> next step.`,
    '',
    `Angle: ${toShortText(winAngle, 80)}. Close with a concrete 5-step checklist readers can apply today.`,
  ].join('\n');

  const hashtagPool = [
    safeTheme,
    toolCue,
    projectCue,
  ]
    .filter(Boolean)
    .map((item) => String(item || '').replace(/\s+/g, ''))
    .filter((item) => !isIdentityLikeSignal(item, identityBlocklist));

  return {
    title: `Execution playbook ${index + 1}: ${toShortText(safeTheme, 80)}`,
    content: toShortText(content, 2200),
    hashtags: normalizeHashtags(hashtagPool),
    suggested_day_offset: scheduleHint.suggested_day_offset,
    suggested_local_time: scheduleHint.suggested_local_time,
    reason: `Fallback generated with signal "${toShortText(projectCue || safeTheme, 80)}" and evidence "${toShortText(concreteCue, 120)}".`,
  };
};

const refineQueueDrafts = ({
  aiQueue = [],
  fallbackQueue = [],
  queueTarget = DEFAULT_QUEUE_TARGET,
  postSummary = {},
} = {}) => {
  const safeTarget = Math.max(1, Math.min(MAX_QUEUE_TARGET, Number(queueTarget) || DEFAULT_QUEUE_TARGET));
  const historyCorpus = buildHistoricalCorpus(postSummary);
  const accepted = [];

  const tryAccept = (rawItem = null, source = 'ai') => {
    if (!rawItem || typeof rawItem !== 'object') return false;

    const content = toShortText(rawItem.content, 3000);
    if (!content) return false;
    const title = toShortText(rawItem.title, 220);

    const score = scoreQueueDraftQuality(rawItem, historyCorpus);
    const tooSimilarToAccepted = accepted.some((item) => similarityScore(item.content, content) >= 0.62);
    const tooSimilarTitle = title
      ? accepted.some((item) => similarityScore(item.title || '', title) >= 0.7)
      : false;
    const generic = isGenericQueueContent(content);

    if (source === 'ai' && (score < 2 || tooSimilarToAccepted || tooSimilarTitle || generic)) {
      return false;
    }
    if (source === 'fallback' && (tooSimilarToAccepted || tooSimilarTitle || generic || score < 2)) {
      return false;
    }

    const scheduleHint = getQueueScheduleHint(accepted.length);
    accepted.push({
      title: title || `Draft ${accepted.length + 1}`,
      content,
      hashtags: normalizeHashtags(rawItem.hashtags),
      suggested_day_offset: scheduleHint.suggested_day_offset,
      suggested_local_time: scheduleHint.suggested_local_time,
      reason: toShortText(rawItem.reason || `Generated from ${source} pipeline.`, 400),
    });
    return true;
  };

  for (const item of Array.isArray(aiQueue) ? aiQueue : []) {
    if (accepted.length >= safeTarget) break;
    tryAccept(item, 'ai');
  }

  for (const item of Array.isArray(fallbackQueue) ? fallbackQueue : []) {
    if (accepted.length >= safeTarget) break;
    tryAccept(item, 'fallback');
  }

  let fallbackCursor = 0;
  const fallbackPool = Array.isArray(fallbackQueue) ? fallbackQueue : [];
  while (accepted.length < safeTarget && fallbackPool.length > 0 && fallbackCursor < safeTarget * 3) {
    const seed = fallbackPool[fallbackCursor % fallbackPool.length] || {};
    const seedContent = toShortText(seed.content, 3000);
    if (!seedContent || isGenericQueueContent(seedContent) || scoreQueueDraftQuality(seed, historyCorpus) < 1) {
      fallbackCursor += 1;
      continue;
    }

    const scheduleHint = getQueueScheduleHint(accepted.length);
    accepted.push({
      title: toShortText(seed.title, 220) || `Draft ${accepted.length + 1}`,
      content: seedContent,
      hashtags: normalizeHashtags(seed.hashtags),
      suggested_day_offset: scheduleHint.suggested_day_offset,
      suggested_local_time: scheduleHint.suggested_local_time,
      reason: toShortText(seed.reason || 'Fallback completion draft.', 400),
    });
    fallbackCursor += 1;
  }

  while (accepted.length < safeTarget) {
    const seed = fallbackPool[accepted.length % Math.max(1, fallbackPool.length)] || {};
    const scheduleHint = getQueueScheduleHint(accepted.length);
    const themeLabel = toShortText(seed.title || seed.reason || 'Execution playbook', 72);
    const emergencyContent = [
      `${themeLabel}: practical post blueprint.`,
      '',
      'Context: explain one real problem you faced this week.',
      'Execution: share the exact stack/workflow you used.',
      'Result: include one measurable signal and one tradeoff.',
      '',
      'Close with one step readers can run in under 30 minutes.',
    ].join('\n');

    accepted.push({
      title: themeLabel || `Draft ${accepted.length + 1}`,
      content: toShortText(emergencyContent, 2200),
      hashtags: normalizeHashtags(seed.hashtags),
      suggested_day_offset: scheduleHint.suggested_day_offset,
      suggested_local_time: scheduleHint.suggested_local_time,
      reason: toShortText(seed.reason || 'Fallback completion draft.', 400),
    });
  }

  return accepted.slice(0, safeTarget);
};

const inferTone = (profileContext = {}) => {
  const tone = normalizeTone(profileContext?.tone_style || DEFAULT_TONE);
  return tone;
};

const normalizeHashtags = (hashtags = []) =>
  dedupeStrings(
    Array.isArray(hashtags)
      ? hashtags.map((tag) => {
          const cleaned = String(tag || '').trim().replace(/\s+/g, '');
          if (!cleaned) return '';
          return cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
        })
      : []
  ).slice(0, 6);

const buildFallbackQueue = ({
  queueTarget,
  profileContext,
  postSummary,
  competitorConfig,
  accountSnapshot,
}) => {
  const safeTarget = Math.max(1, Math.min(MAX_QUEUE_TARGET, Number(queueTarget) || DEFAULT_QUEUE_TARGET));
  const identityBlocklist = buildIdentityBlocklist({ profileContext, accountSnapshot });
  const projectSignals = collectProjectSignals({
    profileContext,
    postSummary,
    accountSnapshot,
    identityBlocklist,
  });
  const technologySignals = collectTechnologySignals({ profileContext, postSummary, accountSnapshot });
  const outcomeSignals = collectOutcomeSignals({ profileContext, postSummary, accountSnapshot });
  const baseThemes = deriveFallbackThemes({
    profileContext,
    postSummary,
    accountSnapshot,
    projectSignals,
    technologySignals,
    identityBlocklist,
  });
  const winAngle = toShortText(competitorConfig?.win_angle || 'authority', 64);
  const referenceSignals = buildReferenceSignals({
    profileContext,
    competitorConfig,
    postSummary,
    accountSnapshot,
  });

  const drafts = [];
  for (let index = 0; index < safeTarget; index += 1) {
    const theme = baseThemes[index % baseThemes.length];
    drafts.push(
      buildHighQualityFallbackItem({
        index,
        theme,
        profileContext,
        postSummary,
        referenceSignals,
        projectSignals,
        technologySignals,
        outcomeSignals,
        winAngle,
        identityBlocklist,
      })
    );
  }

  return drafts;
};

const mergeHashtagsIntoContent = (content = '', hashtags = []) => {
  const base = String(content || '').trim();
  const normalizedHashtags = normalizeHashtags(hashtags);
  if (!normalizedHashtags.length) return base;

  const missing = normalizedHashtags.filter((tag) => !base.toLowerCase().includes(tag.toLowerCase()));
  if (!missing.length) return base;

  return `${base}\n\n${missing.join(' ')}`.trim();
};

const parseQueueItemsFromAi = (parsed, fallback) => {
  if (!parsed || typeof parsed !== 'object') return fallback;
  const rawQueue = Array.isArray(parsed.queue) ? parsed.queue : [];

  const normalized = rawQueue
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const content = toShortText(item.content, 3000);
      if (!content) return null;
      const offset = Number.isFinite(Number(item.suggested_day_offset))
        ? Math.max(0, Math.min(30, Number(item.suggested_day_offset)))
        : index;
      const localTime = /^\d{2}:\d{2}$/.test(String(item.suggested_local_time || '').trim())
        ? String(item.suggested_local_time).trim()
        : '09:00';
      return {
        title: toShortText(item.title, 220) || `Draft ${index + 1}`,
        content,
        hashtags: normalizeHashtags(item.hashtags),
        suggested_day_offset: offset,
        suggested_local_time: localTime,
        reason: toShortText(item.reason || item.why || '', 400),
      };
    })
    .filter(Boolean);

  return normalized.length > 0 ? normalized : fallback;
};

const normalizeAnalysis = (parsed, fallback) => {
  const analysis =
    parsed && typeof parsed === 'object' && parsed.analysis && typeof parsed.analysis === 'object'
      ? parsed.analysis
      : fallback;

  return {
    strengths: dedupeStrings(Array.isArray(analysis?.strengths) ? analysis.strengths : []).slice(0, 6),
    gaps: dedupeStrings(Array.isArray(analysis?.gaps) ? analysis.gaps : []).slice(0, 6),
    opportunities: dedupeStrings(Array.isArray(analysis?.opportunities) ? analysis.opportunities : []).slice(0, 6),
    nextAngles: dedupeStrings(Array.isArray(analysis?.nextAngles) ? analysis.nextAngles : []).slice(0, 6),
  };
};

class LinkedinAutomationService {
  async getProfileContextRow(userId) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_profile_context
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const row = rows[0] || null;
    logFetchDump('linkedin_automation_profile_context', {
      userId,
      rowCount: rows.length,
      rows,
    });
    logAnalysis('Fetched profile context row', {
      userId,
      found: Boolean(row),
      preview: row
        ? {
            tone_style: row.tone_style || null,
            consent_use_posts: Boolean(row.consent_use_posts),
            consent_store_profile: Boolean(row.consent_store_profile),
            role_niche: previewText(row.role_niche, 100) || null,
            target_audience: previewText(row.target_audience, 100) || null,
            outcomes_30_90: previewText(row.outcomes_30_90, 100) || null,
            metadataKeys: Object.keys(parseJsonObject(row.metadata, {})).slice(0, 10),
          }
        : null,
    });
    return row;
  }

  async getCompetitorRow(userId) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_competitors
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const row = rows[0] || null;
    logFetchDump('linkedin_automation_competitors', {
      userId,
      rowCount: rows.length,
      rows,
    });
    logAnalysis('Fetched competitor row', {
      userId,
      found: Boolean(row),
      competitorCount: Array.isArray(row?.competitor_profiles) ? row.competitor_profiles.length : 0,
      exampleCount: Array.isArray(row?.competitor_examples) ? row.competitor_examples.length : 0,
      winAngle: row?.win_angle || null,
      previewProfiles: Array.isArray(row?.competitor_profiles) ? row.competitor_profiles.slice(0, 3) : [],
      previewExamples: Array.isArray(row?.competitor_examples)
        ? row.competitor_examples.slice(0, 2).map((value) => previewText(value, 120))
        : [],
    });
    return row;
  }

  mapProfileContext(row) {
    const metadata = parseJsonObject(row?.metadata, {});
    return {
      role_niche: toShortText(row?.role_niche, MAX_TEXT_FIELD_LENGTH),
      target_audience: toShortText(row?.target_audience, MAX_TEXT_FIELD_LENGTH),
      outcomes_30_90: toShortText(row?.outcomes_30_90, MAX_TEXT_FIELD_LENGTH),
      proof_points: toShortText(row?.proof_points, MAX_TEXT_FIELD_LENGTH),
      tone_style: normalizeTone(row?.tone_style),
      consent_use_posts: Boolean(row?.consent_use_posts),
      consent_store_profile: Boolean(row?.consent_store_profile),
      consent_updated_at: row?.consent_updated_at ? new Date(row.consent_updated_at).toISOString() : null,
      last_manual_fetch_at: row?.last_manual_fetch_at ? new Date(row.last_manual_fetch_at).toISOString() : null,
      metadata,
    };
  }

  mapCompetitors(row) {
    return {
      competitor_profiles: normalizeCompetitorProfiles(
        Array.isArray(row?.competitor_profiles) ? row.competitor_profiles : []
      ),
      competitor_examples: normalizeCompetitorExamples(
        Array.isArray(row?.competitor_examples) ? row.competitor_examples : []
      ),
      win_angle: toShortText(row?.win_angle || 'authority', 64) || 'authority',
      metadata: parseJsonObject(row?.metadata, {}),
    };
  }

  async getProfileBundle(userId) {
    const [profileRow, competitorRow] = await Promise.all([
      this.getProfileContextRow(userId),
      this.getCompetitorRow(userId),
    ]);

    const profileContext = this.mapProfileContext(profileRow);
    const competitors = this.mapCompetitors(competitorRow);

    return {
      profileContext,
      competitors,
      setupQuestions: [...SETUP_QUESTIONS],
      competitorQuestions: [...COMPETITOR_QUESTIONS],
      consentChecklist: [...CONSENT_CHECKLIST],
    };
  }

  async upsertProfileContext(userId, payload = {}) {
    const current = this.mapProfileContext(await this.getProfileContextRow(userId));
    const next = {
      role_niche: toShortText(payload.role_niche ?? current.role_niche, MAX_TEXT_FIELD_LENGTH),
      target_audience: toShortText(payload.target_audience ?? current.target_audience, MAX_TEXT_FIELD_LENGTH),
      outcomes_30_90: toShortText(payload.outcomes_30_90 ?? current.outcomes_30_90, MAX_TEXT_FIELD_LENGTH),
      proof_points: toShortText(payload.proof_points ?? current.proof_points, MAX_TEXT_FIELD_LENGTH),
      tone_style: normalizeTone(payload.tone_style ?? current.tone_style),
      consent_use_posts: payload.consent_use_posts !== undefined
        ? Boolean(payload.consent_use_posts)
        : Boolean(current.consent_use_posts),
      consent_store_profile: payload.consent_store_profile !== undefined
        ? Boolean(payload.consent_store_profile)
        : Boolean(current.consent_store_profile),
      metadata:
        payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? payload.metadata
          : current.metadata,
    };

    if (payload.revoke_and_clear === true) {
      next.role_niche = '';
      next.target_audience = '';
      next.outcomes_30_90 = '';
      next.proof_points = '';
      next.tone_style = DEFAULT_TONE;
      next.consent_use_posts = false;
      next.consent_store_profile = false;
      next.metadata = {};
    }

    const nowIso = new Date().toISOString();
    await pool.query(
      `INSERT INTO linkedin_automation_profile_context (
         user_id, role_niche, target_audience, outcomes_30_90, proof_points,
         tone_style, consent_use_posts, consent_store_profile, consent_updated_at,
         metadata, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10::jsonb, NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         role_niche = EXCLUDED.role_niche,
         target_audience = EXCLUDED.target_audience,
         outcomes_30_90 = EXCLUDED.outcomes_30_90,
         proof_points = EXCLUDED.proof_points,
         tone_style = EXCLUDED.tone_style,
         consent_use_posts = EXCLUDED.consent_use_posts,
         consent_store_profile = EXCLUDED.consent_store_profile,
         consent_updated_at = EXCLUDED.consent_updated_at,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        userId,
        next.role_niche,
        next.target_audience,
        next.outcomes_30_90,
        next.proof_points,
        next.tone_style,
        next.consent_use_posts,
        next.consent_store_profile,
        nowIso,
        safeJsonStringify(next.metadata || {}, '{}'),
      ]
    );

    return this.getProfileBundle(userId);
  }

  async upsertCompetitors(userId, payload = {}) {
    const current = this.mapCompetitors(await this.getCompetitorRow(userId));
    const next = {
      competitor_profiles: normalizeCompetitorProfiles(
        payload.competitor_profiles ?? current.competitor_profiles
      ),
      competitor_examples: normalizeCompetitorExamples(
        payload.competitor_examples ?? current.competitor_examples
      ),
      win_angle: toShortText(payload.win_angle ?? current.win_angle, 64) || 'authority',
      metadata:
        payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
          ? payload.metadata
          : current.metadata,
    };

    if (next.competitor_profiles.length > MAX_COMPETITOR_PROFILES) {
      throw new AutomationError(
        `Competitor profiles are limited to ${MAX_COMPETITOR_PROFILES}.`,
        400,
        'COMPETITOR_LIMIT_EXCEEDED'
      );
    }

    await pool.query(
      `INSERT INTO linkedin_automation_competitors (
         user_id, competitor_profiles, competitor_examples, win_angle, metadata, updated_at
       ) VALUES ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         competitor_profiles = EXCLUDED.competitor_profiles,
         competitor_examples = EXCLUDED.competitor_examples,
         win_angle = EXCLUDED.win_angle,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        userId,
        safeJsonStringify(next.competitor_profiles, '[]'),
        safeJsonStringify(next.competitor_examples, '[]'),
        next.win_angle,
        safeJsonStringify(next.metadata || {}, '{}'),
      ]
    );

    return this.getProfileBundle(userId);
  }

  async markManualFetchCompleted(userId) {
    await pool.query(
      `UPDATE linkedin_automation_profile_context
       SET last_manual_fetch_at = NOW(),
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  }

  async getLinkedinAccountSnapshot(userId, options = {}) {
    const {
      accountId = null,
      accountType = null,
    } = options || {};

    try {
      if (accountId && String(accountType || '').toLowerCase() === 'team') {
        const teamAccount = await resolveTeamAccountForUser(userId, String(accountId));
        logFetchDump('resolveTeamAccountForUser(snapshot)', {
          userId,
          accountId,
          accountType,
          found: Boolean(teamAccount),
          teamAccount,
        });
        if (teamAccount) {
          const teamMetadata = parseJsonObject(teamAccount?.metadata, {});
          const teamHeadline = toShortText(
            teamMetadata.profile_headline ||
              teamAccount?.headline ||
              '',
            255
          );
          const teamAbout = toShortText(
            teamMetadata.profile_about ||
              teamMetadata.about ||
              teamMetadata.description ||
              teamMetadata.organization_description ||
              '',
            800
          );
          const snapshot = {
            display_name: toShortText(
              teamAccount?.linkedin_display_name ||
                teamAccount?.organization_name ||
                teamAccount?.account_display_name ||
                '',
              255
            ),
            username: toShortText(
              teamAccount?.linkedin_username ||
                teamAccount?.organization_id ||
                teamAccount?.linkedin_user_id ||
                '',
              255
            ),
            followers_count: Number.isFinite(Number(teamAccount?.followers_count))
              ? Number(teamAccount.followers_count)
              : (
                  Number.isFinite(Number(teamAccount?.connections_count))
                    ? Number(teamAccount.connections_count)
                    : 0
                ),
            headline: teamHeadline,
            about: teamAbout,
            skills: Array.isArray(teamMetadata?.profile_skills) ? dedupeStrings(teamMetadata.profile_skills, 20) : [],
            experience: toShortText(teamMetadata?.profile_experience || '', 800),
          };

          logAnalysis('Using team account snapshot for strategy analysis', {
            userId,
            accountId,
            accountType,
            displayName: snapshot.display_name || null,
            username: snapshot.username || null,
            followers: snapshot.followers_count || 0,
          });
          return snapshot;
        }

        warnAnalysis('Team account snapshot lookup failed; falling back to personal snapshot', {
          userId,
          accountId,
          accountType,
        });
      }

      const personalScopeAccountId =
        accountId && String(accountType || '').toLowerCase() !== 'team'
          ? String(accountId)
          : null;

      const { rows } = await pool.query(
        `SELECT account_id, access_token, account_display_name, account_username, followers_count, metadata
         FROM social_connected_accounts
         WHERE user_id::text = $1::text
           AND platform = 'linkedin'
           AND team_id IS NULL
           ${personalScopeAccountId ? 'AND account_id = $2' : ''}
           AND is_active = true
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1`,
        personalScopeAccountId ? [userId, personalScopeAccountId] : [userId]
      );
      const account = rows[0] || null;
      logFetchDump('social_connected_accounts(snapshot)', {
        userId,
        accountId,
        accountType,
        personalScopeAccountId,
        rowCount: rows.length,
        rows,
      });
      logAnalysis('Fetched social_connected_accounts snapshot row', {
        userId,
        accountId,
        accountType,
        personalScopeAccountId,
        rowCount: rows.length,
        rowPreview: account
          ? {
              account_id: account.account_id || null,
              account_display_name: previewText(account.account_display_name, 80) || null,
              account_username: account.account_username || null,
              followers_count: Number.isFinite(Number(account.followers_count))
                ? Number(account.followers_count)
                : null,
              metadataKeys: Object.keys(parseJsonObject(account.metadata, {})).slice(0, 10),
            }
          : null,
      });
      const metadata = parseJsonObject(account?.metadata, {});
      let headline = toShortText(metadata.headline || metadata.profile_headline || '', 255);

      if (!headline) {
        const { rows: legacyRows } = await pool.query(
          `SELECT linkedin_display_name, linkedin_username, connections_count, headline
           FROM linkedin_auth
           WHERE user_id = $1
           ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
           LIMIT 1`,
          [userId]
        );
        const legacy = legacyRows[0] || null;
        logFetchDump('linkedin_auth(snapshot_fallback)', {
          userId,
          accountId,
          accountType,
          rowCount: legacyRows.length,
          rows: legacyRows,
        });
        logAnalysis('Fetched linkedin_auth fallback row for snapshot', {
          userId,
          accountId,
          accountType,
          rowCount: legacyRows.length,
          rowPreview: legacy
            ? {
                linkedin_display_name: previewText(legacy.linkedin_display_name, 80) || null,
                linkedin_username: legacy.linkedin_username || null,
                connections_count: Number.isFinite(Number(legacy.connections_count))
                  ? Number(legacy.connections_count)
                  : null,
                headline: previewText(legacy.headline, 80) || null,
              }
            : null,
        });
        if (!account && legacy) {
          return {
            display_name: toShortText(legacy.linkedin_display_name, 255),
            username: toShortText(legacy.linkedin_username, 255),
            followers_count: Number.isFinite(Number(legacy.connections_count))
              ? Number(legacy.connections_count)
              : 0,
            headline: toShortText(legacy.headline || '', 255),
            about: '',
            skills: [],
            experience: '',
          };
        }
        if (!headline && legacy?.headline) {
          headline = toShortText(legacy.headline, 255);
        }
      }

      if (!account) {
        warnAnalysis('No social_connected_accounts snapshot row found', {
          userId,
          accountId,
          accountType,
        });
        return null;
      }

      const fallbackFollowers =
        Number.isFinite(Number(metadata?.followers_count))
          ? Number(metadata.followers_count)
          : (
              Number.isFinite(Number(metadata?.follower_count))
                ? Number(metadata.follower_count)
                : (
                    Number.isFinite(Number(metadata?.connections_count))
                      ? Number(metadata.connections_count)
                      : 0
                  )
            );

      const snapshot = {
        display_name: toShortText(account.account_display_name, 255),
        username: toShortText(account.account_username, 255),
        followers_count: Number.isFinite(Number(account.followers_count))
          ? Number(account.followers_count)
          : fallbackFollowers,
        headline,
        about: toShortText(
          metadata?.profile_about ||
            metadata?.linkedin_about ||
            metadata?.about ||
            metadata?.description ||
            metadata?.organization_description ||
            '',
          800
        ),
        skills: Array.isArray(metadata?.profile_skills)
          ? dedupeStrings(metadata.profile_skills, 20)
          : (
              Array.isArray(metadata?.linkedin_skills)
                ? dedupeStrings(metadata.linkedin_skills, 20)
                : []
            ),
        experience: toShortText(metadata?.profile_experience || metadata?.linkedin_experience || '', 800),
      };

      const inferredOrgId = normalizeLinkedInActorId(
        metadata?.organization_id ||
          account?.account_id
      );
      const explicitType = String(accountType || '').toLowerCase();
      const inferredType = inferLinkedInAccountType(account || {});
      const isOrganizationScope =
        explicitType === 'organization' ||
        String(accountId || '').startsWith('org:') ||
        inferredType === 'organization';

      if (!isOrganizationScope && account?.access_token) {
        const headers = {
          Authorization: `Bearer ${account.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        };
        const personalEndpoints = [
          'https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,localizedHeadline,headline,summary,localizedSummary,biography,skills,positions,vanityName)',
          'https://api.linkedin.com/v2/me',
        ];
        let personalDiscovered = {
          hasHeadline: Boolean(snapshot.headline),
          hasAbout: Boolean(snapshot.about),
          skillsCount: Array.isArray(snapshot.skills) ? snapshot.skills.length : 0,
          hasExperience: Boolean(snapshot.experience),
        };

        for (const endpoint of personalEndpoints) {
          const alreadyComplete =
            personalDiscovered.hasHeadline &&
            personalDiscovered.hasAbout &&
            personalDiscovered.skillsCount > 0 &&
            personalDiscovered.hasExperience;
          if (alreadyComplete) break;

          try {
            const response = await linkedinGetWithVersionRetry({
              url: endpoint,
              headers,
              timeout: 12000,
              context: {
                userId,
                accountId,
                requestType: 'personal_profile',
              },
            });
            const payload = response?.data || {};
            const insights = extractPersonalProfileInsights(payload);
            logFetchDump('linkedin_personal_profile.raw_payload', {
              userId,
              accountId,
              endpoint,
              payload,
            });
            logFetchDump('linkedin_personal_profile.insights', {
              userId,
              accountId,
              endpoint,
              insights,
            });

            if (!snapshot.headline && insights.headline) snapshot.headline = insights.headline;
            if (!snapshot.about && insights.about) snapshot.about = insights.about;
            if ((!Array.isArray(snapshot.skills) || snapshot.skills.length === 0) && insights.skills.length > 0) {
              snapshot.skills = insights.skills.slice(0, 20);
            }
            if (!snapshot.experience && insights.experience) snapshot.experience = insights.experience;

            personalDiscovered = {
              hasHeadline: Boolean(snapshot.headline),
              hasAbout: Boolean(snapshot.about),
              skillsCount: Array.isArray(snapshot.skills) ? snapshot.skills.length : 0,
              hasExperience: Boolean(snapshot.experience),
            };

            logAnalysis('Personal profile enrichment discovery', {
              userId,
              accountId,
              endpoint,
              hasHeadline: personalDiscovered.hasHeadline,
              hasAbout: personalDiscovered.hasAbout,
              skillsCount: personalDiscovered.skillsCount,
              hasExperience: personalDiscovered.hasExperience,
              aboutPreview: previewText(snapshot.about, 120),
              skillsPreview: Array.isArray(snapshot.skills) ? snapshot.skills.slice(0, 6) : [],
              experiencePreview: previewText(snapshot.experience, 120),
            });
          } catch (personalErr) {
            warnAnalysis('Personal profile endpoint failed', {
              userId,
              accountId,
              endpoint,
              status: personalErr?.response?.status || null,
              error: personalErr?.response?.data || personalErr?.message || String(personalErr),
            });
          }
        }
      }

      if (isOrganizationScope && snapshot.followers_count <= 0 && account?.access_token && inferredOrgId) {
        const headers = {
          Authorization: `Bearer ${account.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        };
        const orgUrn = `urn:li:organization:${inferredOrgId}`;
        const endpoints = [
          `https://api.linkedin.com/v2/networkSizes/${encodeURIComponent(orgUrn)}?edgeType=CompanyFollowedByMember`,
          `https://api.linkedin.com/v2/networkSizes/${orgUrn}?edgeType=CompanyFollowedByMember`,
          ...(hasConfiguredLinkedInVersion()
            ? [
                `https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(orgUrn)}?edgeType=CompanyFollowedByMember`,
                `https://api.linkedin.com/rest/networkSizes/${orgUrn}?edgeType=CompanyFollowedByMember`,
                `https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`,
              ]
            : []),
        ];

        for (const endpoint of endpoints) {
          try {
            const response = await linkedinGetWithVersionRetry({
              url: endpoint,
              headers,
              timeout: 12000,
              context: {
                userId,
                accountId,
                organizationId: inferredOrgId,
                requestType: 'org_followers',
              },
            });
            const parsed = tryParseFollowerCount(response?.data || {});
            if (parsed > 0) {
              snapshot.followers_count = parsed;
              logAnalysis('Organization follower count fetched via LinkedIn API', {
                userId,
                accountId,
                organizationId: inferredOrgId,
                followers: parsed,
                endpoint,
              });
              break;
            }
          } catch (followerErr) {
            warnAnalysis('Organization follower endpoint failed', {
              userId,
              accountId,
              organizationId: inferredOrgId,
              endpoint,
              status: followerErr?.response?.status || null,
              error: followerErr?.response?.data || followerErr?.message || String(followerErr),
            });
          }
        }
      }

      if (isOrganizationScope && !snapshot.about && account?.access_token && inferredOrgId) {
        const headers = {
          Authorization: `Bearer ${account.access_token}`,
          'X-Restli-Protocol-Version': '2.0.0',
        };
        const orgEndpoints = [
          `https://api.linkedin.com/v2/organizations/${encodeURIComponent(inferredOrgId)}`,
          ...(hasConfiguredLinkedInVersion()
            ? [`https://api.linkedin.com/rest/organizations/${encodeURIComponent(inferredOrgId)}`]
            : []),
        ];

        for (const endpoint of orgEndpoints) {
          try {
            const response = await linkedinGetWithVersionRetry({
              url: endpoint,
              headers,
              timeout: 12000,
              context: {
                userId,
                accountId,
                organizationId: inferredOrgId,
                requestType: 'org_profile',
              },
            });
            const parsedFollowers = tryParseFollowerCount(response?.data || {});
            if (parsedFollowers > 0 && snapshot.followers_count <= 0) {
              snapshot.followers_count = parsedFollowers;
              logAnalysis('Organization follower count derived from organization profile payload', {
                userId,
                accountId,
                organizationId: inferredOrgId,
                followers: parsedFollowers,
                endpoint,
              });
            }
            const aboutText = extractOrganizationAboutText(response?.data || {});
            if (aboutText) {
              snapshot.about = aboutText;
              logAnalysis('Organization profile/about fetched via LinkedIn API', {
                userId,
                accountId,
                organizationId: inferredOrgId,
                endpoint,
                aboutLength: aboutText.length,
              });
            }
            if (snapshot.about || snapshot.followers_count > 0) {
              break;
            }
          } catch (orgErr) {
            warnAnalysis('Organization profile endpoint failed', {
              userId,
              accountId,
              organizationId: inferredOrgId,
              endpoint,
              status: orgErr?.response?.status || null,
              error: orgErr?.response?.data || orgErr?.message || String(orgErr),
            });
          }
        }
      }

      logAnalysis('Using personal/org account snapshot for strategy analysis', {
        userId,
        accountId,
        accountType,
        displayName: snapshot.display_name || null,
        username: snapshot.username || null,
        followers: snapshot.followers_count || 0,
        hasAbout: Boolean(snapshot.about),
        skillsCount: Array.isArray(snapshot.skills) ? snapshot.skills.length : 0,
        hasExperience: Boolean(snapshot.experience),
      });
      return snapshot;
    } catch {
      warnAnalysis('Failed to fetch account snapshot for strategy analysis', {
        userId,
        accountId,
        accountType,
      });
      return null;
    }
  }

  async getLinkedInApiAuthContext(userId, options = {}) {
    const { accountId = null, accountType = null } = options || {};
    const normalizedType = String(accountType || '').trim().toLowerCase();
    logAnalysis('Resolving LinkedIn API auth context', {
      userId,
      accountId,
      accountType,
      normalizedType,
    });

    if (accountId && normalizedType === 'team') {
      const teamAccount = await resolveTeamAccountForUser(userId, String(accountId));
      logFetchDump('resolveTeamAccountForUser(api_auth)', {
        userId,
        accountId,
        accountType,
        found: Boolean(teamAccount),
        teamAccount,
      });
      if (!teamAccount?.access_token) {
        warnAnalysis('Team API auth context not found for requested account', {
          userId,
          accountId,
          accountType,
        });
        return null;
      }
      const isOrganization = String(teamAccount?.account_type || '').toLowerCase() === 'organization';
      const orgId = normalizeLinkedInActorId(
        teamAccount?.organization_id ||
          teamAccount?.account_id
      );
      const personId = normalizeLinkedInActorId(teamAccount?.linkedin_user_id);
      logAnalysis('Resolved team API auth context', {
        userId,
        accountId,
        accountType: isOrganization ? 'organization' : 'personal',
        organizationId: isOrganization ? orgId : null,
        linkedinUserId: isOrganization ? null : personId,
      });
      return {
        accessToken: teamAccount.access_token,
        accountType: isOrganization ? 'organization' : 'personal',
        organizationId: isOrganization ? orgId : null,
        linkedinUserId: isOrganization ? null : personId,
      };
    }

    const params = [String(userId)];
    let extraWhere = '';
    if (accountId) {
      extraWhere = ' AND account_id = $2';
      params.push(String(accountId));
    }

    const { rows } = await pool.query(
      `SELECT access_token, account_id, account_username, account_display_name, followers_count, metadata
       FROM social_connected_accounts
       WHERE user_id::text = $1::text
         AND platform = 'linkedin'
         AND team_id IS NULL
         AND is_active = true
         ${extraWhere}
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
      params
    );
    const row = rows[0] || null;
    logFetchDump('social_connected_accounts(api_auth)', {
      userId,
      accountId,
      accountType,
      rowCount: rows.length,
      rows,
    });
    if (row?.access_token) {
      const metadata = parseJsonObject(row?.metadata, {});
      const inferredType = inferLinkedInAccountType(row);
      const organizationId = normalizeLinkedInActorId(
        metadata?.organization_id ||
          (inferredType === 'organization' ? row.account_id : null)
      );
      const linkedinUserId = normalizeLinkedInActorId(
        metadata?.linkedin_user_id ||
          (inferredType === 'personal' ? row.account_id : null)
      );
      logAnalysis('Resolved personal/org API auth context from social_connected_accounts', {
        userId,
        accountId,
        accountType: inferredType,
        organizationId: inferredType === 'organization' ? organizationId : null,
        linkedinUserId: inferredType === 'personal' ? linkedinUserId : null,
        rowAccountId: row.account_id || null,
      });
      return {
        accessToken: row.access_token,
        accountType: inferredType,
        organizationId: inferredType === 'organization' ? organizationId : null,
        linkedinUserId: inferredType === 'personal' ? linkedinUserId : null,
      };
    }

    const { rows: legacyRows } = await pool.query(
      `SELECT access_token, linkedin_user_id, account_type, organization_id
       FROM linkedin_auth
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );
    const legacy = legacyRows[0] || null;
    logFetchDump('linkedin_auth(api_auth_fallback)', {
      userId,
      accountId,
      accountType,
      rowCount: legacyRows.length,
      rows: legacyRows,
    });
    if (!legacy?.access_token) {
      warnAnalysis('No LinkedIn API auth context found in social or legacy tables', {
        userId,
        accountId,
        accountType,
      });
      return null;
    }
    const inferredType = String(legacy?.account_type || '').trim().toLowerCase() === 'organization'
      ? 'organization'
      : 'personal';
    logAnalysis('Resolved API auth context from linkedin_auth fallback', {
      userId,
      accountId,
      accountType: inferredType,
      organizationId: inferredType === 'organization' ? normalizeLinkedInActorId(legacy.organization_id) : null,
      linkedinUserId: inferredType === 'personal' ? normalizeLinkedInActorId(legacy.linkedin_user_id) : null,
    });
    return {
      accessToken: legacy.access_token,
      accountType: inferredType,
      organizationId: inferredType === 'organization' ? normalizeLinkedInActorId(legacy.organization_id) : null,
      linkedinUserId: inferredType === 'personal' ? normalizeLinkedInActorId(legacy.linkedin_user_id) : null,
    };
  }

  async fetchRecentPostsFromLinkedInApi(userId, options = {}) {
    if (!STRATEGY_LINKEDIN_API_FALLBACK) return [];

    const safeLimit = Math.max(1, Math.min(MAX_POSTS_FOR_ANALYSIS, Number(options?.limit) || MAX_POSTS_FOR_ANALYSIS));
    const auth = await this.getLinkedInApiAuthContext(userId, options);
    if (!auth?.accessToken) {
      warnAnalysis('LinkedIn API fallback skipped: no auth context', {
        userId,
        accountId: options?.accountId || null,
        accountType: options?.accountType || null,
      });
      return [];
    }

    const preferredType = String(options?.accountType || auth.accountType || '').toLowerCase();
    const isOrganization = preferredType === 'organization' || (!!options?.accountId && String(options.accountId).startsWith('org:'));
    const authorId = isOrganization
      ? normalizeLinkedInActorId(options?.accountId || auth.organizationId)
      : normalizeLinkedInActorId(options?.accountId || auth.linkedinUserId);
    if (!authorId) {
      warnAnalysis('LinkedIn API fallback skipped: missing author id', {
        userId,
        accountId: options?.accountId || null,
        accountType: options?.accountType || null,
        resolvedAuthType: auth.accountType || null,
      });
      return [];
    }

    const authorUrn = isOrganization
      ? `urn:li:organization:${authorId}`
      : `urn:li:person:${authorId}`;

    logAnalysis('Attempting LinkedIn API fallback fetch', {
      userId,
      accountId: options?.accountId || null,
      accountType: options?.accountType || null,
      safeLimit,
      resolvedAccountType: isOrganization ? 'organization' : 'personal',
      authorUrn,
      endpointCount: hasConfiguredLinkedInVersion() ? 3 : 2,
    });

    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    };

    const endpoints = [
      `https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${encodeURIComponent(authorUrn)})&count=${safeLimit}&sortBy=LAST_MODIFIED`,
      `https://api.linkedin.com/v2/shares?q=owners&owners=List(${encodeURIComponent(authorUrn)})&count=${safeLimit}&sortBy=LAST_MODIFIED`,
      ...(hasConfiguredLinkedInVersion()
        ? [
            `https://api.linkedin.com/rest/posts?q=author&author=${encodeURIComponent(authorUrn)}&count=${safeLimit}&sortBy=LAST_MODIFIED`,
          ]
        : []),
    ];

    for (const url of endpoints) {
      try {
        logAnalysis('Calling LinkedIn API fallback endpoint', {
          userId,
          authorUrn,
          endpoint: url,
        });
        const response = await linkedinGetWithVersionRetry({
          url,
          headers,
          timeout: 15000,
          context: {
            userId,
            authorUrn,
            requestType: 'recent_posts',
          },
        });
        const payload = response?.data || {};
        const rawItems = Array.isArray(payload?.elements)
          ? payload.elements
          : Array.isArray(payload?.results)
            ? payload.results
            : Array.isArray(payload?.items)
              ? payload.items
              : [];
        logFetchDump('linkedin_api_recent_posts.raw_payload', {
          userId,
          authorUrn,
          endpoint: url,
          payload,
          rawItems,
        });

        logAnalysis('LinkedIn API fallback endpoint response received', {
          userId,
          authorUrn,
          endpoint: url,
          rawCount: rawItems.length,
          responseKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 12) : [],
        });

        const normalized = rawItems
          .map((item, idx) => {
            const content = toShortText(extractTextFromUnknownNode(item), 3000);
            if (!content) return null;
            const createdAtCandidate = Number(item?.createdAt || item?.created?.time || item?.lastModifiedAt || Date.now());
            const createdAt = Number.isFinite(createdAtCandidate)
              ? new Date(createdAtCandidate).toISOString()
              : new Date().toISOString();
            return {
              id: item?.id || item?.urn || `api-${idx + 1}`,
              post_content: content,
              created_at: createdAt,
              likes: 0,
              comments: 0,
              shares: 0,
            };
          })
          .filter(Boolean);
        logFetchDump('linkedin_api_recent_posts.normalized', {
          userId,
          authorUrn,
          endpoint: url,
          normalizedCount: normalized.length,
          normalized,
        });

        if (normalized.length > 0) {
          logAnalysis('LinkedIn API fallback succeeded', {
            userId,
            authorUrn,
            endpoint: url,
            count: normalized.length,
            preview: normalized.slice(0, 3).map((post) => ({
              id: post.id,
              created_at: post.created_at,
              snippet: previewText(post.post_content, 140),
            })),
          });
          return normalized;
        }
      } catch (error) {
        warnAnalysis('LinkedIn API fallback endpoint failed', {
          userId,
          authorUrn,
          endpoint: url,
          status: error?.response?.status || null,
          error: error?.response?.data || error?.message || String(error),
        });
      }
    }

    return [];
  }

  async getPostSummary(userId, options = {}) {
    const {
      limit = MAX_POSTS_FOR_ANALYSIS,
      accountId = null,
      accountType = null,
    } = options || {};
    const safeLimit = Math.max(1, Math.min(MAX_POSTS_FOR_ANALYSIS, Number(limit) || MAX_POSTS_FOR_ANALYSIS));

    let scopeClause = 'user_id = $1 AND status = \'posted\'';
    let scopeParams = [userId];
    let scopeDescription = 'all_user_posts';
    let scheduledScopeClause = 'user_id = $1';
    let scheduledScopeParams = [userId];
    let isTeamScope = false;

    if (accountId && String(accountType || '').toLowerCase() === 'team') {
      const teamAccount = await resolveTeamAccountForUser(userId, String(accountId));
      if (teamAccount) {
        isTeamScope = true;
        const normalizedAccountId = teamAccount?.id ? String(teamAccount.id) : null;
        const normalizedTeamId = teamAccount?.team_id ? String(teamAccount.team_id) : null;
        if (normalizedAccountId && normalizedTeamId) {
          // Team scope should not be restricted by current user_id because multiple members can post.
          scopeClause = `status = 'posted' AND (account_id::text = $1 OR company_id::text = $2)`;
          scopeParams = [normalizedAccountId, normalizedTeamId];
          scheduledScopeClause = `(account_id::text = $1 OR company_id::text = $2)`;
          scheduledScopeParams = [normalizedAccountId, normalizedTeamId];
          scopeDescription = `team_account(${normalizedAccountId})_or_team(${normalizedTeamId})`;
        } else if (normalizedAccountId) {
          scopeClause = `status = 'posted' AND account_id::text = $1`;
          scopeParams = [normalizedAccountId];
          scheduledScopeClause = `account_id::text = $1`;
          scheduledScopeParams = [normalizedAccountId];
          scopeDescription = `team_account(${normalizedAccountId})`;
        } else if (normalizedTeamId) {
          scopeClause = `status = 'posted' AND company_id::text = $1`;
          scopeParams = [normalizedTeamId];
          scheduledScopeClause = `company_id::text = $1`;
          scheduledScopeParams = [normalizedTeamId];
          scopeDescription = `team_company(${normalizedTeamId})`;
        }
      } else {
        warnAnalysis('Requested team account for strategy analysis not found; falling back to user scope', {
          userId,
          accountId,
          accountType,
        });
      }
    } else if (
      accountId &&
      (
        String(accountType || '').toLowerCase() === 'organization' ||
        String(accountId).startsWith('org:')
      )
    ) {
      const orgId = normalizeLinkedInActorId(accountId);
      if (orgId) {
        scopeClause += ` AND (company_id::text = $2 OR linkedin_user_id = $3 OR account_id::text = $4)`;
        scopeParams.push(orgId, orgId, String(accountId));
        scheduledScopeClause += ` AND (company_id::text = $2 OR account_id::text = $3)`;
        scheduledScopeParams.push(orgId, String(accountId));
        scopeDescription = `organization(${orgId})`;
      }
    } else if (accountId) {
      const actorId = normalizeLinkedInActorId(accountId);
      if (actorId) {
        scopeClause += ` AND (linkedin_user_id = $2 OR account_id::text = $3)`;
        scopeParams.push(actorId, String(accountId));
        // scheduled_linkedin_posts does not have linkedin_user_id, so only apply account_id when present.
        scheduledScopeClause += ` AND account_id::text = $2`;
        scheduledScopeParams.push(String(accountId));
        scopeDescription = `personal_actor(${actorId})`;
      }
    }

    logAnalysis('Fetching post summary', {
      userId,
      accountId,
      accountType,
      safeLimit,
      scopeDescription,
      scopeParamsPreview: scopeParams.map((value, idx) => (idx === 0 ? value : String(value))),
    });

    const { rows } = await pool.query(
      `SELECT id, post_content, views, likes, comments, shares, created_at, status, company_id, account_id, linkedin_user_id
       FROM linkedin_posts
       WHERE ${scopeClause}
       ORDER BY created_at DESC
       LIMIT $${scopeParams.length + 1}`,
      [...scopeParams, safeLimit]
    );
    logFetchDump('linkedin_posts(post_summary)', {
      userId,
      accountId,
      accountType,
      scopeDescription,
      scopeParams,
      rowCount: rows.length,
      rows,
    });

    const posts = Array.isArray(rows) ? rows : [];
    const postCount = posts.length;
    logAnalysis('Fetched linkedin_posts for strategy summary', {
      userId,
      accountId,
      accountType,
      scopeDescription,
      postCount,
      preview: previewPostRows(posts, 3),
    });
    if (!postCount) {
      const diagnostics = { total: 0, posted_total: 0, posted_personal: 0, posted_team: 0 };
      try {
        const { rows: diagnosticRows } = await pool.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'posted')::int AS posted_total,
             COUNT(*) FILTER (WHERE status = 'posted' AND (company_id IS NULL OR company_id::text = ''))::int AS posted_personal,
             COUNT(*) FILTER (WHERE status = 'posted' AND company_id IS NOT NULL AND company_id::text <> '')::int AS posted_team
           FROM linkedin_posts
           WHERE user_id = $1`,
          [userId]
        );
        const diagnostic = diagnosticRows[0] || diagnostics;
        diagnostics.total = Number(diagnostic.total || 0);
        diagnostics.posted_total = Number(diagnostic.posted_total || 0);
        diagnostics.posted_personal = Number(diagnostic.posted_personal || 0);
        diagnostics.posted_team = Number(diagnostic.posted_team || 0);

        const { rows: sampleRows } = await pool.query(
          `SELECT id, status, company_id, account_id, linkedin_user_id, created_at
           FROM linkedin_posts
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId]
        );
        logFetchDump('linkedin_posts(post_summary_diagnostics)', {
          userId,
          accountId,
          accountType,
          diagnostics,
          sampleRows,
        });

        warnAnalysis('No posts found for active strategy scope', {
          userId,
          accountId,
          accountType,
          isTeamScope,
          scopeDescription,
          diagnostics,
          recentRows: sampleRows,
        });
      } catch (diagError) {
        warnAnalysis('Failed to collect post-summary diagnostics', {
          userId,
          accountId,
          accountType,
          error: diagError?.message || diagError,
        });
      }

      // Fallback path: if historical posted rows are missing, use completed scheduled rows as signal.
      try {
        const { rows: scheduledRows } = await pool.query(
          `SELECT id,
                  post_content,
                  COALESCE(posted_at, created_at) AS created_at
           FROM scheduled_linkedin_posts
           WHERE ${scheduledScopeClause}
             AND status IN ('completed', 'posted')
           ORDER BY COALESCE(posted_at, created_at) DESC
           LIMIT $${scheduledScopeParams.length + 1}`,
          [...scheduledScopeParams, safeLimit]
        );
        logFetchDump('scheduled_linkedin_posts(post_summary_fallback)', {
          userId,
          accountId,
          accountType,
          isTeamScope,
          scopeDescription,
          scheduledScopeParams,
          rowCount: scheduledRows.length,
          rows: scheduledRows,
        });

        const scheduledPosts = Array.isArray(scheduledRows) ? scheduledRows : [];
        logAnalysis('Fetched scheduled_linkedin_posts for fallback summary', {
          userId,
          accountId,
          accountType,
          isTeamScope,
          scopeDescription,
          scheduledCount: scheduledPosts.length,
          preview: previewPostRows(
            scheduledPosts.map((post) => ({
              ...post,
              status: 'scheduled_fallback',
            })),
            3
          ),
        });
        if (scheduledPosts.length > 0) {
          const recentPosts = scheduledPosts.slice(0, 8).map((post) => ({
            id: post.id,
            snippet: toShortText(post.post_content, 220),
            engagement: 0,
          }));
          logAnalysis('Using scheduled_linkedin_posts fallback for strategy summary', {
            userId,
            accountId,
            accountType,
            isTeamScope,
            scopeDescription,
            scheduledCount: scheduledPosts.length,
          });

          return {
            postCount: scheduledPosts.length,
            themes: extractKeywords(scheduledPosts),
            averageEngagement: 0,
            topPosts: scheduledPosts.slice(0, 3).map((post) => ({
              id: post.id,
              snippet: toShortText(post.post_content, 220),
              engagement: 0,
              likes: 0,
              comments: 0,
              shares: 0,
            })),
            recentPosts,
            sourceScope: `${scopeDescription}:scheduled_fallback`,
          };
        }
      } catch (fallbackError) {
        warnAnalysis('Failed scheduled_linkedin_posts fallback lookup', {
          userId,
          accountId,
          accountType,
          isTeamScope,
          error: fallbackError?.message || fallbackError,
        });
      }

      // Last fallback: fetch recent posts from LinkedIn API directly.
      try {
        const apiPosts = await this.fetchRecentPostsFromLinkedInApi(userId, {
          limit: safeLimit,
          accountId,
          accountType,
        });
        if (apiPosts.length > 0) {
          const recentPosts = apiPosts.slice(0, 8).map((post) => ({
            id: post.id,
            snippet: toShortText(post.post_content, 220),
            engagement: 0,
          }));
          return {
            postCount: apiPosts.length,
            themes: extractKeywords(apiPosts),
            averageEngagement: 0,
            topPosts: apiPosts.slice(0, 3).map((post) => ({
              id: post.id,
              snippet: toShortText(post.post_content, 220),
              engagement: 0,
              likes: 0,
              comments: 0,
              shares: 0,
            })),
            recentPosts,
            sourceScope: `${scopeDescription}:linkedin_api_fallback`,
          };
        }
      } catch (apiFallbackError) {
        warnAnalysis('Failed LinkedIn API fallback lookup', {
          userId,
          accountId,
          accountType,
          error: apiFallbackError?.message || apiFallbackError,
        });
      }

      return {
        postCount: 0,
        themes: [],
        averageEngagement: 0,
        topPosts: [],
        recentPosts: [],
        sourceScope: scopeDescription,
      };
    }

    const engagementScores = posts.map((post) => {
      const likes = Number(post.likes || 0);
      const comments = Number(post.comments || 0);
      const shares = Number(post.shares || 0);
      return likes + comments + shares;
    });
    const avgEngagement =
      engagementScores.reduce((sum, score) => sum + score, 0) / Math.max(1, engagementScores.length);

    const topPosts = posts
      .map((post, index) => ({
        id: post.id,
        snippet: toShortText(post.post_content, 220),
        engagement: engagementScores[index],
        likes: Number(post.likes || 0),
        comments: Number(post.comments || 0),
        shares: Number(post.shares || 0),
      }))
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, 3);
    const recentPosts = posts
      .slice(0, 8)
      .map((post, index) => ({
        id: post.id,
        snippet: toShortText(post.post_content, 220),
        engagement: engagementScores[index] || 0,
      }));
    const extractedThemes = extractKeywords(posts);

    logAnalysis('Computed strategy post summary metrics', {
      userId,
      accountId,
      accountType,
      scopeDescription,
      postCount,
      averageEngagement: Number(avgEngagement.toFixed(2)),
      themes: extractedThemes.slice(0, 8),
      topPostsPreview: topPosts.map((post) => ({
        id: post.id,
        engagement: post.engagement,
        snippet: previewText(post.snippet, 120),
      })),
    });

    return {
      postCount,
      themes: extractedThemes,
      averageEngagement: Number(avgEngagement.toFixed(2)),
      topPosts,
      recentPosts,
      sourceScope: scopeDescription,
    };
  }

  buildHeuristicAnalysis({ profileContext, competitorConfig, postSummary, accountSnapshot }) {
    const strengths = [];
    const gaps = [];
    const opportunities = [];
    const nextAngles = [];

    if (postSummary.postCount >= 10) {
      strengths.push('Consistent posting history with enough signal for pattern detection.');
    } else {
      gaps.push('Limited posting history: expand consistency to improve confidence in recommendations.');
    }

    if (postSummary.themes.length > 0) {
      strengths.push(`Existing topical strength around: ${postSummary.themes.slice(0, 3).join(', ')}.`);
      opportunities.push(`Double down on high-signal themes: ${postSummary.themes.slice(0, 3).join(', ')}.`);
    } else {
      gaps.push('No clear recurring themes detected in recent posts.');
    }

    if (accountSnapshot?.followers_count > 0) {
      strengths.push(`Connected account audience size: ${accountSnapshot.followers_count} followers.`);
    }

    const competitorCount = competitorConfig.competitor_profiles.length;
    if (competitorCount === 0) {
      gaps.push('No competitor profiles configured yet.');
      opportunities.push('Add 3-5 competitors to unlock more precise gap analysis.');
    } else {
      strengths.push(`${competitorCount} competitor profiles configured for benchmark context.`);
      opportunities.push(`Position content to outperform ${competitorCount} tracked competitor profile(s).`);
    }

    if (competitorConfig.win_angle) {
      nextAngles.push(`Lead with ${competitorConfig.win_angle} as your differentiation axis.`);
    }
    if (profileContext.outcomes_30_90) {
      nextAngles.push(`Tie each post to this outcome: ${profileContext.outcomes_30_90}.`);
    }
    if (profileContext.proof_points) {
      nextAngles.push('Turn proof points into mini case-study posts and frameworks.');
    }
    if (postSummary.averageEngagement > 0) {
      nextAngles.push(`Current average engagement is ${postSummary.averageEngagement}; target progressive lift with stronger hooks.`);
    }

    return {
      strengths: dedupeStrings(strengths).slice(0, 6),
      gaps: dedupeStrings(gaps).slice(0, 6),
      opportunities: dedupeStrings(opportunities).slice(0, 6),
      nextAngles: dedupeStrings(nextAngles).slice(0, 6),
    };
  }

  buildRunPrompt({ queueTarget, profileContext, competitorConfig, postSummary, accountSnapshot, heuristicAnalysis }) {
    const profileMetadata = parseJsonObject(profileContext?.metadata, {});
    const accountSummary = accountSnapshot
      ? safeJsonStringify({
          display_name: toShortText(accountSnapshot.display_name, 120),
          username: toShortText(accountSnapshot.username, 120),
          followers_count: Number(accountSnapshot.followers_count || 0),
          headline: toShortText(accountSnapshot.headline, 180),
          about: toShortText(accountSnapshot.about, 260),
          skills: Array.isArray(accountSnapshot.skills) ? accountSnapshot.skills.slice(0, 12) : [],
          experience: toShortText(accountSnapshot.experience, 260),
        }, '{}')
      : '{}';
    const profileSummary = safeJsonStringify({
      role_niche: toShortText(profileContext.role_niche, 180),
      target_audience: toShortText(profileContext.target_audience, 180),
      outcomes_30_90: toShortText(profileContext.outcomes_30_90, 220),
      proof_points: toShortText(profileContext.proof_points, 260),
      tone_style: profileContext.tone_style,
      }, '{}');
    const deepContextSummary = safeJsonStringify({
      linkedin_about: toShortText(profileMetadata.linkedin_about, 220),
      linkedin_experience: toShortText(profileMetadata.linkedin_experience, 260),
      linkedin_skills: Array.isArray(profileMetadata.linkedin_skills)
        ? profileMetadata.linkedin_skills.slice(0, 12)
        : [],
      portfolio_title: toShortText(profileMetadata.portfolio_title, 140),
      portfolio_about: toShortText(profileMetadata.portfolio_about, 220),
      portfolio_experience: toShortText(profileMetadata.portfolio_experience, 260),
      portfolio_skills: Array.isArray(profileMetadata.portfolio_skills)
        ? profileMetadata.portfolio_skills.slice(0, 12)
        : [],
      extra_context: toShortText(profileMetadata.extra_context || profileMetadata.user_context, 260),
    }, '{}');
    const competitorSummary = safeJsonStringify({
      competitor_profiles: Array.isArray(competitorConfig.competitor_profiles)
        ? competitorConfig.competitor_profiles.slice(0, 5)
        : [],
      competitor_examples: Array.isArray(competitorConfig.competitor_examples)
        ? competitorConfig.competitor_examples.slice(0, 4).map((item) => toShortText(item, 120))
        : [],
      win_angle: toShortText(competitorConfig.win_angle, 80),
    }, '{}');
    const postSummaryPayload = safeJsonStringify({
      postCount: Number(postSummary?.postCount || 0),
      themes: Array.isArray(postSummary?.themes) ? postSummary.themes.slice(0, 8) : [],
      averageEngagement: Number(postSummary?.averageEngagement || 0),
      topPosts: Array.isArray(postSummary?.topPosts)
        ? postSummary.topPosts.slice(0, 2).map((post) => ({
            id: post?.id || null,
            engagement: Number(post?.engagement || 0),
            snippet: toShortText(post?.snippet || '', 140),
          }))
        : [],
    }, '{}');
    const recentPostCorpus = safeJsonStringify(
      Array.isArray(postSummary?.recentPosts)
        ? postSummary.recentPosts.slice(0, 6).map((post) => ({
            id: post?.id || null,
            engagement: Number(post?.engagement || 0),
            snippet: toShortText(post?.snippet || '', 160),
          }))
        : [],
      '[]'
    );
    const heuristicPayload = safeJsonStringify({
      strengths: Array.isArray(heuristicAnalysis?.strengths) ? heuristicAnalysis.strengths.slice(0, 4) : [],
      gaps: Array.isArray(heuristicAnalysis?.gaps) ? heuristicAnalysis.gaps.slice(0, 4) : [],
      opportunities: Array.isArray(heuristicAnalysis?.opportunities) ? heuristicAnalysis.opportunities.slice(0, 4) : [],
      nextAngles: Array.isArray(heuristicAnalysis?.nextAngles) ? heuristicAnalysis.nextAngles.slice(0, 4) : [],
    }, '{}');

    return [
      'Return ONLY JSON. No markdown.',
      'Output schema:',
      '{"analysis":{"strengths":[],"gaps":[],"opportunities":[],"nextAngles":[]},"queue":[{"title":"","content":"","hashtags":[],"reason":"","suggested_day_offset":0,"suggested_local_time":"HH:mm"}]}',
      `Generate exactly ${queueTarget} queue items.`,
      'Constraints:',
      '- LinkedIn-native style with concrete hooks.',
      '- Avoid generic filler; use proof-driven framing.',
      '- Keep each post between 350 and 900 characters.',
      '- Include at most 4 hashtags per item.',
      '- Every post must contain one concrete signal: metric, named tool, workflow, experiment, or first-hand observation.',
      '- If project/product names are present in context, reference them explicitly (do not replace with generic labels).',
      '- Do NOT repeat or paraphrase the recently posted content snippets.',
      '- Prefer timely, high-signal angles from references, competitor context, portfolio updates, and niche shifts.',
      '- Avoid cliches like "most people overlook..." and "if useful, comment template".',
      '- If queue size is small, prioritize depth and publish-readiness over coverage.',
      '',
      `Profile context: ${profileSummary}`,
      `Deep profile context: ${deepContextSummary}`,
      `Account snapshot: ${accountSummary}`,
      `User post summary: ${postSummaryPayload}`,
      `Recent posted corpus (avoid repeating): ${recentPostCorpus}`,
      `Competitor context: ${competitorSummary}`,
      `Heuristic baseline analysis: ${heuristicPayload}`,
    ].join('\n');
  }

  async assertConsentForRun(userId) {
    const profile = this.mapProfileContext(await this.getProfileContextRow(userId));
    if (!profile.consent_use_posts) {
      throw new AutomationError(
        'Consent required: enable "Use my stored LinkedIn posts/metrics for analysis".',
        403,
        'CONSENT_REQUIRED_USE_POSTS'
      );
    }
    if (!profile.consent_store_profile) {
      throw new AutomationError(
        'Consent required: enable "Store my profile context to improve generation".',
        403,
        'CONSENT_REQUIRED_STORE_PROFILE'
      );
    }
    return profile;
  }

  async runPipeline({
    userId,
    queueTarget = DEFAULT_QUEUE_TARGET,
    userToken = null,
    cookieHeader = null,
    accountId = null,
    accountType = null,
  }) {
    const safeQueueTarget = Math.max(1, Math.min(MAX_QUEUE_TARGET, Number(queueTarget) || DEFAULT_QUEUE_TARGET));
    logAnalysis('Run pipeline started', {
      userId,
      queueTarget: safeQueueTarget,
      accountId,
      accountType,
      hasUserToken: Boolean(userToken),
      hasCookieHeader: Boolean(cookieHeader),
    });
    const profileContext = await this.assertConsentForRun(userId);
    const competitorConfig = this.mapCompetitors(await this.getCompetitorRow(userId));
    logFetchDump('strategy_pipeline.inputs(profile_competitor)', {
      userId,
      accountId,
      accountType,
      profileContext,
      competitorConfig,
    });
    logAnalysis('Strategy pipeline input snapshot ready', {
      userId,
      accountId,
      accountType,
      profileContext: {
        role_niche: previewText(profileContext.role_niche, 120),
        target_audience: previewText(profileContext.target_audience, 120),
        outcomes_30_90: previewText(profileContext.outcomes_30_90, 120),
        proof_points: previewText(profileContext.proof_points, 120),
        tone_style: profileContext.tone_style,
        consent_use_posts: Boolean(profileContext.consent_use_posts),
        consent_store_profile: Boolean(profileContext.consent_store_profile),
      },
      competitorConfig: {
        competitor_profiles: Array.isArray(competitorConfig.competitor_profiles)
          ? competitorConfig.competitor_profiles.slice(0, 5)
          : [],
        competitor_examples_preview: Array.isArray(competitorConfig.competitor_examples)
          ? competitorConfig.competitor_examples.slice(0, 3).map((value) => previewText(value, 120))
          : [],
        win_angle: competitorConfig.win_angle || null,
      },
    });
    const [postSummary, accountSnapshot] = await Promise.all([
      this.getPostSummary(userId, { limit: MAX_POSTS_FOR_ANALYSIS, accountId, accountType }),
      this.getLinkedinAccountSnapshot(userId, { accountId, accountType }),
    ]);
    logFetchDump('strategy_pipeline.inputs(post_summary_snapshot)', {
      userId,
      accountId,
      accountType,
      postSummary,
      accountSnapshot,
    });
    logAnalysis('Post summary and account snapshot ready', {
      userId,
      postCount: postSummary?.postCount || 0,
      sourceScope: postSummary?.sourceScope || 'unknown',
      themeCount: Array.isArray(postSummary?.themes) ? postSummary.themes.length : 0,
      accountDisplayName: accountSnapshot?.display_name || null,
      followers: accountSnapshot?.followers_count || 0,
    });
    const heuristicAnalysis = this.buildHeuristicAnalysis({
      profileContext,
      competitorConfig,
      postSummary,
      accountSnapshot,
    });

    const fallbackQueue = buildFallbackQueue({
      queueTarget: safeQueueTarget,
      profileContext,
      postSummary,
      competitorConfig,
      accountSnapshot,
    });

    let aiRaw = null;
    let aiProvider = null;
    let parsed = null;
    try {
      const prompt = this.buildRunPrompt({
        queueTarget: safeQueueTarget,
        profileContext,
        competitorConfig,
        postSummary,
        accountSnapshot,
        heuristicAnalysis,
      });
      const providerPrompt = trimPromptForProvider(prompt, MAX_STRATEGY_PROMPT_LENGTH);
      logAnalysis('Dispatching strategy prompt to AI provider', {
        userId,
        accountId,
        accountType,
        promptLength: prompt.length,
        providerPromptLength: providerPrompt.length,
        wasTrimmedForProvider: providerPrompt.length < prompt.length,
        promptPreview: previewText(providerPrompt, 500),
      });
      const aiResult = await aiService.generateStrategyContent(
        providerPrompt,
        'professional',
        userToken,
        userId,
        cookieHeader
      );
      aiRaw = aiResult?.content || null;
      aiProvider = aiResult?.provider || null;
      parsed = parseAiJson(aiRaw || '');
      if (!parsed && aiRaw) {
        const repairPrompt = trimPromptForProvider(
          buildJsonRepairPrompt({
            queueTarget: safeQueueTarget,
            rawOutput: aiRaw,
            profileContext,
            postSummary,
          }),
          MAX_STRATEGY_PROMPT_LENGTH
        );
        logAnalysis('Primary AI output invalid JSON; requesting repair pass', {
          userId,
          accountId,
          accountType,
          provider: aiProvider,
          repairPromptLength: repairPrompt.length,
        });

        const repairedResult = await aiService.generateStrategyContent(
          repairPrompt,
          'professional',
          userToken,
          userId,
          cookieHeader
        );
        const repairedRaw = repairedResult?.content || '';
        const repairedParsed = parseAiJson(repairedRaw);
        if (repairedParsed) {
          aiRaw = repairedRaw;
          aiProvider = repairedResult?.provider || aiProvider;
          parsed = repairedParsed;
          logAnalysis('Repair pass produced valid strategy JSON', {
            userId,
            accountId,
            accountType,
            provider: aiProvider,
            rawLength: repairedRaw.length,
          });
        } else {
          warnAnalysis('Repair pass still returned invalid JSON', {
            userId,
            accountId,
            accountType,
            provider: repairedResult?.provider || aiProvider,
            rawLength: repairedRaw.length,
          });
        }
      }
      logFetchDump('strategy_pipeline.ai_response', {
        userId,
        accountId,
        accountType,
        provider: aiProvider,
        raw: aiRaw,
        parsed,
      });
      logAnalysis('AI strategy response received', {
        userId,
        accountId,
        accountType,
        provider: aiProvider,
        hasRaw: Boolean(aiRaw),
        rawLength: aiRaw ? String(aiRaw).length : 0,
        parsed: Boolean(parsed),
        rawPreview: previewText(aiRaw, 500),
      });
    } catch (aiError) {
      parsed = null;
      warnAnalysis('AI strategy generation failed, falling back to heuristic queue', {
        userId,
        accountId,
        accountType,
        error: aiError?.message || aiError,
      });
    }

    const aiQueue = parseQueueItemsFromAi(parsed, []);
    const normalizedQueue = refineQueueDrafts({
      aiQueue,
      fallbackQueue,
      queueTarget: safeQueueTarget,
      postSummary,
    });
    const normalizedAnalysis = normalizeAnalysis(parsed, heuristicAnalysis);
    logFetchDump('strategy_pipeline.normalized_output', {
      userId,
      accountId,
      accountType,
      normalizedQueue,
      normalizedAnalysis,
      usedAi: Boolean(parsed),
      aiProvider,
    });
    logAnalysis('Normalized strategy output prepared', {
      userId,
      accountId,
      accountType,
      normalizedQueueCount: normalizedQueue.length,
      queuePreview: normalizedQueue.slice(0, 3).map((item, index) => ({
        index: index + 1,
        title: previewText(item.title, 100),
        contentSnippet: previewText(item.content, 140),
        hashtags: normalizeHashtags(item.hashtags),
        reason: previewText(item.reason, 120),
      })),
      analysisPreview: {
        strengths: Array.isArray(normalizedAnalysis?.strengths) ? normalizedAnalysis.strengths.slice(0, 3) : [],
        gaps: Array.isArray(normalizedAnalysis?.gaps) ? normalizedAnalysis.gaps.slice(0, 3) : [],
        opportunities: Array.isArray(normalizedAnalysis?.opportunities) ? normalizedAnalysis.opportunities.slice(0, 3) : [],
        nextAngles: Array.isArray(normalizedAnalysis?.nextAngles) ? normalizedAnalysis.nextAngles.slice(0, 3) : [],
      },
    });
    const runId = crypto.randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO linkedin_automation_runs (
           id, user_id, status, queue_target, analysis_snapshot, metadata, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW(), NOW()
         )`,
        [
          runId,
          userId,
          'completed',
          safeQueueTarget,
          safeJsonStringify({
            profileContext,
            competitorConfig,
            postSummary,
            accountSnapshot,
            analysis: normalizedAnalysis,
          }, '{}'),
          safeJsonStringify({
            aiProvider,
            usedAi: Boolean(parsed),
          }, '{}'),
        ]
      );
      logAnalysis('Inserted linkedin_automation_runs row', {
        userId,
        runId,
        queueTarget: safeQueueTarget,
        usedAi: Boolean(parsed),
        aiProvider: aiProvider || null,
      });

      const insertedQueueItems = [];
      for (const item of normalizedQueue) {
        const { rows } = await client.query(
          `INSERT INTO linkedin_automation_queue (
             id, user_id, run_id, title, content, hashtags, status,
             analysis_snapshot, metadata, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6::jsonb, 'needs_approval',
             $7::jsonb, $8::jsonb, NOW(), NOW()
           )
           RETURNING *`,
          [
            crypto.randomUUID(),
            userId,
            runId,
            toShortText(item.title, 220),
            mergeHashtagsIntoContent(item.content, item.hashtags),
            safeJsonStringify(normalizeHashtags(item.hashtags), '[]'),
            safeJsonStringify(normalizedAnalysis, '{}'),
            safeJsonStringify({
              reason: toShortText(item.reason, 400),
              suggested_day_offset: Number(item.suggested_day_offset || 0),
              suggested_local_time: String(item.suggested_local_time || '09:00'),
              ai_provider: aiProvider,
            }, '{}'),
          ]
        );
        insertedQueueItems.push(rows[0]);
      }

      logAnalysis('Inserted linkedin_automation_queue rows', {
        userId,
        runId,
        insertedCount: insertedQueueItems.length,
        insertedIds: insertedQueueItems.slice(0, 10).map((row) => row?.id || null),
      });

      await client.query('COMMIT');
      logAnalysis('Strategy pipeline transaction committed', {
        userId,
        runId,
      });

      return {
        runId,
        analysis: normalizedAnalysis,
        queue: insertedQueueItems,
        usedAi: Boolean(parsed),
        provider: aiProvider,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listQueue(userId, { status = null, limit = 30, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const params = [userId];
    let where = 'WHERE user_id = $1';

    if (status) {
      const normalizedStatuses = dedupeStrings(String(status).split(','))
        .map((value) => value.toLowerCase())
        .filter((value) => QUEUE_STATUSES.has(value));
      if (normalizedStatuses.length > 0) {
        params.push(normalizedStatuses);
        where += ` AND status = ANY($${params.length}::text[])`;
      }
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_queue
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, safeLimit, safeOffset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM linkedin_automation_queue
       ${where}`,
      params
    );

    return {
      queue: rows,
      total: countRows[0]?.count || 0,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  async getQueueItem(userId, queueId) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_queue
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [queueId, userId]
    );
    return rows[0] || null;
  }

  async approveQueueItem(userId, queueId) {
    const { rows } = await pool.query(
      `UPDATE linkedin_automation_queue
       SET status = 'approved',
           rejection_reason = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status IN ('draft', 'needs_approval', 'rejected')
       RETURNING *`,
      [queueId, userId]
    );
    if (!rows[0]) {
      throw new AutomationError('Queue item not found or cannot be approved.', 404, 'QUEUE_ITEM_NOT_APPROVABLE');
    }
    return rows[0];
  }

  async rejectQueueItem(userId, queueId, reason = '') {
    const normalizedReason = toShortText(reason, 400);
    const { rows } = await pool.query(
      `UPDATE linkedin_automation_queue
       SET status = 'rejected',
           rejection_reason = $3,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
         AND status IN ('draft', 'needs_approval', 'approved')
       RETURNING *`,
      [queueId, userId, normalizedReason]
    );
    if (!rows[0]) {
      throw new AutomationError('Queue item not found or cannot be rejected.', 404, 'QUEUE_ITEM_NOT_REJECTABLE');
    }
    return rows[0];
  }

  async scheduleQueueItem(userId, queueId, { scheduled_time, timezone = 'UTC' } = {}) {
    const queueItem = await this.getQueueItem(userId, queueId);
    if (!queueItem) {
      throw new AutomationError('Queue item not found.', 404, 'QUEUE_ITEM_NOT_FOUND');
    }
    if (queueItem.status !== 'approved') {
      throw new AutomationError('Queue item must be approved before scheduling.', 400, 'QUEUE_ITEM_NOT_APPROVED');
    }

    const normalizedTimezone = toShortText(timezone || 'UTC', 100) || 'UTC';
    const sourceTime = toShortText(scheduled_time, 64);
    if (!sourceTime) {
      throw new AutomationError('scheduled_time is required for scheduling.', 400, 'SCHEDULE_TIME_REQUIRED');
    }

    const scheduledUtc = DateTime.fromISO(sourceTime, { zone: normalizedTimezone }).toUTC();
    if (!scheduledUtc.isValid) {
      throw new AutomationError('Invalid schedule time or timezone.', 400, 'INVALID_SCHEDULE_TIME');
    }
    if (scheduledUtc <= DateTime.utc().plus({ minutes: 1 })) {
      throw new AutomationError('Scheduled time must be in the future.', 400, 'SCHEDULE_TIME_PAST');
    }
    if (scheduledUtc > DateTime.utc().plus({ days: 15 })) {
      throw new AutomationError('Scheduling is limited to 15 days ahead.', 400, 'SCHEDULE_TIME_TOO_FAR');
    }

    const scheduledPost = await createScheduledPost({
      user_id: userId,
      post_content: queueItem.content,
      media_urls: [],
      post_type: 'single_post',
      company_id: null,
      scheduled_time: scheduledUtc.toISO(),
      timezone: normalizedTimezone,
      metadata: {
        automation: {
          source: 'linkedin_automation_queue',
          queueId: queueItem.id,
          runId: queueItem.run_id || null,
        },
      },
      status: 'scheduled',
    });

    const currentMetadata = parseJsonObject(queueItem.metadata, {});
    const { rows } = await pool.query(
      `UPDATE linkedin_automation_queue
       SET status = 'scheduled',
           metadata = $3::jsonb,
           updated_at = NOW()
       WHERE id = $1
         AND user_id = $2
       RETURNING *`,
      [
        queueId,
        userId,
        safeJsonStringify({
          ...currentMetadata,
          scheduled_post_id: scheduledPost?.id || null,
          scheduled_time_utc: scheduledUtc.toISO(),
          scheduled_timezone: normalizedTimezone,
        }, '{}'),
      ]
    );

    return {
      queueItem: rows[0],
      scheduledPost,
    };
  }
}

const linkedinAutomationService = new LinkedinAutomationService();

export { AutomationError, SETUP_QUESTIONS, COMPETITOR_QUESTIONS, CONSENT_CHECKLIST };
export default linkedinAutomationService;

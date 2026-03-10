import { pool } from '../config/database.js';
import aiService from './aiService.js';
import linkedinAutomationService from './linkedinAutomationService.js';
import axios from 'axios';

const ALLOWED_TONES = new Set(['professional', 'friendly', 'educational', 'founder', 'personal-story']);
const ALLOWED_OBJECTIVES = new Set(['engage', 'clarify', 'convert', 'support', 'network']);
const MAX_COMMENT_INBOX_POSTS = 30;
const MAX_COMMENT_INBOX_PER_POST = 20;
const MAX_COMMENT_INBOX_TOTAL = 120;
const MAX_REPLY_TEXT_LENGTH = 1200;

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

const stripMarkdownCodeFences = (value = '') =>
  String(value || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

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

const dedupeStrings = (items = [], max = 20) => {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = toShortText(item, 180);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

const parsePositiveInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
};

const normalizeLinkedInVersion = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length >= 6) return digits.slice(0, 6);
  return null;
};

const extractFirstNonEmpty = (...values) => {
  for (const value of values) {
    const clean = toShortText(value, 180);
    if (clean) return clean;
  }
  return '';
};

const extractCommentText = (item = {}) =>
  extractFirstNonEmpty(
    item?.message?.text,
    item?.commentary?.text,
    item?.text?.text,
    item?.text,
    item?.content?.message?.text,
    item?.content?.commentary?.text
  );

const extractCommenterName = (item = {}) =>
  extractFirstNonEmpty(
    item?.actorName,
    item?.author?.name,
    item?.owner?.name,
    item?.actor?.name,
    item?.actor?.localizedName,
    item?.actor?.localizedFirstName && item?.actor?.localizedLastName
      ? `${item.actor.localizedFirstName} ${item.actor.localizedLastName}`
      : ''
  );

const extractCommenterUrn = (item = {}) =>
  extractFirstNonEmpty(
    item?.actor,
    item?.owner,
    item?.author?.urn,
    item?.commenter?.urn
  );

const toLinkedInPostUrn = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('urn:li:')) return raw;
  if (/^\d+$/.test(raw)) return `urn:li:ugcPost:${raw}`;
  return raw;
};

const parseCommentUrn = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^urn:li:comment:\(([^,]+),([^)]+)\)$/i);
  if (!match) return null;
  return {
    commentUrn: raw,
    objectUrn: toShortText(match[1] || '', 180),
    commentId: toShortText(match[2] || '', 120),
  };
};

const buildCommentUrn = (objectUrn = '', commentId = '') => {
  const safeObjectUrn = toLinkedInPostUrn(objectUrn);
  const safeCommentId = toShortText(commentId, 120);
  if (!safeObjectUrn || !safeCommentId) return '';
  return `urn:li:comment:(${safeObjectUrn},${safeCommentId})`;
};

const normalizeSourceCommentTarget = ({ sourceCommentId = '', postUrn = '' } = {}) => {
  const raw = toShortText(sourceCommentId, 220);
  if (!raw) return { sourceCommentId: '', commentUrn: '', commentId: '' };

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  decoded = toShortText(decoded, 220);

  const parsedCommentUrn = parseCommentUrn(decoded);
  if (parsedCommentUrn) {
    return {
      sourceCommentId: parsedCommentUrn.commentUrn,
      commentUrn: parsedCommentUrn.commentUrn,
      commentId: parsedCommentUrn.commentId || '',
    };
  }

  const cleanPostUrn = toLinkedInPostUrn(postUrn);
  const numericCommentId = /^\d+$/.test(decoded) ? decoded : '';
  const derivedCommentUrn = numericCommentId && cleanPostUrn
    ? buildCommentUrn(cleanPostUrn, numericCommentId)
    : '';

  return {
    sourceCommentId: decoded,
    commentUrn: derivedCommentUrn,
    commentId: numericCommentId,
  };
};

const isNonexistentVersionError = (error) => {
  const status = Number(error?.response?.status || 0);
  const code = String(error?.response?.data?.code || '').trim().toUpperCase();
  return status === 426 || code === 'NONEXISTENT_VERSION';
};

const buildVersionCandidates = () => {
  const candidates = [];
  const seen = new Set();
  const pushValue = (value) => {
    if (value === null) {
      if (seen.has('__none__')) return;
      seen.add('__none__');
      candidates.push(null);
      return;
    }
    const normalized = normalizeLinkedInVersion(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  pushValue(process.env.LINKEDIN_API_VERSION);
  pushValue(process.env.LINKEDIN_VERSION);
  pushValue(null);
  return candidates;
};
const normalizeTone = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (ALLOWED_TONES.has(normalized)) return normalized;
  if (normalized.includes('friend')) return 'friendly';
  if (normalized.includes('educat')) return 'educational';
  if (normalized.includes('founder')) return 'founder';
  if (normalized.includes('story') || normalized.includes('personal')) return 'personal-story';
  return 'professional';
};

const normalizeObjective = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (ALLOWED_OBJECTIVES.has(normalized)) return normalized;
  if (normalized.includes('clarif')) return 'clarify';
  if (normalized.includes('support')) return 'support';
  if (normalized.includes('convert') || normalized.includes('lead')) return 'convert';
  if (normalized.includes('network')) return 'network';
  return 'engage';
};

const normalizeEvidenceRefs = (value = []) =>
  dedupeStrings(Array.isArray(value) ? value : [value], 8);

const isMissingTableError = (error = null) => {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist');
};

const isPlaceholderCommenterName = (value = '') => {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  return (
    normalized === 'linkedin member' ||
    normalized === 'member' ||
    normalized === 'unknown' ||
    normalized === 'user' ||
    normalized === 'anonymous' ||
    normalized === 'linkedin user'
  );
};

const normalizeCommenterName = (value = '') => {
  const clean = toShortText(value, 120);
  if (!clean) return '';
  return isPlaceholderCommenterName(clean) ? '' : clean;
};

const stripPlaceholderGreeting = (value = '') =>
  String(value || '')
    .replace(/^\s*(linkedin member|member|unknown|user|anonymous)\s*,\s*/i, '')
    .trim();

const pickFallbackAnchor = (evidenceAnchors = [], commentText = '') => {
  const commentWords = toShortText(commentText, 160)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((word) => word.length >= 4);

  const candidates = dedupeStrings(Array.isArray(evidenceAnchors) ? evidenceAnchors : [], 20)
    .map((item) => toShortText(item, 120))
    .filter((item) => {
      const lower = item.toLowerCase();
      if (!lower) return false;
      if (lower.startsWith('portfolio about:')) return false;
      if (lower.startsWith('portfolio skills:')) return false;
      if (lower.startsWith('portfolio experience:')) return false;
      if (lower.includes('nothing here was built for a resume')) return false;
      return true;
    });

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (commentWords.some((word) => lower.includes(word))) {
      return toShortText(candidate, 90);
    }
  }
  if (candidates.length > 0) return toShortText(candidates[0], 90);
  return 'your workflow';
};

const extractCommentSignal = (value = '') => {
  const text = toShortText(value, 160);
  if (!text) return '';
  const sentence = text.split(/[.!?]/).map((part) => part.trim()).find(Boolean) || text;
  return toShortText(sentence.replace(/"/g, ''), 90);
};

const extractBrandKeywords = (groundingContext = null) => {
  if (!groundingContext) return [];
  const raw = [
    groundingContext.strategySignals?.niche || '',
    groundingContext.profileContext?.role_niche || '',
    ...(Array.isArray(groundingContext.personaSignals?.projects)
      ? groundingContext.personaSignals.projects : []),
    ...(Array.isArray(groundingContext.strategySignals?.topics)
      ? groundingContext.strategySignals.topics : []),
  ];
  return raw
    .flatMap((value) => String(value || '').toLowerCase().split(/[^a-z0-9]+/))
    .filter((token) => token.length >= 4)
    .filter((token) => !['with', 'that', 'this', 'from', 'your', 'have', 'been', 'more'].includes(token));
};

const buildProductAnswerSeed = (grounding = {}) => {
  const parts = [];

  const niche = toShortText(grounding.strategySignals?.niche || '', 120);
  const audience = toShortText(grounding.strategySignals?.audience || '', 120);
  if (niche && audience) parts.push(`${niche} built for ${audience}`);
  else if (niche) parts.push(niche);

  const projects = Array.isArray(grounding.personaSignals?.projects)
    ? grounding.personaSignals.projects : [];
  if (projects.length > 0) parts.push(toShortText(projects[0], 160));

  const proofPoints = toShortText(grounding.profileContext?.proof_points || '', 200);
  if (proofPoints) parts.push(proofPoints);

  const outcomes = toShortText(grounding.profileContext?.outcomes_30_90 || '', 160);
  if (outcomes) parts.push(outcomes);

  const voiceSignals = Array.isArray(grounding.contextVaultSignals?.voice_signals)
    ? grounding.contextVaultSignals.voice_signals.slice(0, 2) : [];
  voiceSignals.forEach((signal) => {
    const cleaned = toShortText(signal, 120);
    if (cleaned) parts.push(cleaned);
  });

  if (parts.length === 0) return '';
  return dedupeStrings(parts, 6).join('. ').slice(0, 400);
};

const classifyCommentIntent = (value = '', groundingContext = null) => {
  const text = toShortText(value, 220);
  const words = text.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);
  const wordCount = words.length;
  const isQuestion =
    /\?/.test(text) ||
    /^(what|why|how|when|where|which|can|could|should|would|do|did|is|are)\b/i.test(text.trim());
  const isFirstMilestone =
    /\b(first|1st)\b/i.test(text) &&
    /\b(post|automated|automation|launch|launched|ship|shipped)\b/i.test(text);
  const isShortSupportive =
    wordCount > 0 &&
    wordCount <= 8 &&
    /\b(love|nice|great|awesome|amazing|good|solid|congrats|congratulations|first)\b/i.test(text);
  const brandKeywords = extractBrandKeywords(groundingContext);
  const lowerText = text.toLowerCase();
  const hasProductKeyword = brandKeywords.length > 0 &&
    brandKeywords.some((keyword) => lowerText.includes(keyword));
  const hasProductQuestionPattern =
    /\b(what|tell me|explain|describe|how does|what's|what is)\b/i.test(text) ||
    (isQuestion && wordCount <= 12);
  const isProductQuestion = hasProductKeyword && hasProductQuestionPattern;

  return {
    text,
    wordCount,
    isQuestion,
    isFirstMilestone,
    isShortSupportive,
    isProductQuestion,
  };
};

const deriveReplyStyle = (commentText = '', objective = 'engage', groundingContext = null) => {
  const intent = classifyCommentIntent(commentText, groundingContext);
  const normalizedObjective = normalizeObjective(objective);
  const avoidFollowUpQuestions =
    intent.isFirstMilestone || intent.isProductQuestion || (intent.isShortSupportive && !intent.isQuestion);

  let mode = 'acknowledge_and_add_value';
  if (intent.isProductQuestion) {
    mode = 'answer_product_question';
  } else if (avoidFollowUpQuestions) {
    mode = 'acknowledge_progress';
  } else if (intent.isQuestion || normalizedObjective === 'clarify') {
    mode = 'answer_then_optional_question';
  } else if (normalizedObjective === 'network') {
    mode = 'engage_with_optional_question';
  }

  return {
    ...intent,
    objective: normalizedObjective,
    mode,
    avoidFollowUpQuestions,
  };
};

const isGenericReply = (value = '') => {
  const text = stripPlaceholderGreeting(value);
  if (!text) return true;
  if (text.length < 20) return true;
  if (text.length > 450) return true;
  if (/^\s*(linkedin member|member|unknown|user|anonymous)\s*,/i.test(String(value || ''))) return true;
  if (/\b(great post|thanks for sharing|totally agree|nice one|well said)\b/i.test(text) && text.length < 90) return true;
  if (/\bfor a resume\b/i.test(text)) return true;
  return false;
};

const parseSuggestionsFromProvider = (content = '') => {
  const cleaned = stripMarkdownCodeFences(content);
  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  const suggestions = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  return suggestions
    .map((item) => ({
      reply: toShortText(stripPlaceholderGreeting(item?.reply || item?.text || ''), 460),
      rationale: toShortText(item?.rationale || item?.why || '', 220),
      evidenceRefs: normalizeEvidenceRefs(item?.evidence_refs || item?.evidenceRefs || []),
      confidence: toShortText(item?.confidence || 'medium', 20) || 'medium',
    }))
    .filter((item) => item.reply && !isGenericReply(item.reply));
};

const normalizePersistedSuggestions = (items = [], limit = 5) => {
  const safeLimit = Math.max(1, Math.min(5, Number(limit) || 3));
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      reply: toShortText(item?.reply || item?.text || '', 460),
      rationale: toShortText(item?.rationale || item?.why || '', 220),
      evidenceRefs: normalizeEvidenceRefs(item?.evidence_refs || item?.evidenceRefs || []),
      confidence: toShortText(item?.confidence || 'medium', 20) || 'medium',
      source: toShortText(item?.source || 'cached', 24) || 'cached',
    }))
    .filter((item) => item.reply && !isGenericReply(item.reply))
    .slice(0, safeLimit);
};

class CommentReplyAssistService {
  async linkedinPostWithVersionFallback({ url, accessToken, data = {}, timeout = 12000 } = {}) {
    const candidates = buildVersionCandidates();
    let lastError = null;

    for (const version of candidates) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json',
      };
      if (version) headers['LinkedIn-Version'] = version;

      try {
        return await axios.post(url, data, {
          headers,
          timeout,
        });
      } catch (error) {
        lastError = error;
        if (isNonexistentVersionError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('LinkedIn request failed');
  }

  async buildGroundingContext({ userId, strategyId = null, postId = null } = {}) {
    const [strategyRows, postRows, profileRow] = await Promise.all([
      strategyId
        ? pool.query(
            `SELECT *
             FROM user_strategies
             WHERE id = $1
               AND user_id = $2
             LIMIT 1`,
            [strategyId, userId]
          )
        : Promise.resolve({ rows: [] }),
      postId
        ? pool.query(
            `SELECT id, post_content, likes, comments, shares, views, created_at
             FROM linkedin_posts
             WHERE id = $1
               AND user_id = $2
             LIMIT 1`,
            [postId, userId]
          )
        : Promise.resolve({ rows: [] }),
      linkedinAutomationService.getProfileContextRow(userId),
    ]);

    const strategy = strategyRows.rows?.[0] || null;
    const post = postRows.rows?.[0] || null;
    const profileContext = linkedinAutomationService.mapProfileContext(profileRow);
    const strategyMetadata = parseJsonObject(strategy?.metadata, {});
    const personaVault = parseJsonObject(strategyMetadata.persona_vault, {});
    const personaSignals = parseJsonObject(personaVault.signals, {});
    const contextVault = parseJsonObject(strategyMetadata.context_vault, {});
    const profileMetadata = parseJsonObject(profileContext.metadata, {});

    const evidenceAnchors = dedupeStrings([
      ...(Array.isArray(personaSignals.proof_points) ? personaSignals.proof_points : []),
      ...(Array.isArray(personaSignals.skills) ? personaSignals.skills : []),
      ...(Array.isArray(personaSignals.projects) ? personaSignals.projects : []),
      ...(Array.isArray(personaSignals.topic_signals) ? personaSignals.topic_signals : []),
      ...(Array.isArray(contextVault.winning_topics) ? contextVault.winning_topics : []),
      ...(Array.isArray(contextVault.voice_signals) ? contextVault.voice_signals : []),
      profileContext.proof_points,
      profileContext.outcomes_30_90,
      profileMetadata.linkedin_about,
      profileMetadata.linkedin_experience,
      post?.post_content,
    ], 24);

    return {
      strategy,
      post,
      profileContext,
      evidenceAnchors,
      strategySignals: {
        niche: toShortText(strategy?.niche || profileContext?.role_niche || '', 140),
        audience: toShortText(strategy?.target_audience || profileContext?.target_audience || '', 180),
        tone: normalizeTone(strategy?.tone_style || profileContext?.tone_style || 'professional'),
        goals: dedupeStrings(Array.isArray(strategy?.content_goals) ? strategy.content_goals : [], 8),
        topics: dedupeStrings(Array.isArray(strategy?.topics) ? strategy.topics : [], 10),
      },
      personaSignals,
      contextVaultSignals: {
        voice_signals: Array.isArray(contextVault.voice_signals) ? contextVault.voice_signals : [],
        winning_topics: Array.isArray(contextVault.winning_topics) ? contextVault.winning_topics : [],
      },
    };
  }

  async getCommentEngagementMap({ userId, sourceCommentIds = [] } = {}) {
    const commentIds = dedupeStrings(Array.isArray(sourceCommentIds) ? sourceCommentIds : [], 300);
    if (commentIds.length === 0) {
      return { map: new Map(), warning: null };
    }

    try {
      const { rows } = await pool.query(
        `SELECT source_comment_id,
                MAX(created_at) AS replied_at,
                (ARRAY_AGG(reply_text ORDER BY created_at DESC))[1] AS reply_text
         FROM linkedin_comment_reply_events
         WHERE user_id = $1
           AND status = 'sent'
           AND source_comment_id = ANY($2::text[])
         GROUP BY source_comment_id`,
        [userId, commentIds]
      );

      const map = new Map();
      for (const row of rows || []) {
        const key = toShortText(row?.source_comment_id || '', 200);
        if (!key) continue;
        map.set(key, {
          repliedAt: row?.replied_at || null,
          replyText: toShortText(row?.reply_text || '', 420),
        });
      }
      return { map, warning: null };
    } catch (error) {
      if (isMissingTableError(error)) {
        return {
          map: new Map(),
          warning: 'Comment reply tracking table is missing. Run latest migration to enable Replied/Unreplied status.',
        };
      }
      throw error;
    }
  }

  buildFallbackSuggestions({
    commentText = '',
    commenterName = '',
    objective = 'engage',
    evidenceAnchors = [],
    suggestionCount = 3,
    replyStyle = null,
  } = {}) {
    const anchor = pickFallbackAnchor(evidenceAnchors, commentText);
    const shortComment = toShortText(commentText, 160);
    const cleanName = normalizeCommenterName(commenterName);
    const namePrefix = cleanName ? `${toShortText(cleanName, 40)}, ` : '';
    const commentSignal = extractCommentSignal(commentText);
    const style = replyStyle && typeof replyStyle === 'object'
      ? replyStyle
      : deriveReplyStyle(commentText, objective);
    const isFirstMilestone = Boolean(style?.isFirstMilestone);

    const templates = isFirstMilestone
      ? [
          `${namePrefix}appreciate this. First automated post shipped and many more optimized updates are on the way.`,
          `${namePrefix}thank you. This is milestone one, and now we are iterating on hook clarity, timing, and consistency.`,
        ]
      : style?.isProductQuestion
        ? [
            `${namePrefix}${anchor}. Happy to share more if useful.`,
            `${namePrefix}the short answer is: ${anchor}. Let me know if you want the full breakdown.`,
            `${namePrefix}good question. At its core it is ${anchor}. Feel free to ask anything specific.`,
          ]
        : style?.isQuestion
          ? [
              `${namePrefix}great question. ${anchor} is the core of what we focus on — happy to share more if useful.`,
              `${namePrefix}the short answer: ${anchor}. Let me know if you want the full breakdown.`,
              `${namePrefix}solid question. We are focused on ${anchor} and can walk you through it if that helps.`,
            ]
          : style?.avoidFollowUpQuestions
            ? [
                `${namePrefix}appreciate you sharing this. Solid signal on "${commentSignal || 'this'}" and we are doubling down on ${anchor}.`,
                `${namePrefix}great point. We are applying this directly in the next iteration so execution stays practical.`,
                `${namePrefix}thanks for this. We will keep improving based on real response quality.`,
              ]
            : [
                `${namePrefix}appreciate you sharing this. ${anchor} is something we have been refining a lot lately.`,
                `${namePrefix}good call. A practical next step is turning this into one repeatable workflow tied to ${anchor}.`,
                `${namePrefix}useful angle. This aligns with what we have seen around ${anchor} when execution stays consistent.`,
              ];

    return templates.slice(0, Math.max(1, Math.min(5, suggestionCount))).map((reply, index) => ({
      reply: toShortText(reply, 420),
      rationale: index === 0
        ? 'Acknowledges the comment and stays aligned with your post context.'
        : 'Grounded in your available evidence signals.',
      evidenceRefs: normalizeEvidenceRefs([anchor, shortComment]),
      confidence: 'medium',
      source: 'fallback',
    }));
  }

  async getLatestReadyAssistByComment({
    userId,
    sourceCommentId = '',
    suggestionCount = 3,
  } = {}) {
    const cleanSourceCommentId = toShortText(sourceCommentId, 180);
    if (!cleanSourceCommentId) return null;

    try {
      const { rows } = await pool.query(
        `SELECT id, strategy_id, post_id, tone, objective, suggestions, metadata, created_at
         FROM linkedin_comment_reply_assist
         WHERE user_id = $1
           AND source_comment_id = $2
           AND status = 'ready'
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, cleanSourceCommentId]
      );
      const row = rows?.[0] || null;
      if (!row) return null;

      const suggestions = normalizePersistedSuggestions(row.suggestions, suggestionCount);
      if (suggestions.length === 0) return null;

      const metadata = parseJsonObject(row.metadata, {});
      return {
        requestId: row.id || null,
        strategyId: row.strategy_id || null,
        postId: row.post_id || null,
        tone: normalizeTone(row.tone || 'professional'),
        objective: normalizeObjective(row.objective || 'engage'),
        suggestions,
        provider: toShortText(metadata?.provider || '', 40) || null,
        evidenceAnchors: dedupeStrings(
          Array.isArray(metadata?.evidence_anchors) ? metadata.evidence_anchors : [],
          12
        ),
        createdAt: row.created_at || new Date().toISOString(),
        cached: true,
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  async generateSuggestions({
    userId,
    strategyId = null,
    postId = null,
    sourceCommentId = '',
    commentText = '',
    commenterName = '',
    tone = 'professional',
    objective = 'engage',
    contextNotes = '',
    suggestionCount = 3,
  } = {}) {
    const cleanComment = toShortText(commentText, 1200);
    if (!cleanComment) {
      throw new Error('commentText is required');
    }
    const cleanCommenter = normalizeCommenterName(commenterName);
    const cleanTone = normalizeTone(tone);
    const cleanObjective = normalizeObjective(objective);
    const cleanSourceCommentId = toShortText(sourceCommentId, 180) || '';
    const safeSuggestionCount = Math.max(1, Math.min(5, Number(suggestionCount) || 3));
    if (cleanSourceCommentId) {
      const cached = await this.getLatestReadyAssistByComment({
        userId,
        sourceCommentId: cleanSourceCommentId,
        suggestionCount: safeSuggestionCount,
      });
      if (cached) {
        return cached;
      }
    }
    const grounding = await this.buildGroundingContext({ userId, strategyId, postId });
    const replyStyle = deriveReplyStyle(cleanComment, cleanObjective, grounding);
    const productAnswerSeed = buildProductAnswerSeed(grounding);

    const prompt = [
      'Return ONLY valid JSON. No markdown.',
      'Schema:',
      '{"suggestions":[{"reply":"string","rationale":"string","evidence_refs":["string"],"confidence":"high|medium|low"}]}',
      `Generate exactly ${safeSuggestionCount} reply options.`,
      'Rules:',
      '- Replies must be human, concise, and LinkedIn-appropriate.',
      '- Avoid generic filler ("great post", "thanks for sharing") unless expanded with concrete value.',
      '- No spammy CTAs or aggressive sales language.',
      '- Prefer acknowledgement-first replies for short positive comments.',
      '- Only ask follow-up questions when commenter intent is exploratory or the user asked a direct question.',
      '- If reply_style is acknowledge_progress, avoid follow-up questions and provide gratitude + forward progress in 1-2 sentences.',
      '- If commenter name is missing, do not invent placeholder names or generic greetings.',
      '- Every suggestion must include 1-3 evidence_refs grounded in provided context.',
      replyStyle.isProductQuestion && productAnswerSeed
        ? `PRODUCT QUESTION DETECTED. Answer it directly using this description: ${productAnswerSeed}`
        : null,
      replyStyle.isProductQuestion
        ? 'Rules for product question: 1-2 sentences max. No follow-up question. No "great question". Just answer what the product is and who it helps.'
        : null,
      replyStyle.isQuestion && !replyStyle.isProductQuestion
        ? 'This comment is a direct question. Answer it using the evidence anchors and post context. Do not treat it as a statement.'
        : null,
      `Comment text: ${cleanComment}`,
      `Comment author: ${toShortText(cleanCommenter, 80) || 'not_provided'}`,
      `Tone: ${cleanTone}`,
      `Objective: ${cleanObjective}`,
      `Comment intent: ${replyStyle.mode}`,
      `Avoid follow-up questions: ${replyStyle.avoidFollowUpQuestions ? 'yes' : 'no'}`,
      `Extra notes: ${toShortText(contextNotes, 260) || 'none'}`,
      `Strategy niche: ${grounding.strategySignals.niche || 'none'}`,
      `Strategy audience: ${grounding.strategySignals.audience || 'none'}`,
      `Strategy goals: ${grounding.strategySignals.goals.join(', ') || 'none'}`,
      `Strategy topics: ${grounding.strategySignals.topics.join(', ') || 'none'}`,
      `Post context: ${toShortText(grounding.post?.post_content || '', 380) || 'none'}`,
      `Evidence anchors: ${grounding.evidenceAnchors.join(' | ') || 'none'}`,
      `Profile summary: ${toShortText(grounding.profileContext?.proof_points || grounding.strategySignals?.niche || '', 300) || 'none'}`,
    ].filter(Boolean).join('\n');

    let suggestions = [];
    let provider = null;
    try {
      const aiResult = await aiService.generateStrategyContent(prompt, cleanTone, null, userId);
      suggestions = parseSuggestionsFromProvider(aiResult?.content || '');
      provider = aiResult?.provider || null;
    } catch (error) {
      console.warn('[CommentReplyAssist] provider generation failed, using fallback', {
        userId,
        strategyId,
        postId,
        error: error?.message || error,
      });
    }

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      suggestions = this.buildFallbackSuggestions({
        commentText: cleanComment,
        commenterName: cleanCommenter,
        objective: cleanObjective,
        evidenceAnchors: grounding.evidenceAnchors,
        suggestionCount: safeSuggestionCount,
        replyStyle,
      });
    } else {
      suggestions = suggestions.slice(0, safeSuggestionCount).map((item) => ({
        ...item,
        source: 'ai',
      }));

      if (replyStyle.avoidFollowUpQuestions) {
        const nonQuestionSuggestions = suggestions.filter((item) => !/\?/.test(String(item?.reply || '')));
        if (nonQuestionSuggestions.length > 0) {
          suggestions = nonQuestionSuggestions;
        }
      }

      if (suggestions.length < safeSuggestionCount) {
        const fallback = this.buildFallbackSuggestions({
          commentText: cleanComment,
          commenterName: cleanCommenter,
          objective: cleanObjective,
          evidenceAnchors: grounding.evidenceAnchors,
          suggestionCount: safeSuggestionCount,
          replyStyle,
        });
        const existing = new Set(suggestions.map((item) => String(item.reply || '').toLowerCase().trim()));
        for (const candidate of fallback) {
          const key = String(candidate.reply || '').toLowerCase().trim();
          if (!key || existing.has(key)) continue;
          suggestions.push(candidate);
          existing.add(key);
          if (suggestions.length >= safeSuggestionCount) break;
        }
      }
    }

    const persistPayload = suggestions.map((item) => ({
      reply: toShortText(item.reply, 460),
      rationale: toShortText(item.rationale, 220),
      evidence_refs: normalizeEvidenceRefs(item.evidenceRefs || []),
      confidence: toShortText(item.confidence || 'medium', 20) || 'medium',
      source: item.source || 'ai',
    }));

    const { rows } = await pool.query(
      `INSERT INTO linkedin_comment_reply_assist (
         user_id, strategy_id, post_id, source_comment_id, comment_text, comment_author,
         tone, objective, suggestions, metadata, status, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9::jsonb, $10::jsonb, 'ready', NOW(), NOW()
       )
       RETURNING *`,
      [
        userId,
        strategyId || null,
        postId || null,
        cleanSourceCommentId || null,
        cleanComment,
        toShortText(cleanCommenter, 120) || null,
        cleanTone,
        cleanObjective,
        JSON.stringify(persistPayload),
        JSON.stringify({
          provider,
          evidence_anchors: grounding.evidenceAnchors.slice(0, 12),
          context_notes: toShortText(contextNotes, 260),
        }),
      ]
    );

    return {
      requestId: rows[0]?.id || null,
      strategyId: strategyId || null,
      postId: postId || null,
      tone: cleanTone,
      objective: cleanObjective,
      suggestions: persistPayload,
      provider,
      evidenceAnchors: grounding.evidenceAnchors.slice(0, 12),
      createdAt: rows[0]?.created_at || new Date().toISOString(),
    };
  }

  async linkedinGetWithVersionFallback({ url, accessToken, timeout = 12000 } = {}) {
    const candidates = buildVersionCandidates();
    let lastError = null;

    for (const version of candidates) {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      };
      if (version) headers['LinkedIn-Version'] = version;

      try {
        return await axios.get(url, {
          headers,
          timeout,
        });
      } catch (error) {
        lastError = error;
        if (isNonexistentVersionError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error('LinkedIn request failed');
  }

  buildInboxPostScope({ userId, accountId = null, accountType = null } = {}) {
    let where = `WHERE user_id = $1
      AND status = 'posted'
      AND COALESCE(comments, 0) > 0
      AND COALESCE(linkedin_post_id, '') <> ''`;
    const params = [userId];

    const cleanAccountId = toShortText(accountId || '', 160);
    const cleanAccountType = String(accountType || '').trim().toLowerCase();
    if (!cleanAccountId) {
      return { where, params };
    }

    if (cleanAccountType === 'team') {
      params.push(cleanAccountId);
      where += ` AND account_id::text = $${params.length}`;
      return { where, params };
    }

    if (cleanAccountType === 'organization' || cleanAccountId.startsWith('org:')) {
      const orgId = cleanAccountId.replace(/^org:/, '');
      params.push(cleanAccountId);
      const accountParam = params.length;
      params.push(orgId);
      const orgParam = params.length;
      where += ` AND (account_id::text = $${accountParam} OR company_id::text = $${orgParam} OR linkedin_user_id = $${orgParam})`;
      return { where, params };
    }

    params.push(cleanAccountId);
    where += ` AND (account_id::text = $${params.length} OR linkedin_user_id = $${params.length})`;
    return { where, params };
  }

  async listInboxComments({
    userId,
    accountId = null,
    accountType = null,
    postLimit = 12,
    perPostLimit = 8,
    limit = 60,
  } = {}) {
    const safePostLimit = parsePositiveInt(postLimit, 12, { min: 1, max: MAX_COMMENT_INBOX_POSTS });
    const safePerPostLimit = parsePositiveInt(perPostLimit, 8, { min: 1, max: MAX_COMMENT_INBOX_PER_POST });
    const safeLimit = parsePositiveInt(limit, 60, { min: 1, max: MAX_COMMENT_INBOX_TOTAL });
    const warnings = [];

    const scope = this.buildInboxPostScope({ userId, accountId, accountType });
    const { rows: postRows } = await pool.query(
      `SELECT id, linkedin_post_id, post_content, comments, created_at, account_id, company_id, linkedin_user_id
       FROM linkedin_posts
       ${scope.where}
       ORDER BY comments DESC, created_at DESC
       LIMIT $${scope.params.length + 1}`,
      [...scope.params, safePostLimit]
    );

    if (!Array.isArray(postRows) || postRows.length === 0) {
      return {
        comments: [],
        total: 0,
        postCount: 0,
        warnings: ['No posts with comments were found yet. Sync analytics first.'],
      };
    }

    const auth = await linkedinAutomationService.getLinkedInApiAuthContext(userId, {
      accountId: accountId || null,
      accountType: accountType || null,
    });
    if (!auth?.accessToken) {
      return {
        comments: [],
        total: 0,
        postCount: postRows.length,
        warnings: ['LinkedIn access is missing for this account. Reconnect LinkedIn and retry.'],
      };
    }

    const comments = [];
    for (const post of postRows) {
      if (comments.length >= safeLimit) break;

      const postUrn = toLinkedInPostUrn(post.linkedin_post_id);
      if (!postUrn) continue;

      const endpoint = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrn)}/comments?count=${safePerPostLimit}`;
      try {
        const response = await this.linkedinGetWithVersionFallback({
          url: endpoint,
          accessToken: auth.accessToken,
          timeout: 15000,
        });
        const payload = response?.data || {};
        const elements = Array.isArray(payload?.elements)
          ? payload.elements
          : Array.isArray(payload?.results)
            ? payload.results
            : Array.isArray(payload?.items)
              ? payload.items
              : [];

        for (let idx = 0; idx < elements.length; idx += 1) {
          if (comments.length >= safeLimit) break;
          const item = elements[idx] || {};
          const commentText = toShortText(extractCommentText(item), 1200);
          if (!commentText) continue;

          const sourceCommentRaw = toShortText(
            item?.commentUrn || item?.urn || item?.id || item?.commentId || '',
            180
          );
          const sourceCommentTarget = normalizeSourceCommentTarget({
            sourceCommentId: sourceCommentRaw,
            postUrn,
          });
          const sourceCommentId = sourceCommentTarget.commentUrn || sourceCommentTarget.sourceCommentId;
          if (!sourceCommentId) {
            warnings.push(`${postUrn}: skipped comment because stable comment identifier was missing`);
            continue;
          }
          const createdAtRaw = Number(item?.created?.time || item?.createdAt || item?.lastModifiedAt || 0);
          const commentedAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0
            ? new Date(createdAtRaw).toISOString()
            : null;

          comments.push({
            id: `${post.id}:${sourceCommentId}`,
            sourceCommentId,
            commentText,
            commenterName: normalizeCommenterName(extractCommenterName(item)),
            commenterUrn: toShortText(extractCommenterUrn(item), 180) || null,
            commentedAt,
            postId: post.id,
            linkedinPostId: post.linkedin_post_id,
            postSnippet: toShortText(post.post_content || '', 260),
            postCreatedAt: post.created_at || null,
            postCommentCount: Number(post.comments || 0),
          });
        }
      } catch (error) {
        warnings.push(
          `${postUrn}: ${toShortText(error?.response?.data?.message || error?.message || 'fetch_failed', 120)}`
        );
      }
    }

    const { map: engagementMap, warning: engagementWarning } = await this.getCommentEngagementMap({
      userId,
      sourceCommentIds: comments.map((item) => item.sourceCommentId).filter(Boolean),
    });
    if (engagementWarning) {
      warnings.push(engagementWarning);
    }

    const hydratedComments = comments
      .map((item) => {
        const engagement = engagementMap.get(String(item.sourceCommentId || '').trim()) || null;
        return {
          ...item,
          isEngaged: Boolean(engagement),
          repliedAt: engagement?.repliedAt || null,
          lastReplyText: engagement?.replyText || '',
        };
      })
      .sort((a, b) => {
        if (a.isEngaged !== b.isEngaged) return a.isEngaged ? 1 : -1;
        const aTime = new Date(a.commentedAt || a.postCreatedAt || 0).getTime();
        const bTime = new Date(b.commentedAt || b.postCreatedAt || 0).getTime();
        return bTime - aTime;
      });

    return {
      comments: hydratedComments,
      total: hydratedComments.length,
      postCount: postRows.length,
      warnings: dedupeStrings(warnings, 20),
      engagementSummary: {
        unrepliedCount: hydratedComments.filter((item) => !item.isEngaged).length,
        repliedCount: hydratedComments.filter((item) => item.isEngaged).length,
      },
    };
  }

  async sendReply({
    userId,
    strategyId = null,
    assistRequestId = null,
    postId = null,
    linkedinPostId = '',
    sourceCommentId = '',
    commentText = '',
    replyText = '',
    accountId = null,
    accountType = null,
  } = {}) {
    const cleanReply = toShortText(replyText, MAX_REPLY_TEXT_LENGTH);
    if (!cleanReply) {
      throw new Error('replyText is required');
    }

    let cleanSourceCommentId = toShortText(sourceCommentId, 180);
    if (!cleanSourceCommentId) {
      throw new Error('sourceCommentId is required');
    }

    let resolvedPostId = toShortText(postId, 80) || null;
    let cleanLinkedInPostId = toLinkedInPostUrn(linkedinPostId);
    if (resolvedPostId && !cleanLinkedInPostId) {
      const { rows } = await pool.query(
        `SELECT id, linkedin_post_id
         FROM linkedin_posts
         WHERE id = $1
           AND user_id = $2
         LIMIT 1`,
        [resolvedPostId, userId]
      );
      const postRow = rows?.[0] || null;
      if (postRow) {
        resolvedPostId = postRow.id;
        cleanLinkedInPostId = toLinkedInPostUrn(postRow.linkedin_post_id);
      }
    }

    const normalizedSourceTarget = normalizeSourceCommentTarget({
      sourceCommentId: cleanSourceCommentId,
      postUrn: cleanLinkedInPostId,
    });
    cleanSourceCommentId = normalizedSourceTarget.sourceCommentId || cleanSourceCommentId;
    let parentCommentUrn = normalizedSourceTarget.commentUrn || '';
    const parentCommentId = normalizedSourceTarget.commentId || '';
    const parsedParentComment = parseCommentUrn(parentCommentUrn);

    if (!cleanLinkedInPostId && parsedParentComment?.objectUrn) {
      cleanLinkedInPostId = toLinkedInPostUrn(parsedParentComment.objectUrn);
    }
    if (!parentCommentUrn && cleanLinkedInPostId && /^\d+$/.test(cleanSourceCommentId)) {
      parentCommentUrn = buildCommentUrn(cleanLinkedInPostId, cleanSourceCommentId);
    }
    if (!parentCommentUrn) {
      throw new Error(
        'Unable to resolve a stable LinkedIn comment URN for reply. Refresh comments and retry.'
      );
    }
    if (!cleanLinkedInPostId) {
      const parsed = parseCommentUrn(parentCommentUrn);
      cleanLinkedInPostId = toLinkedInPostUrn(parsed?.objectUrn || '');
    }

    const auth = await linkedinAutomationService.getLinkedInApiAuthContext(userId, {
      accountId: accountId || null,
      accountType: accountType || null,
    });
    if (!auth?.accessToken) {
      throw new Error('LinkedIn access is missing for this account');
    }

    const authorUrn = auth.accountType === 'organization'
      ? (auth.organizationId ? `urn:li:organization:${auth.organizationId}` : '')
      : (auth.linkedinUserId ? `urn:li:person:${auth.linkedinUserId}` : '');
    if (!authorUrn) {
      throw new Error('LinkedIn actor identity is unavailable for this account');
    }

    const endpointCandidates = [];
    const addEndpoint = (url = '') => {
      const clean = String(url || '').trim();
      if (!clean || endpointCandidates.includes(clean)) return;
      endpointCandidates.push(clean);
    };
    addEndpoint(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(parentCommentUrn)}/comments`);
    if (cleanLinkedInPostId) {
      addEndpoint(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(cleanLinkedInPostId)}/comments`);
    }
    addEndpoint(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(parentCommentUrn)}/comments`);
    if (cleanLinkedInPostId) {
      addEndpoint(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(cleanLinkedInPostId)}/comments`);
    }

    const parentTargets = [];
    const addParentTarget = (value = null) => {
      if (value === null || value === undefined) return;
      const normalized = typeof value === 'number' ? value : String(value).trim();
      if (!normalized) return;
      if (parentTargets.some((candidate) => String(candidate) === String(normalized))) return;
      parentTargets.push(normalized);
    };
    addParentTarget(parentCommentUrn);
    addParentTarget(cleanSourceCommentId);
    if (parentCommentId) addParentTarget(parentCommentId);
    if (parentCommentId && /^\d+$/.test(parentCommentId)) addParentTarget(Number(parentCommentId));

    const payloadCandidates = [];
    for (const parentTarget of parentTargets) {
      const payloadWithObject = {
        actor: authorUrn,
        message: { text: cleanReply },
        parentComment: parentTarget,
      };
      if (cleanLinkedInPostId) payloadWithObject.object = cleanLinkedInPostId;
      payloadCandidates.push(payloadWithObject);

      payloadCandidates.push({
        actor: authorUrn,
        message: { text: cleanReply },
        parentComment: parentTarget,
      });
    }

    let published = null;
    let lastError = null;
    let requestBodyUsed = null;
    let endpointUsed = null;
    for (const endpoint of endpointCandidates) {
      for (const payload of payloadCandidates) {
        try {
          const response = await this.linkedinPostWithVersionFallback({
            url: endpoint,
            accessToken: auth.accessToken,
            data: payload,
            timeout: 15000,
          });
          published = response?.data || {};
          requestBodyUsed = payload;
          endpointUsed = endpoint;
          break;
        } catch (error) {
          lastError = error;
          const status = Number(error?.response?.status || 0);
          // Try next request shape for validation/shape failures.
          if (status === 400 || status === 404 || status === 422) {
            continue;
          }
          throw error;
        }
      }
      if (published) break;
    }

    if (!published) {
      throw lastError || new Error('Failed to send LinkedIn reply');
    }

    const replyUrn = toShortText(
      published?.id || published?.urn || published?.commentUrn || published?.resource || '',
      200
    ) || null;
    const createdAt = new Date().toISOString();
    let eventId = null;

    try {
      const { rows } = await pool.query(
        `INSERT INTO linkedin_comment_reply_events (
           user_id, strategy_id, assist_request_id, post_id, linkedin_post_id,
           source_comment_id, comment_text, reply_text, reply_urn, status, metadata, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, 'sent', $10::jsonb, NOW(), NOW()
         )
         RETURNING id, created_at`,
        [
          userId,
          strategyId || null,
          assistRequestId || null,
          resolvedPostId || null,
          cleanLinkedInPostId || null,
          parentCommentUrn || cleanSourceCommentId,
          toShortText(commentText, 1200) || null,
          cleanReply,
          replyUrn,
          JSON.stringify({
            endpoint: endpointUsed || null,
            endpointTarget: parentCommentUrn,
            postTarget: cleanLinkedInPostId || null,
            accountType: auth.accountType || null,
            requestBodyShape:
              requestBodyUsed?.parentComment && requestBodyUsed?.object
                ? 'actor_parentComment_object_message'
                : requestBodyUsed?.parentComment
                  ? 'actor_parentComment_message'
                  : 'actor_message',
          }),
        ]
      );
      eventId = rows?.[0]?.id || null;
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      console.warn('[CommentReplyAssist] Reply sent but tracking table missing', {
        userId,
        sourceCommentId: parentCommentUrn || cleanSourceCommentId,
      });
    }

    if (assistRequestId) {
      try {
        await pool.query(
          `UPDATE linkedin_comment_reply_assist
           SET status = 'sent', updated_at = NOW()
           WHERE id = $1
             AND user_id = $2`,
          [assistRequestId, userId]
        );
      } catch (error) {
        console.warn('[CommentReplyAssist] Failed to mark assist request as sent', {
          userId,
          assistRequestId,
          error: error?.message || String(error),
        });
      }
    }

    return {
      eventId,
      sourceCommentId: parentCommentUrn || cleanSourceCommentId,
      replyUrn,
      replyText: cleanReply,
      isEngaged: true,
      repliedAt: createdAt,
    };
  }

  async listHistory({ userId, strategyId = null, limit = 20, offset = 0 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const params = [userId];
    let where = 'WHERE user_id = $1';
    if (strategyId) {
      params.push(strategyId);
      where += ` AND strategy_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_comment_reply_assist
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, safeLimit, safeOffset]
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM linkedin_comment_reply_assist
       ${where}`,
      params
    );

    const history = rows.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id || null,
      postId: row.post_id || null,
      sourceCommentId: row.source_comment_id || null,
      commentText: row.comment_text || '',
      commentAuthor: row.comment_author || '',
      tone: row.tone || 'professional',
      objective: row.objective || 'engage',
      suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
      metadata: parseJsonObject(row.metadata, {}),
      status: row.status || 'ready',
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));

    return {
      history,
      total: Number(countRows?.[0]?.count || 0),
      limit: safeLimit,
      offset: safeOffset,
    };
  }
}

const commentReplyAssistService = new CommentReplyAssistService();
export default commentReplyAssistService;







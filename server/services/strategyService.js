import { pool } from '../config/database.js';
import aiService from './aiService.js';

class StrategyService {
  constructor() {
    this.productScope = 'linkedin-genie';
  }

  withProductScope(metadata = {}) {
    const baseMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata
        : {};

    return {
      ...baseMetadata,
      product: this.productScope,
    };
  }

  stripMarkdownCodeFences(value = '') {
    return String(value)
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  normalizeJsonLikeText(content = '') {
    return this.stripMarkdownCodeFences(content)
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u00A0/g, ' ')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
  }

  extractFirstJSONObject(text = '') {
    const source = String(text || '');
    const startIndex = source.indexOf('{');
    if (startIndex === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return null;
  }

  extractJSONArrayByKey(text = '', key = '') {
    const source = String(text || '');
    const escapedKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyPattern = new RegExp(`"${escapedKey}"\\s*:\\s*\\[`, 'i');
    const match = source.match(keyPattern);
    if (!match || typeof match.index !== 'number') {
      return null;
    }

    const arrayStart = source.indexOf('[', match.index);
    if (arrayStart === -1) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = arrayStart; index < source.length; index += 1) {
      const char = source[index];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(arrayStart, index + 1);
        }
      }
    }

    return null;
  }

  splitJSONObjectArray(arrayText = '') {
    const source = String(arrayText || '');
    const objects = [];
    let objectStart = -1;
    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\' && inString) {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          objectStart = index;
        }
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0 && objectStart !== -1) {
          objects.push(source.slice(objectStart, index + 1));
          objectStart = -1;
        }
      }
    }

    return objects;
  }

  parsePromptItemsFromContent(content) {
    const normalizedContent = this.normalizeJsonLikeText(content);

    try {
      const parsedObject = this.parseJSONObjectFromText(normalizedContent);
      if (Array.isArray(parsedObject?.prompts)) {
        return parsedObject.prompts;
      }
    } catch {
      // Ignore and try tolerant extraction below.
    }

    const promptsArrayText = this.extractJSONArrayByKey(normalizedContent, 'prompts');
    if (!promptsArrayText) {
      return [];
    }

    const promptObjectChunks = this.splitJSONObjectArray(promptsArrayText);
    const parsedPrompts = [];

    for (const chunk of promptObjectChunks) {
      const cleanedChunk = chunk
        .replace(/,\s*([}\]])/g, '$1')
        .trim();

      if (!cleanedChunk) {
        continue;
      }

      try {
        const parsedItem = JSON.parse(cleanedChunk);
        if (parsedItem && typeof parsedItem === 'object') {
          parsedPrompts.push(parsedItem);
        }
      } catch {
        // Skip malformed object and continue with remaining ones.
      }
    }

    return parsedPrompts;
  }

  parseJSONObjectFromText(content) {
    const normalizedContent = this.normalizeJsonLikeText(content);

    try {
      return JSON.parse(normalizedContent);
    } catch (directParseError) {
      const jsonObjectText = this.extractFirstJSONObject(normalizedContent);
      if (!jsonObjectText) {
        throw new Error('AI response is not valid JSON');
      }
      return JSON.parse(jsonObjectText);
    }
  }

  normalizePromptCategory(rawCategory = '') {
    const normalized = String(rawCategory || '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ');

    const aliasMap = {
      education: 'educational',
      educational: 'educational',
      engage: 'engagement',
      engagement: 'engagement',
      story: 'storytelling',
      storytelling: 'storytelling',
      tips: 'tips & tricks',
      'tips and tricks': 'tips & tricks',
      'tips & tricks': 'tips & tricks',
      promo: 'promotional',
      promotional: 'promotional',
      inspire: 'inspirational',
      inspirational: 'inspirational',
    };

    return aliasMap[normalized] || 'educational';
  }

  cleanPromptText(value = '') {
    return String(value || '')
      .replace(/`{1,3}/g, '')
      .replace(/\[\d+\]/g, '')
      .replace(/\(\d+\)(?=\s|$)/g, '')
      .replace(/^prompt\s+[^:]{1,50}\s+prompt:\s*/i, '')
      .replace(
        /^(educational|engagement|storytelling|tips(?:\s*&\s*|\s+and\s+)tricks|promotional|inspirational)\s*prompt:\s*/i,
        ''
      )
      .replace(/^prompt\s*:\s*/i, '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getPromptCategories() {
    return [
      'educational',
      'engagement',
      'storytelling',
      'tips & tricks',
      'promotional',
      'inspirational',
    ];
  }

  tokenizePromptForSimilarity(value = '') {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'your', 'our', 'their', 'from',
      'into', 'about', 'around', 'than', 'then', 'have', 'has', 'had', 'are', 'was',
      'were', 'can', 'you', 'they', 'them', 'its', 'one', 'two', 'use', 'using',
      'help', 'helps', 'helping', 'stay', 'make', 'more', 'less', 'over', 'under',
      'without', 'within', 'across', 'through', 'where', 'when', 'what', 'why',
      'how', 'who', 'all', 'any', 'but', 'not', 'new', 'best', 'next', 'step',
      'value', 'first', 'angle', 'around', 'share', 'give', 'lead', 'around',
    ]);

    return this.cleanPromptText(value)
      .toLowerCase()
      .replace(/\{[^}]+\}/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !stopWords.has(token));
  }

  buildPromptFingerprint(value = '') {
    const cleaned = this.cleanPromptText(value).toLowerCase();
    const words = cleaned.split(/\s+/).filter(Boolean);
    return {
      prefix: words.slice(0, 6).join(' '),
      tokens: this.tokenizePromptForSimilarity(cleaned),
    };
  }

  calculateJaccardSimilarity(tokensA = [], tokensB = []) {
    const setA = new Set(Array.isArray(tokensA) ? tokensA : []);
    const setB = new Set(Array.isArray(tokensB) ? tokensB : []);
    if (setA.size === 0 || setB.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) {
        intersection += 1;
      }
    }

    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  isNearDuplicateFingerprint(fingerprint, existingFingerprints = [], threshold = 0.75) {
    if (!fingerprint || (!fingerprint.prefix && (!fingerprint.tokens || fingerprint.tokens.length === 0))) {
      return false;
    }

    for (const current of existingFingerprints) {
      if (!current) continue;
      if (fingerprint.prefix && current.prefix && fingerprint.prefix === current.prefix) {
        return true;
      }
      const similarity = this.calculateJaccardSimilarity(fingerprint.tokens, current.tokens);
      if (similarity >= threshold) {
        return true;
      }
    }

    return false;
  }

  selectDiverseBalancedPrompts(rawPrompts = [], desiredCount = 36) {
    const categories = this.getPromptCategories();
    const exactSeen = new Set();
    const candidates = [];

    for (const item of Array.isArray(rawPrompts) ? rawPrompts : []) {
      const promptText = this.cleanPromptText(item?.prompt_text || '');
      if (promptText.length < 12) continue;

      const key = promptText.toLowerCase();
      if (exactSeen.has(key)) continue;
      exactSeen.add(key);

      const category = categories.includes(item?.category) ? item.category : 'educational';
      const variables =
        item?.variables && typeof item.variables === 'object' && !Array.isArray(item.variables)
          ? item.variables
          : {};

      candidates.push({
        category,
        prompt_text: promptText,
        variables,
        _fingerprint: this.buildPromptFingerprint(promptText),
      });
    }

    if (candidates.length === 0) {
      return [];
    }

    const selected = [];
    const selectedByCategory = Object.fromEntries(categories.map((category) => [category, 0]));
    const selectedFingerprintsByCategory = Object.fromEntries(categories.map((category) => [category, []]));
    const selectedFingerprintsGlobal = [];
    const selectedIndexes = new Set();
    const perCategoryTarget = Math.max(1, Math.floor(desiredCount / categories.length));

    const trySelect = (candidate, categoryThreshold, globalThreshold) => {
      const category = candidate.category;
      const categoryFingerprints = selectedFingerprintsByCategory[category] || [];
      if (this.isNearDuplicateFingerprint(candidate._fingerprint, categoryFingerprints, categoryThreshold)) {
        return false;
      }
      if (this.isNearDuplicateFingerprint(candidate._fingerprint, selectedFingerprintsGlobal, globalThreshold)) {
        return false;
      }

      selected.push(candidate);
      selectedByCategory[category] = (selectedByCategory[category] || 0) + 1;
      categoryFingerprints.push(candidate._fingerprint);
      selectedFingerprintsGlobal.push(candidate._fingerprint);
      return true;
    };

    const categoryThresholds = [0.72, 0.78, 0.86];
    for (const threshold of categoryThresholds) {
      for (const category of categories) {
        if (selectedByCategory[category] >= perCategoryTarget) {
          continue;
        }

        for (let index = 0; index < candidates.length; index += 1) {
          if (selectedIndexes.has(index)) continue;
          const candidate = candidates[index];
          if (candidate.category !== category) continue;
          if (selectedByCategory[category] >= perCategoryTarget) break;

          const chosen = trySelect(candidate, threshold, Math.min(0.92, threshold + 0.12));
          if (chosen) {
            selectedIndexes.add(index);
          }
        }
      }
    }

    const fillThresholds = [0.72, 0.78, 0.86, 0.92];
    for (const threshold of fillThresholds) {
      if (selected.length >= desiredCount) break;

      for (let index = 0; index < candidates.length; index += 1) {
        if (selected.length >= desiredCount) break;
        if (selectedIndexes.has(index)) continue;

        const candidate = candidates[index];
        const chosen = trySelect(candidate, threshold, Math.min(0.95, threshold + 0.1));
        if (chosen) {
          selectedIndexes.add(index);
        }
      }
    }

    if (selected.length < desiredCount) {
      for (let index = 0; index < candidates.length; index += 1) {
        if (selected.length >= desiredCount) break;
        if (selectedIndexes.has(index)) continue;
        selected.push(candidates[index]);
        selectedIndexes.add(index);
      }
    }

    return selected
      .slice(0, desiredCount)
      .map(({ _fingerprint, ...prompt }) => prompt);
  }

  buildFallbackPromptTemplates(strategy, desiredCount = 30) {
    const topics = this.normalizeAndDedupe(Array.isArray(strategy?.topics) ? strategy.topics : [], 10, 80);
    const goals = this.normalizeAndDedupe(Array.isArray(strategy?.content_goals) ? strategy.content_goals : [], 10, 80);
    const tone = strategy?.tone_style || 'clear and practical';
    const audience = strategy?.target_audience || 'your target audience';
    const niche = strategy?.niche || 'your niche';
    const topicPool = topics.length > 0 ? topics : [niche];
    const goalPool = goals.length > 0 ? goals : ['Build authority'];
    const categories = this.getPromptCategories();

    const templateBank = {
      educational: [
        {
          prompt_text: 'Break down one overlooked lesson about {topic} that {audience} can apply in under 15 minutes.',
          instruction: 'Start with a myth, then give a simple framework and one concrete action.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Explain {topic} with a simple real-world example that makes the concept click for beginners.',
          instruction: 'Use plain language, one short example, and finish with a takeaway sentence.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Teach a before vs after approach for {topic} so {audience} avoid common beginner mistakes.',
          instruction: 'Contrast old method vs improved method with one measurable outcome.',
          recommended_format: 'single_post',
        },
      ],
      engagement: [
        {
          prompt_text: 'Ask {audience} what is the hardest part of improving {topic} right now.',
          instruction: 'Use one focused question and 2 short reply options to increase comments.',
          recommended_format: 'question',
        },
        {
          prompt_text: 'Run a quick this-or-that poll about {topic} to understand audience preferences.',
          instruction: 'Keep options clear and close with why their answer matters.',
          recommended_format: 'poll',
        },
        {
          prompt_text: 'Invite {audience} to share one small win they got from improving {topic}.',
          instruction: 'Lead with encouragement and include a friendly reply prompt.',
          recommended_format: 'question',
        },
      ],
      storytelling: [
        {
          prompt_text: 'Tell a short story where focusing on {topic} helped achieve {goal}.',
          instruction: 'Use setup, conflict, resolution, then a one-line lesson.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Share a behind-the-scenes moment where a mistake in {topic} turned into progress.',
          instruction: 'Be specific about the mistake and what changed afterward.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Write a mini case study about a client or creator who improved results by changing {topic}.',
          instruction: 'Include baseline, action taken, and concrete result.',
          recommended_format: 'single_post',
        },
      ],
      'tips & tricks': [
        {
          prompt_text: 'Create a 5-step checklist to improve {topic} this week without extra tools.',
          instruction: 'Each step should start with an action verb and stay practical.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Share 3 quick wins for {audience} to make immediate progress in {topic}.',
          instruction: 'Use concise bullet format and include one realistic expected outcome.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Build a do this / avoid this tip list for {topic} aimed at beginners.',
          instruction: 'Pair each tip with one short reason so it is actionable.',
          recommended_format: 'single_post',
        },
      ],
      promotional: [
        {
          prompt_text: 'Show how your offer helps {audience} solve {topic} faster, without hard selling.',
          instruction: 'Lead with pain point and transformation, then use a soft CTA.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Position your product around {topic} with one concrete use case and one business outcome.',
          instruction: 'Avoid hype words, stay specific, and end with one next step.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Write a value-first post connecting {topic} to {goal}, then introduce your solution briefly.',
          instruction: 'Give value first for at least 70% of the post before any CTA.',
          recommended_format: 'single_post',
        },
      ],
      inspirational: [
        {
          prompt_text: 'Share a mindset shift that helps {audience} stay consistent with {topic} for 30 days.',
          instruction: 'Use a bold opening line and finish with a practical challenge.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Write a motivational post about small daily progress in {topic} leading to bigger wins.',
          instruction: 'Keep it grounded in realistic actions, not generic motivation.',
          recommended_format: 'single_post',
        },
        {
          prompt_text: 'Inspire {audience} by reframing setbacks in {topic} as data for improvement.',
          instruction: 'Use one short example and end with a clear encouragement line.',
          recommended_format: 'single_post',
        },
      ],
    };

    const templates = [];
    for (let index = 0; index < desiredCount; index += 1) {
      const category = categories[index % categories.length];
      const topic = topicPool[(index + Math.floor(index / categories.length)) % topicPool.length];
      const goal = goalPool[(index * 2 + 1) % goalPool.length];
      const variants = templateBank[category] || templateBank.educational;
      const variant = variants[Math.floor(index / categories.length) % variants.length];

      const replaceTokens = (text = '') =>
        String(text)
          .replace(/\{topic\}/g, topic)
          .replace(/\{goal\}/g, goal.toLowerCase())
          .replace(/\{audience\}/g, audience);

      templates.push({
        category,
        prompt_text: replaceTokens(variant.prompt_text),
        variables: {
          instruction: replaceTokens(variant.instruction),
          recommended_format: variant.recommended_format || 'single_post',
          goal,
          tone_hint: tone,
        },
      });
    }

    return templates;
  }

  summarizeStrategy(strategy) {
    const goals = Array.isArray(strategy?.content_goals) ? strategy.content_goals : [];
    const topics = Array.isArray(strategy?.topics) ? strategy.topics : [];

    return [
      `Niche: ${strategy?.niche || 'Not set'}`,
      `Audience: ${strategy?.target_audience || 'Not set'}`,
      `Goals: ${goals.length > 0 ? goals.join(', ') : 'Not set'}`,
      `Posting: ${strategy?.posting_frequency || 'Not set'}`,
      `Tone: ${strategy?.tone_style || 'Not set'}`,
      `Topics: ${topics.length > 0 ? topics.join(', ') : 'Not set'}`,
    ].join('\n');
  }

  parseCsvList(text = '') {
    if (typeof text !== 'string') {
      return [];
    }

    return text
      .split(',')
      .map((item) => item.trim())
      .map((item) => item.replace(/^\d+\.\s*/, ''))
      .filter(Boolean);
  }

  normalizeAndDedupe(items = [], limit = 10, maxItemLength = Infinity) {
    const normalized = [];
    const seen = new Set();

    for (const item of Array.isArray(items) ? items : []) {
      if (typeof item !== 'string') {
        continue;
      }

      const cleaned = item.trim().replace(/\s+/g, ' ').slice(0, maxItemLength);
      if (!cleaned) {
        continue;
      }

      const key = cleaned.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      normalized.push(cleaned);

      if (normalized.length >= limit) {
        break;
      }
    }

    return normalized;
  }

  mergeLists(base = [], additions = [], limit = 10, maxItemLength = Infinity) {
    return this.normalizeAndDedupe(
      [...(Array.isArray(base) ? base : []), ...(Array.isArray(additions) ? additions : [])],
      limit,
      maxItemLength
    );
  }

  async getLatestSuggestedTopics(strategyId) {
    const { rows } = await pool.query(
      `SELECT metadata
       FROM strategy_chat_history
       WHERE strategy_id = $1
         AND role = 'assistant'
         AND metadata->'suggested_topics' IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [strategyId]
    );

    if (rows.length === 0) {
      return [];
    }

    const suggestedTopics = rows[0]?.metadata?.suggested_topics;
    return this.normalizeAndDedupe(Array.isArray(suggestedTopics) ? suggestedTopics : [], 10, 80);
  }

  buildStrategyMetadata(existingMetadata = {}, source = 'manual_edit') {
    return this.withProductScope({
      ...(existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata) ? existingMetadata : {}),
      prompts_stale: true,
      prompts_stale_at: new Date().toISOString(),
      last_strategy_update_source: source,
    });
  }

  appendWithDuplicateTracking(existingItems = [], incomingItems = [], limit = 20, maxItemLength = 80) {
    const existingNormalized = this.normalizeAndDedupe(existingItems, limit, maxItemLength);
    const incomingNormalized = this.normalizeAndDedupe(incomingItems, limit, maxItemLength);
    const merged = [...existingNormalized];
    const seen = new Set(existingNormalized.map((item) => item.toLowerCase()));
    const added = [];
    const ignoredDuplicates = [];

    for (const item of incomingNormalized) {
      const key = item.toLowerCase();
      if (seen.has(key)) {
        ignoredDuplicates.push(item);
        continue;
      }

      if (merged.length >= limit) {
        ignoredDuplicates.push(item);
        continue;
      }

      merged.push(item);
      seen.add(key);
      added.push(item);
    }

    return {
      merged,
      added,
      ignoredDuplicates,
    };
  }

  async appendStrategyFields(strategyId, additions = {}, options = {}) {
    const source = options.source || 'manual_add_on';
    const strategy = await this.getStrategy(strategyId);
    if (!strategy) {
      return null;
    }

    const appendGoals = this.appendWithDuplicateTracking(
      strategy.content_goals || [],
      Array.isArray(additions.content_goals) ? additions.content_goals : [],
      20,
      80
    );

    const appendTopics = this.appendWithDuplicateTracking(
      strategy.topics || [],
      Array.isArray(additions.topics) ? additions.topics : [],
      20,
      80
    );

    const updatedMetadata = this.buildStrategyMetadata(strategy.metadata, source);

    const { rows } = await pool.query(
      `UPDATE user_strategies
       SET content_goals = $1,
           topics = $2,
           metadata = $3
       WHERE id = $4
         AND COALESCE(metadata->>'product', '') = $5
       RETURNING *`,
      [appendGoals.merged, appendTopics.merged, updatedMetadata, strategyId, this.productScope]
    );

    return {
      strategy: rows[0],
      added: {
        content_goals: appendGoals.added,
        topics: appendTopics.added,
      },
      ignoredDuplicates: {
        content_goals: appendGoals.ignoredDuplicates,
        topics: appendTopics.ignoredDuplicates,
      },
      promptsStale: true,
    };
  }

  // Get or create active strategy for user
  async getOrCreateStrategy(userId, teamId = null) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies 
       WHERE user_id = $1 AND (team_id = $2 OR (team_id IS NULL AND $2 IS NULL))
       AND COALESCE(metadata->>'product', '') = $3
       AND status IN ('draft', 'active')
       ORDER BY created_at DESC LIMIT 1`,
      [userId, teamId, this.productScope]
    );

    if (rows.length > 0) {
      return rows[0];
    }

    // Create new draft strategy
    const { rows: newRows } = await pool.query(
      `INSERT INTO user_strategies (user_id, team_id, status, metadata)
       VALUES ($1, $2, 'draft', $3)
       RETURNING *`,
      [userId, teamId, this.withProductScope({})]
    );

    return newRows[0];
  }

  // Create new strategy with initial data
  async createStrategy(userId, teamId = null, data = {}) {
    const {
      niche,
      target_audience,
      posting_frequency,
      content_goals,
      topics,
      status = 'draft',
      metadata = {},
    } = data;

    const scopedMetadata = this.withProductScope(metadata);

    const { rows } = await pool.query(
      `INSERT INTO user_strategies (user_id, team_id, niche, target_audience, posting_frequency, content_goals, topics, status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [userId, teamId, niche, target_audience, posting_frequency, content_goals, topics, status, scopedMetadata]
    );

    return rows[0];
  }

  // Get chat history for strategy
  async getChatHistory(strategyId, limit = 50) {
    const { rows } = await pool.query(
      `SELECT * FROM strategy_chat_history
       WHERE strategy_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [strategyId, limit]
    );
    return rows;
  }

  // Add message to chat history
  async addChatMessage(strategyId, role, message, metadata = {}) {
    const { rows } = await pool.query(
      `INSERT INTO strategy_chat_history (strategy_id, role, message, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [strategyId, role, message, metadata]
    );
    return rows[0];
  }

  // Process chat and generate AI response
  async processChatMessage(strategyId, userId, userMessage, currentStep = 0) {
    // Save user message
    await this.addChatMessage(strategyId, 'user', userMessage);

    // Helper: Detect gibberish/nonsense input
    const isGibberish = (text) => {
      const trimmed = text.trim().toLowerCase();
      
      // Too short (less than 2 characters) - but allow single valid words like "yes"
      if (trimmed.length < 2) return true;
      
      // Only special characters or numbers
      if (/^[^a-z]+$/i.test(trimmed)) return true;
      
      // Random keyboard mashing (repeating patterns)
      if (/(.)\1{4,}/.test(trimmed)) return true; // Same char 5+ times like "aaaaa"
      if (/(asdf|qwer|zxcv|hjkl|jkjk){2,}/i.test(trimmed)) return true; // Keyboard patterns
      
      // Very low vowel ratio (gibberish often lacks vowels)
      const vowels = (trimmed.match(/[aeiou]/gi) || []).length;
      const consonants = (trimmed.match(/[bcdfghjklmnpqrstvwxyz]/gi) || []).length;
      if (consonants > 0 && vowels / consonants < 0.15) return true;
      
      return false;
    };

    // Get strategy
    const strategy = await this.getStrategy(strategyId);

    if (!strategy) {
      throw new Error('Strategy not found');
    }

    const normalizedUserMessage = String(userMessage || '').trim().toLowerCase();
    const quickSetupRequested =
      currentStep > 0 &&
      /(quick setup|auto[\s-]?complete|fast track|do it for me|finish for me|use ai setup|skip questions)/i.test(
        normalizedUserMessage
      );

    if (quickSetupRequested) {
      const completedStrategy = await this.quickCompleteStrategy(strategyId, userId);
      const quickSummary = this.summarizeStrategy(completedStrategy);
      const quickResponse =
        `Quick setup complete. I filled the remaining fields using your current context.\n\n${quickSummary}\n\n` +
        'Next step: open Prompts and generate your library.';

      await this.addChatMessage(strategyId, 'assistant', quickResponse, {
        step: -1,
        quick_complete: true,
      });

      return {
        message: quickResponse,
        nextStep: -1,
        isComplete: true,
        quickReplies: null,
        placeholder: '',
        strategy: completedStrategy,
      };
    }

    // Define conversation steps
    const steps = [
      {
        key: 'welcome',
        question: "Hey! I am your Strategy Builder AI.\n\nI will help you create a personalized LinkedIn content strategy in 7 quick steps.\n\nTip: type \"quick setup\" at any time and I will auto-complete remaining steps.\n\nLet us start with the foundation. What is your niche or industry?",
        field: 'niche',
        quickReplies: ['SaaS & B2B', 'AI & Tech', 'Health & Fitness', 'Marketing & Growth', 'E-commerce', 'Content Creation', 'Finance & Investing', 'Productivity', 'Quick setup'],
        placeholder: 'e.g., B2B SaaS, AI tools, fitness coaching, anime & manga...'
      },
      {
        key: 'audience',
        question: "Perfect! Now let's define your **ideal follower**.\n\n**Who exactly are you trying to reach?**\n\nThink about:\n• Their role/title (e.g., startup founders, anime fans, fitness beginners)\n• Their main problem or goal\n• What keeps them up at night\n\nThe more specific, the better I can help!",
        field: 'target_audience',
        placeholder: 'e.g., First-time founders struggling to scale, anime fans looking for hidden gems, busy professionals wanting to get fit'
      },
      {
        key: 'goals',
        question: "Excellent! Now, **what do you want to achieve with LinkedIn?**\n\nYou can select **multiple goals** - I'll help you balance them in your content strategy:",
        field: 'content_goals',
        isArray: true,
        quickReplies: [
          '🎯 Build authority & credibility',
          '📈 Grow followers organically',
          '💬 Drive engagement & discussions',
          '💰 Generate quality leads',
          '🎓 Educate & provide value',
          '🤝 Build a community',
          '🚀 Promote products/services'
        ],
        placeholder: 'Select options above or type your own goals (comma-separated)'
      },
      {
        key: 'frequency',
        question: "Great goals! Now let's set a **realistic posting schedule**.\n\n**How often can you commit to posting?**\n\n⚡ Pro tip: Consistency beats intensity!\n\nIt's better to post **3x/week reliably** than 10x/week for 2 weeks and then burn out.\n\nWhat works for your schedule?",
        field: 'posting_frequency',
        quickReplies: [
          '📅 Daily (7x/week)',
          '🔥 5x per week',
          '✅ 3-4x per week',
          '📌 2x per week',
          '📍 Once a week'
        ],
        placeholder: 'Choose above or specify your own frequency'
      },
      {
        key: 'tone',
        question: "Nice! Now let's define **your unique voice**.\n\n**What tone(s) feel most authentic to you?**\n\nYou can **select multiple tones** - many successful creators blend different styles!\n\nYour voice is what makes you memorable:",
        field: 'tone_style',
        isArray: true,
        quickReplies: [
          '🎩 Professional & authoritative',
          '😊 Casual & conversational',
          '😄 Humorous & entertaining',
          '📚 Educational & insightful',
          '💡 Inspirational & motivating',
          '🔥 Bold & opinionated',
          '🤔 Thoughtful & analytical'
        ],
        placeholder: 'Select options above or describe your preferred style(s)'
      },
      {
        key: 'topics',
        question: "Almost done! Let's nail down your **core content pillars**.\n\n**What 3-5 topics will you consistently post about?**\n\nThese should be areas where you have:\n✅ Knowledge or expertise\n✅ Genuine interest\n✅ Value to share\n\nI'll suggest some based on your niche, or you can tell me yours.\n\nType \"use these\" to accept suggestions.\nAdd your own comma-separated topics to include with suggestions.\nUse \"only mine:\" if you want to replace suggestions:",
        field: 'topics',
        isArray: true,
        placeholder: 'Type "use these", add your own comma-separated topics to merge, or use "only mine: ..."'
      },
      {
        key: 'summary',
        question: "Perfect! 🎉\n\nYou've completed your strategy setup. Here's your personalized LinkedIn content strategy:",
        field: null,
        quickReplies: null
      }
    ];

    // Determine next step
    let nextStep = currentStep;
    let aiResponse = '';
    let isComplete = false;
    let suggestedTopicsForMessage = null;

    if (currentStep === 0) {
      // Welcome message
      aiResponse = steps[0].question;
      nextStep = 1;
    } else if (currentStep <= steps.length - 1) {
      // Update strategy with user's answer (steps 1-6)
      const currentStepData = steps[currentStep - 1];
      if (currentStepData.field) {
        const updateField = currentStepData.field;
        let value = userMessage.trim();
        
        // Validate input - reject gibberish/nonsense
        const isAcceptingSuggestions = value.toLowerCase().match(/^(use these?|accept|ok|yes|looks good|perfect)$/i);
        const isOnlyMineMode = currentStepData.key === 'topics' && /^only mine\s*:/i.test(value);
        const wantsSuggestions = value.toLowerCase().match(/(suggest|you.*tell|give.*suggest|recommend|help.*topic|what.*topic)/i)
          && !isAcceptingSuggestions
          && !isOnlyMineMode;
        const isRequestingHelp = wantsSuggestions || isAcceptingSuggestions || isOnlyMineMode;
        
        if (!isRequestingHelp && isGibberish(value)) {
          const examplesByStep = {
            'niche': 'e.g., "Anime reviews", "SaaS marketing", "Fitness coaching"',
            'target_audience': 'e.g., "Anime fans aged 18-25 who watch seasonal shows", "SaaS founders building their first product"',
            'content_goals': 'e.g., "Grow followers organically", "Drive engagement", "Build community"',
            'posting_frequency': 'e.g., "3 times per week", "Daily", "5 times per week"',
            'tone_style': 'e.g., "Professional & authoritative", "Friendly & conversational", "Humorous"',
            'topics': 'e.g., "Anime reviews, Character analysis, Hidden gems, Seasonal rankings"'
          };
          
          const errorResponse = `I didn't quite catch that! 🤔\n\nPlease provide a clear, meaningful answer for this step.\n\n${examplesByStep[currentStepData.key] || 'Example: Provide specific details relevant to the question.'}`;
          
          await this.addChatMessage(strategyId, 'assistant', errorResponse);
          return {
            message: errorResponse,
            nextStep: currentStep,
            isComplete: false,
            quickReplies: currentStepData.quickReplies || null,
            placeholder: currentStepData.placeholder || 'Type your response...',
            strategy: null
          };
        }
        const latestSuggestedTopics = currentStepData.key === 'topics'
          ? await this.getLatestSuggestedTopics(strategyId)
          : [];

        // Special handling for requesting new topic suggestions
        if (currentStepData.key === 'topics' && wantsSuggestions) {
          const { rows: strategyRows } = await pool.query(
            `SELECT niche, target_audience, content_goals FROM user_strategies WHERE id = $1
             AND COALESCE(metadata->>'product', '') = $2`,
            [strategyId, this.productScope]
          );
          const currentStrategy = strategyRows[0];
          
          if (currentStrategy.niche) {
            try {
              const topicPrompt = `Based on this LinkedIn strategy:
- Niche: ${currentStrategy.niche}
- Audience: ${currentStrategy.target_audience || 'general audience'}
- Goals: ${(currentStrategy.content_goals || []).join(', ')}

Suggest 5-7 specific, actionable content topics for this niche. Make them concrete and relevant.
Format: Just list topics separated by commas, no formatting.`;

              console.log('User requested topic suggestions for:', currentStrategy.niche);
              const result = await aiService.generateStrategyContent(topicPrompt, 'professional', null, userId);
              console.log('Generated topics result:', result);
              
              // Extract content from result object  
              const topicText = typeof result === 'string' ? result : result.content;
              // Remove any preamble text before the actual topics
              const cleanedText = topicText.replace(/^.*?:\s*\n+/i, '').trim();
              value = this.normalizeAndDedupe(this.parseCsvList(cleanedText), 10);
              console.log('Generated topic suggestions:', value);
              
              if (!value || value.length === 0) {
                throw new Error('No topics generated');
              }
            } catch (error) {
              console.error('Failed to generate topics:', error, error.stack);
              // Return error message to user instead of saving empty array
              const errorResponse = `I had trouble generating suggestions. Let me try again, or you can tell me your 3-5 core topics directly (comma-separated).\\n\\nFor example: \\"Anime reviews, Character analysis, Hidden gems, Seasonal rankings, Community discussions\\"`;
              await this.addChatMessage(strategyId, 'assistant', errorResponse);
              return {
                strategy,
                aiResponse: errorResponse,
                currentStep,
                isComplete: false
              };
            }
          }
        } else if (currentStepData.key === 'topics') {
          if (isAcceptingSuggestions) {
            value = latestSuggestedTopics;
            console.log('User accepted suggested topics:', value);
          } else if (isOnlyMineMode) {
            const onlyMineValue = value.replace(/^only mine\s*:/i, '').trim();
            value = this.normalizeAndDedupe(this.parseCsvList(onlyMineValue), 10);
          } else {
            const userTopics = this.normalizeAndDedupe(this.parseCsvList(value), 10);
            const topicBase = latestSuggestedTopics.length > 0
              ? latestSuggestedTopics
              : (Array.isArray(strategy.topics) ? strategy.topics : []);
            value = this.mergeLists(topicBase, userTopics, 10);
          }
        } else if (currentStepData.key === 'goals') {
          const existingItems = Array.isArray(strategy[updateField]) ? strategy[updateField] : [];
          const parsedItems = this.parseCsvList(value);
          value = this.mergeLists(existingItems, parsedItems, 10);
        } else if (currentStepData.isArray && Array.isArray(value) === false) {
          // Parse array values
          value = this.normalizeAndDedupe(this.parseCsvList(userMessage), 10);
        }

        // Validate topics array is not empty
        if (currentStepData.key === 'topics' && currentStepData.isArray && (!value || value.length === 0)) {
          const retryResponse = `Please provide at least 3 topics (comma-separated), type "use these" to accept suggestions, or say "suggest topics" and I'll generate some for you based on your niche!`;
          await this.addChatMessage(strategyId, 'assistant', retryResponse);
          return {
            strategy,
            aiResponse: retryResponse,
            currentStep,
            isComplete: false
          };
        }

        const updateQuery = currentStepData.isArray
          ? `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2 AND COALESCE(metadata->>'product', '') = $3`
          : `UPDATE user_strategies SET ${updateField} = $1 WHERE id = $2 AND COALESCE(metadata->>'product', '') = $3`;
        
        await pool.query(updateQuery, [value, strategyId, this.productScope]);
      }

      // Ask next question
      if (currentStep < steps.length - 1) {
        aiResponse = steps[currentStep].question;
        
        // For topics step, ALWAYS generate personalized suggestions based on niche
        if (steps[currentStep].key === 'topics') {
          const { rows: strategyRows } = await pool.query(
            `SELECT niche, target_audience, content_goals FROM user_strategies WHERE id = $1
             AND COALESCE(metadata->>'product', '') = $2`,
            [strategyId, this.productScope]
          );
          const currentStrategy = strategyRows[0];
          
          if (currentStrategy.niche) {
            try {
              console.log(`⏳ [Step 6] Generating topic suggestions for niche: ${currentStrategy.niche}...`);
              const startTime = Date.now();
              
              const topicPrompt = `Based on this LinkedIn strategy:
- Niche: ${currentStrategy.niche}
- Audience: ${currentStrategy.target_audience || 'general audience'}
- Goals: ${(currentStrategy.content_goals || []).join(', ')}

Suggest 5-7 specific, actionable content topics for this niche. Make them concrete and relevant.
Format: Just list topics separated by commas, no formatting.`;

              const result = await aiService.generateStrategyContent(topicPrompt, 'professional', null, userId);
              const elapsed = Date.now() - startTime;
              console.log(`✅ [Step 6] Topics generated in ${elapsed}ms with ${result.provider}`);
              
              // Extract content from result object
              const topicText = typeof result === 'string' ? result : result.content;
              // Remove any preamble text before the actual topics
              const cleanedText = topicText.replace(/^.*?:\s*\n+/i, '').trim();
              const topicsList = this.normalizeAndDedupe(this.parseCsvList(cleanedText), 10);
              
              if (topicsList.length > 0) {
                suggestedTopicsForMessage = topicsList;
                aiResponse = `Almost done! Based on your **${currentStrategy.niche}** niche and your goals, here are content topics I recommend:\n\n` +
                  topicsList.map((t, i) => `${i + 1}. ${t}`).join('\n') + '\n\n' +
                  `**Type \"use these\" to accept.**\n` +
                  `**Or add your own topics (comma-separated) to include with these.**\n` +
                  `**Use \"only mine:\" if you want to replace suggestions.**`;
              }
            } catch (error) {
              console.error('❌ [Step 6] Failed to generate topic suggestions:', error.message);
              // Fallback to original question
            }
          }
        }
        
        nextStep = currentStep + 1;
      } else {
        // Generate summary
        const { rows: strategyRows } = await pool.query(
          `SELECT * FROM user_strategies WHERE id = $1
           AND COALESCE(metadata->>'product', '') = $2`,
          [strategyId, this.productScope]
        );
        const updatedStrategy = strategyRows[0];

        aiResponse = `Perfect! 🎉 You've completed your LinkedIn Strategy!\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🎯 **Niche:** ${updatedStrategy.niche}\n\n` +
          `👥 **Target Audience:** ${updatedStrategy.target_audience}\n\n` +
          `📊 **Goals:**\n${(updatedStrategy.content_goals || []).map(g => `  • ${g}`).join('\\n')}\n\n` +
          `📅 **Posting Schedule:** ${updatedStrategy.posting_frequency}\n\n` +
          `🗣️ **Voice & Tone:** ${updatedStrategy.tone_style}\n\n` +
          `📝 **Core Topics:**\n${(updatedStrategy.topics || []).map(t => `  • ${t}`).join('\\n')}\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `🚀 **Next Step:** Click the "Prompts" tab above to generate your personalized prompt library!\n\n` +
          `I'll create 30+ ready-to-use LinkedIn post prompts tailored specifically to your strategy. Each prompt will help you create engaging content that resonates with your audience. ✨`;
        
        // Mark strategy as active
        await pool.query(
          `UPDATE user_strategies SET status = 'active' WHERE id = $1
           AND COALESCE(metadata->>'product', '') = $2`,
          [strategyId, this.productScope]
        );
        
        isComplete = true;
        nextStep = -1; // Signals completion
      }
    }

    // Save AI response
    const responseMetadata = { step: nextStep };
    if (Array.isArray(suggestedTopicsForMessage) && suggestedTopicsForMessage.length > 0) {
      responseMetadata.suggested_topics = suggestedTopicsForMessage;
    }
    await this.addChatMessage(strategyId, 'assistant', aiResponse, responseMetadata);

    // Get quick replies and placeholder for the question we just asked
    // If nextStep is 1, we just asked steps[0], if nextStep is 2, we just asked steps[1], etc.
    const questionStepIndex = nextStep > 0 ? nextStep - 1 : 0;
    const currentStepConfig = steps[questionStepIndex];
    const quickReplies = currentStepConfig?.quickReplies || null;
    const placeholder = currentStepConfig?.placeholder || 'Type your response...';

    const result = {
      message: aiResponse,
      nextStep,
      isComplete,
      quickReplies,
      placeholder,
      strategy: isComplete ? await this.getStrategy(strategyId) : null
    };

    console.log('📤 Strategy chat response:', {
      isComplete: result.isComplete,
      nextStep: result.nextStep,
      hasStrategy: !!result.strategy
    });

    return result;
  }

  async quickCompleteStrategy(strategyId, userId, userToken = null) {
    const strategy = await this.getStrategy(strategyId);
    if (!strategy) {
      throw new Error('Strategy not found');
    }

    const currentGoals = this.normalizeAndDedupe(
      Array.isArray(strategy.content_goals) ? strategy.content_goals : [],
      20,
      80
    );
    const currentTopics = this.normalizeAndDedupe(
      Array.isArray(strategy.topics) ? strategy.topics : [],
      20,
      80
    );

    const defaultGoals = [
      'Build authority in my niche',
      'Grow engaged followers',
      'Drive meaningful conversations',
      'Convert audience into qualified leads',
    ];
    const defaultTopics = this.normalizeAndDedupe(
      [strategy.niche, 'Beginner mistakes', 'Actionable frameworks', 'Case studies', 'Weekly insights'],
      10,
      80
    );

    let generated = {
      content_goals: [],
      topics: [],
      posting_frequency: '',
      tone_style: '',
    };

    try {
      const quickPrompt = [
        'Return ONLY valid JSON. No markdown. No extra keys.',
        'Schema:',
        '{',
        '  "content_goals": string[],',
        '  "topics": string[],',
        '  "posting_frequency": string,',
        '  "tone_style": string',
        '}',
        'Rules:',
        '- Keep goals and topics specific and beginner-friendly.',
        '- posting_frequency must be realistic (example: "3-4x per week").',
        '- tone_style should be a concise phrase.',
        `Niche: ${strategy.niche || ''}`,
        `Target audience: ${strategy.target_audience || ''}`,
        `Existing goals: ${currentGoals.join(', ')}`,
        `Existing topics: ${currentTopics.join(', ')}`,
      ].join('\n');

      const aiResult = await aiService.generateStrategyContent(
        quickPrompt,
        'professional',
        userToken,
        userId
      );
      const parsed = this.parseJSONObjectFromText(aiResult?.content || '');

      generated = {
        content_goals: this.normalizeAndDedupe(
          Array.isArray(parsed?.content_goals) ? parsed.content_goals : [],
          20,
          80
        ),
        topics: this.normalizeAndDedupe(
          Array.isArray(parsed?.topics) ? parsed.topics : [],
          10,
          80
        ),
        posting_frequency:
          typeof parsed?.posting_frequency === 'string' ? parsed.posting_frequency.trim() : '',
        tone_style: typeof parsed?.tone_style === 'string' ? parsed.tone_style.trim() : '',
      };
    } catch (error) {
      console.error('Quick strategy completion fallback:', error?.message || error);
    }

    const mergedGoals = this.mergeLists(
      currentGoals.length > 0 ? currentGoals : defaultGoals,
      generated.content_goals,
      20,
      80
    );
    const mergedTopics = this.mergeLists(
      currentTopics.length > 0 ? currentTopics : defaultTopics,
      generated.topics,
      10,
      80
    );

    const finalPostingFrequency =
      generated.posting_frequency ||
      strategy.posting_frequency ||
      '3-4x per week';
    const finalToneStyle =
      generated.tone_style ||
      strategy.tone_style ||
      'Clear, conversational, and practical';

    const updatedMetadata = {
      ...this.buildStrategyMetadata(strategy.metadata, 'quick_complete_ai'),
      quick_completed: true,
      quick_completed_at: new Date().toISOString(),
    };

    const { rows } = await pool.query(
      `UPDATE user_strategies
       SET content_goals = $1,
           topics = $2,
           posting_frequency = $3,
           tone_style = $4,
           status = 'active',
           metadata = $5
       WHERE id = $6
         AND COALESCE(metadata->>'product', '') = $7
       RETURNING *`,
      [mergedGoals, mergedTopics, finalPostingFrequency, finalToneStyle, updatedMetadata, strategyId, this.productScope]
    );

    return rows[0];
  }

  // Generate prompts for strategy
  async generatePrompts(strategyId, userId) {
    const strategy = await this.getStrategy(strategyId);
    
    if (!strategy) {
      throw new Error('Strategy not found');
    }

    try {
      const desiredCount = 36;
      const systemPrompt = [
        'Return ONLY valid JSON. No markdown and no extra text.',
        'Schema:',
        '{',
        '  "prompts": [',
        '    {',
        '      "category": "educational|engagement|storytelling|tips & tricks|promotional|inspirational",',
        '      "prompt_text": "string",',
        '      "instruction": "string",',
        '      "recommended_format": "single_post|carousel|question|poll",',
        '      "goal": "string",',
        '      "hashtags_hint": "string"',
        '    }',
        '  ]',
        '}',
        `Generate exactly ${desiredCount} prompts with balanced category distribution.`,
        'Requirements:',
        '- prompt_text should be specific and easy to execute.',
        '- instruction should be concise and practical for beginners.',
        '- avoid duplicates and generic wording.',
        '- keep prompt_text focused on one angle.',
        '- each category must contain multiple distinct frameworks, not the same sentence pattern.',
        '- avoid repeating the same first 5-6 words across prompts in the same category.',
        '- if placeholders are useful, use {placeholder_name} tokens.',
        `Niche: ${strategy.niche || ''}`,
        `Target Audience: ${strategy.target_audience || ''}`,
        `Goals: ${(strategy.content_goals || []).join(', ')}`,
        `Tone: ${strategy.tone_style || ''}`,
        `Topics: ${(strategy.topics || []).join(', ')}`,
      ].join('\n');

      let normalizedPrompts = [];
      try {
        const result = await aiService.generateStrategyContent(systemPrompt, 'professional', null, userId);
        const promptItems = this.parsePromptItemsFromContent(result?.content || '');

        normalizedPrompts = promptItems
          .map((item) => {
            const promptText = this.cleanPromptText(
              typeof item?.prompt_text === 'string'
                ? item.prompt_text.trim().replace(/\s+/g, ' ')
                : ''
            );
            const instruction = this.cleanPromptText(
              typeof item?.instruction === 'string'
                ? item.instruction.trim().replace(/\s+/g, ' ')
                : ''
            );
            const category = this.normalizePromptCategory(item?.category);

            const extractedVariables = {};
            const variableMatches = promptText.match(/\{([^}]+)\}/g);
            if (variableMatches) {
              for (const variableToken of variableMatches) {
                const key = variableToken.replace(/[{}]/g, '').trim();
                if (key) extractedVariables[key] = '';
              }
            }

            return {
              category,
              prompt_text: promptText,
              variables: {
                ...extractedVariables,
                instruction,
                recommended_format:
                  typeof item?.recommended_format === 'string'
                    ? item.recommended_format.trim().toLowerCase()
                    : 'single_post',
                goal: typeof item?.goal === 'string' ? item.goal.trim() : '',
                hashtags_hint: typeof item?.hashtags_hint === 'string' ? item.hashtags_hint.trim() : '',
              },
            };
          })
          .filter((prompt) => prompt.prompt_text.length >= 12);

        if (normalizedPrompts.length === 0) {
          throw new Error('No prompt items could be parsed from provider response');
        }
      } catch (aiParseError) {
        console.error('Prompt generation JSON parse failed, using fallback templates:', aiParseError?.message || aiParseError);
      }

      if (normalizedPrompts.length < 24) {
        const fallbackPrompts = this.buildFallbackPromptTemplates(strategy, desiredCount);
        normalizedPrompts = [...normalizedPrompts, ...fallbackPrompts];
      }

      const finalPrompts = this.selectDiverseBalancedPrompts(normalizedPrompts, desiredCount);

      if (finalPrompts.length === 0) {
        throw new Error('No prompts generated');
      }

      // Regeneration should replace existing prompt set to keep library clean.
      await pool.query(`DELETE FROM strategy_prompts WHERE strategy_id = $1`, [strategyId]);

      const insertedPrompts = [];
      for (const prompt of finalPrompts) {
        const { rows } = await pool.query(
          `INSERT INTO strategy_prompts (strategy_id, category, prompt_text, variables)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [strategyId, prompt.category, prompt.prompt_text, JSON.stringify(prompt.variables || {})]
        );
        insertedPrompts.push(rows[0]);
      }

      const refreshedMetadata = {
        ...(strategy.metadata && typeof strategy.metadata === 'object' && !Array.isArray(strategy.metadata) ? strategy.metadata : {}),
        prompts_stale: false,
        prompts_stale_at: null,
        prompts_last_generated_at: new Date().toISOString(),
      };

      await pool.query(
        `UPDATE user_strategies SET metadata = $1 WHERE id = $2
         AND COALESCE(metadata->>'product', '') = $3`,
        [this.withProductScope(refreshedMetadata), strategyId, this.productScope]
      );

      return {
        success: true,
        count: insertedPrompts.length,
        prompts: insertedPrompts
      };
    } catch (error) {
      console.error('Error generating prompts:', error);
      throw error;
    }
  }

  // Get strategy by ID
  async getStrategy(strategyId) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies WHERE id = $1
       AND COALESCE(metadata->>'product', '') = $2`,
      [strategyId, this.productScope]
    );
    return rows[0] || null;
  }

  // Get all strategies for user
  async getUserStrategies(userId, teamId = null) {
    const { rows } = await pool.query(
      `SELECT * FROM user_strategies 
       WHERE user_id = $1 AND (team_id = $2 OR (team_id IS NULL AND $2 IS NULL))
       AND COALESCE(metadata->>'product', '') = $3
       ORDER BY created_at DESC`,
      [userId, teamId, this.productScope]
    );
    return rows;
  }

  // Get prompts for strategy
  async getPrompts(strategyId, filters = {}) {
    let query = `SELECT * FROM strategy_prompts WHERE strategy_id = $1`;
    const params = [strategyId];
    
    if (filters.category) {
      params.push(filters.category);
      query += ` AND category = $${params.length}`;
    }
    
    if (filters.isFavorite) {
      query += ` AND is_favorite = true`;
    }
    
    query += ` ORDER BY created_at DESC`;
    
    if (filters.limit) {
      params.push(filters.limit);
      query += ` LIMIT $${params.length}`;
    }

    const { rows } = await pool.query(query, params);
    return rows;
  }

  // Update strategy
  async updateStrategy(strategyId, updates) {
    const nextUpdates = { ...updates };
    const promptRelevantFields = [
      'niche',
      'target_audience',
      'posting_frequency',
      'tone_style',
      'content_goals',
      'topics',
    ];
    const touchesPromptRelevantFields = promptRelevantFields
      .some((field) => Object.prototype.hasOwnProperty.call(nextUpdates, field));
    const touchesGoals = Object.prototype.hasOwnProperty.call(nextUpdates, 'content_goals');
    const touchesTopics = Object.prototype.hasOwnProperty.call(nextUpdates, 'topics');

    if (touchesGoals) {
      nextUpdates.content_goals = this.normalizeAndDedupe(
        Array.isArray(nextUpdates.content_goals) ? nextUpdates.content_goals : [],
        20,
        80
      );
    }

    if (touchesTopics) {
      nextUpdates.topics = this.normalizeAndDedupe(
        Array.isArray(nextUpdates.topics) ? nextUpdates.topics : [],
        20,
        80
      );
    }

    if (touchesPromptRelevantFields) {
      const strategy = await this.getStrategy(strategyId);
      const incomingMetadata = nextUpdates.metadata && typeof nextUpdates.metadata === 'object' && !Array.isArray(nextUpdates.metadata)
        ? nextUpdates.metadata
        : {};
      nextUpdates.metadata = this.buildStrategyMetadata(
        { ...(strategy?.metadata || {}), ...incomingMetadata },
        incomingMetadata.last_strategy_update_source || 'manual_edit'
      );
    }

    const allowedFields = [
      'niche',
      'target_audience',
      'content_goals',
      'posting_frequency',
      'tone_style',
      'topics',
      'status',
      'metadata',
    ];
    const fields = Object.keys(nextUpdates).filter(f => allowedFields.includes(f));
    
    if (fields.length === 0) {
      return null;
    }

    const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = [strategyId, ...fields.map(f => nextUpdates[f])];

    const { rows } = await pool.query(
      `UPDATE user_strategies SET ${setClause}
       WHERE id = $1
         AND COALESCE(metadata->>'product', '') = $${values.length + 1}
       RETURNING *`,
      [...values, this.productScope]
    );

    return rows[0];
  }

  // Toggle favorite prompt
  async toggleFavoritePrompt(promptId) {
    const { rows } = await pool.query(
      `UPDATE strategy_prompts 
       SET is_favorite = NOT is_favorite 
       WHERE id = $1 
       RETURNING *`,
      [promptId]
    );
    return rows[0];
  }

  // Delete strategy
  async deleteStrategy(strategyId, userId) {
    await pool.query(
      `DELETE FROM user_strategies
       WHERE id = $1 AND user_id = $2
         AND COALESCE(metadata->>'product', '') = $3`,
      [strategyId, userId, this.productScope]
    );
  }
}

export const strategyService = new StrategyService();
export default strategyService;



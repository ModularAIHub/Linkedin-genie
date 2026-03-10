import crypto from 'crypto';
import { pool } from '../config/database.js';
import contextVaultService from './contextVaultService.js';
import personaVaultService from './personaVaultService.js';

const PRODUCT_SCOPE = 'linkedin-genie';

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

const sanitizeText = (value = '') =>
  String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toShortText = (value = '', max = 220) => {
  const normalized = sanitizeText(value);
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 220;
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

const countFrequency = (items = []) => {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const value = toShortText(item, 120).toLowerCase();
    if (!value) continue;
    map.set(value, (map.get(value) || 0) + 1);
  }
  return map;
};

const sortByFrequency = (frequencyMap = new Map(), max = 12) =>
  [...frequencyMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([topic]) => topic);

class AdaptiveVaultLoopService {
  mapRun(row = null) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      status: String(row.status || 'completed').toLowerCase(),
      reason: toShortText(row.reason || 'manual', 64),
      summary: parseJsonObject(row.summary, {}),
      metadata: parseJsonObject(row.metadata, {}),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  async getLatestRun({ userId } = {}) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_adaptive_vault_runs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    return this.mapRun(rows[0] || null);
  }

  async runForUser({ userId, reason = 'manual', includeContextRefresh = true } = {}) {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    let contextRefreshSummary = null;
    if (includeContextRefresh) {
      contextRefreshSummary = await contextVaultService.refreshAllForUser({
        userId,
        reason: 'adaptive_loop_refresh',
      });
    }

    const [strategyRows, vaultRows] = await Promise.all([
      pool.query(
        `SELECT id, user_id, niche, target_audience, topics, metadata
         FROM user_strategies
         WHERE user_id = $1
           AND COALESCE(metadata->>'product', '') = $2
           AND status IN ('active', 'draft')
         ORDER BY updated_at DESC
         LIMIT 16`,
        [userId, PRODUCT_SCOPE]
      ),
      pool.query(
        `SELECT strategy_id, snapshot, metadata, last_refreshed_at
         FROM linkedin_context_vault
         WHERE user_id = $1
         ORDER BY last_refreshed_at DESC
         LIMIT 24`,
        [userId]
      ),
    ]);

    const strategies = Array.isArray(strategyRows?.rows) ? strategyRows.rows : [];
    const vaults = Array.isArray(vaultRows?.rows) ? vaultRows.rows : [];
    const vaultByStrategy = new Map(
      vaults.map((row) => [String(row.strategy_id), row])
    );

    const allWinning = [];
    const allUnderused = [];
    const allAngles = [];
    const allVoice = [];
    const allRejectionReasons = [];
    const allAnalyticsTopics = [];

    for (const row of vaults) {
      const snapshot = parseJsonObject(row.snapshot, {});
      const discoveries = parseJsonObject(snapshot.discoveries, {});
      const feedback = parseJsonObject(snapshot.feedback, {});
      const reviews = parseJsonObject(feedback.reviews, {});
      const analyticsLearning = parseJsonObject(feedback.analyticsLearning, {});

      allWinning.push(...(Array.isArray(discoveries.winningTopics) ? discoveries.winningTopics : []));
      allUnderused.push(...(Array.isArray(discoveries.underusedTopics) ? discoveries.underusedTopics : []));
      allAngles.push(...(Array.isArray(discoveries.nextAngles) ? discoveries.nextAngles : []));
      allVoice.push(...(Array.isArray(discoveries.voiceSignals) ? discoveries.voiceSignals : []));
      allAnalyticsTopics.push(...(Array.isArray(analyticsLearning.bestTopics) ? analyticsLearning.bestTopics : []));
      allRejectionReasons.push(
        ...((Array.isArray(reviews.topRejectionReasons) ? reviews.topRejectionReasons : [])
          .map((item) => toShortText(item?.reason || '', 120))
          .filter(Boolean))
      );
    }

    const globalWinning = dedupeStrings(
      [
        ...sortByFrequency(countFrequency(allWinning), 10),
        ...sortByFrequency(countFrequency(allAnalyticsTopics), 8),
      ],
      14
    );
    const globalUnderused = dedupeStrings(sortByFrequency(countFrequency(allUnderused), 10), 12);
    const globalAngles = dedupeStrings(allAngles, 18);
    const globalVoiceSignals = dedupeStrings(allVoice, 12);
    const globalRejectionReasons = dedupeStrings(allRejectionReasons, 12);

    const personaUpdate = await personaVaultService.upsert({
      userId,
      status: 'ready',
      signals: {
        topic_signals: dedupeStrings([
          ...globalWinning,
          ...globalUnderused,
          ...globalAngles,
        ], 24),
        proof_points: dedupeStrings([
          ...globalAngles,
          ...globalRejectionReasons.map((reason) => `Avoid rejection pattern: ${reason}`),
        ], 18),
      },
      sourceHealth: {
        adaptive_loop: {
          status: 'ready',
          strategies_count: strategies.length,
          vault_count: vaults.length,
          updated_at: new Date().toISOString(),
        },
      },
      evidenceSummary: {
        highlights: dedupeStrings([
          ...globalWinning,
          ...globalAngles,
          ...globalVoiceSignals,
        ], 20),
        sources: [
          {
            family: 'cross_strategy_vault',
            count: vaults.length,
            freshness: new Date().toISOString(),
          },
        ],
      },
      metadata: {
        adaptive_loop_last_run_id: runId,
        adaptive_loop_last_run_at: new Date().toISOString(),
      },
      reason: 'adaptive_vault_loop',
    });

    const perStrategyRecommendations = [];
    for (const strategy of strategies) {
      const strategyId = String(strategy.id);
      const currentTopics = dedupeStrings(Array.isArray(strategy.topics) ? strategy.topics : [], 20);
      const suggested = dedupeStrings(
        [
          ...globalWinning.filter((topic) => !currentTopics.includes(topic)),
          ...globalUnderused.filter((topic) => !currentTopics.includes(topic)),
        ],
        8
      );
      const vault = vaultByStrategy.get(strategyId);
      const strategyMetadata = parseJsonObject(strategy.metadata, {});
      const nextMetadata = {
        ...strategyMetadata,
        adaptive_loop: {
          last_run_id: runId,
          last_run_at: new Date().toISOString(),
          strategy_id: strategyId,
          has_context_vault: Boolean(vault),
          recommended_topics: suggested,
          global_winning_topics: globalWinning.slice(0, 10),
          global_underused_topics: globalUnderused.slice(0, 8),
          global_voice_signals: globalVoiceSignals.slice(0, 8),
          global_rejection_patterns: globalRejectionReasons.slice(0, 8),
        },
      };

      await pool.query(
        `UPDATE user_strategies
         SET metadata = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2
           AND user_id = $3`,
        [JSON.stringify(nextMetadata), strategyId, userId]
      );

      perStrategyRecommendations.push({
        strategyId,
        recommendedTopics: suggested,
      });
    }

    const summary = {
      run_id: runId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      strategy_count: strategies.length,
      vault_count: vaults.length,
      global_winning_topics: globalWinning.slice(0, 12),
      global_underused_topics: globalUnderused.slice(0, 10),
      global_angles: globalAngles.slice(0, 10),
      global_voice_signals: globalVoiceSignals.slice(0, 8),
      global_rejection_patterns: globalRejectionReasons.slice(0, 8),
      context_refresh: contextRefreshSummary || null,
      persona_vault_id: personaUpdate?.id || null,
      persona_last_enriched_at: personaUpdate?.lastEnrichedAt || null,
      per_strategy_recommendations: perStrategyRecommendations,
    };

    const { rows } = await pool.query(
      `INSERT INTO linkedin_adaptive_vault_runs (
         user_id, status, reason, summary, metadata, created_at, updated_at
       ) VALUES (
         $1, 'completed', $2, $3::jsonb, $4::jsonb, NOW(), NOW()
       )
       RETURNING *`,
      [
        userId,
        toShortText(reason, 64) || 'manual',
        JSON.stringify(summary),
        JSON.stringify({
          run_id: runId,
          include_context_refresh: Boolean(includeContextRefresh),
        }),
      ]
    );

    return {
      run: this.mapRun(rows[0] || null),
      summary,
      personaVault: personaUpdate,
      contextRefresh: contextRefreshSummary,
    };
  }
}

const adaptiveVaultLoopService = new AdaptiveVaultLoopService();
export default adaptiveVaultLoopService;

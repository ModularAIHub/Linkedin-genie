import { pool } from '../config/database.js';

const SOURCE_RETENTION_DAYS = 30;

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

const sanitizeText = (value = '') =>
  String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const toShortText = (value = '', max = 320) => {
  const cleaned = sanitizeText(value);
  if (!cleaned) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 320;
  return cleaned.slice(0, safeMax);
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

const mergeStringList = (left = [], right = [], max = 20) =>
  dedupeStrings([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])], max);

const normalizeSignals = (signals = {}) => {
  const base = parseJsonObject(signals, {});
  return {
    niche_candidates: mergeStringList(base.niche_candidates, [], 16),
    audience_candidates: mergeStringList(base.audience_candidates, [], 16),
    proof_points: mergeStringList(base.proof_points, [], 24),
    skills: mergeStringList(base.skills, [], 30),
    projects: mergeStringList(base.projects, [], 24),
    topic_signals: mergeStringList(base.topic_signals, [], 24),
    about: toShortText(base.about, 900),
    experience: toShortText(base.experience, 1200),
    resume_highlights: mergeStringList(base.resume_highlights, [], 16),
    website_highlights: mergeStringList(base.website_highlights, [], 16),
    external_profiles: {
      linkedin: mergeStringList(base.external_profiles?.linkedin, [], 8),
      x: mergeStringList(base.external_profiles?.x, [], 8),
      github: mergeStringList(base.external_profiles?.github, [], 8),
      other: mergeStringList(base.external_profiles?.other, [], 12),
    },
  };
};

const normalizeSourceHealth = (value = {}) => {
  const raw = parseJsonObject(value, {});
  return {
    resume: parseJsonObject(raw.resume, {}),
    website: parseJsonObject(raw.website, {}),
    external_profiles: parseJsonObject(raw.external_profiles, {}),
    competitors: parseJsonObject(raw.competitors, {}),
    updated_at: raw.updated_at || new Date().toISOString(),
  };
};

const normalizeEvidenceSummary = (value = {}) => {
  const raw = parseJsonObject(value, {});
  return {
    highlights: mergeStringList(raw.highlights, [], 20),
    sources: Array.isArray(raw.sources)
      ? raw.sources
          .map((item) => ({
            family: toShortText(item?.family || '', 40),
            count: Number(item?.count || 0),
            freshness: toShortText(item?.freshness || '', 48),
          }))
          .filter((item) => item.family)
          .slice(0, 16)
      : [],
    updated_at: raw.updated_at || new Date().toISOString(),
  };
};

const mapVaultRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: String(row.status || 'ready').toLowerCase(),
    signals: normalizeSignals(row.signals),
    sourceHealth: normalizeSourceHealth(row.source_health),
    evidenceSummary: normalizeEvidenceSummary(row.evidence_summary),
    metadata: parseJsonObject(row.metadata, {}),
    lastEnrichedAt: row.last_enriched_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

class PersonaVaultService {
  async getByUser({ userId } = {}) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_persona_vault
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    return mapVaultRow(rows[0] || null);
  }

  mergeSignals(existing = {}, incoming = {}) {
    const left = normalizeSignals(existing);
    const right = normalizeSignals(incoming);
    return {
      niche_candidates: mergeStringList(left.niche_candidates, right.niche_candidates, 18),
      audience_candidates: mergeStringList(left.audience_candidates, right.audience_candidates, 18),
      proof_points: mergeStringList(left.proof_points, right.proof_points, 28),
      skills: mergeStringList(left.skills, right.skills, 36),
      projects: mergeStringList(left.projects, right.projects, 28),
      topic_signals: mergeStringList(left.topic_signals, right.topic_signals, 28),
      about: toShortText(right.about || left.about || '', 1200),
      experience: toShortText(right.experience || left.experience || '', 1500),
      resume_highlights: mergeStringList(left.resume_highlights, right.resume_highlights, 20),
      website_highlights: mergeStringList(left.website_highlights, right.website_highlights, 20),
      external_profiles: {
        linkedin: mergeStringList(left.external_profiles.linkedin, right.external_profiles.linkedin, 10),
        x: mergeStringList(left.external_profiles.x, right.external_profiles.x, 10),
        github: mergeStringList(left.external_profiles.github, right.external_profiles.github, 10),
        other: mergeStringList(left.external_profiles.other, right.external_profiles.other, 14),
      },
    };
  }

  async upsert({
    userId,
    status = 'ready',
    signals = {},
    sourceHealth = {},
    evidenceSummary = {},
    metadata = {},
    reason = 'persona_enrichment',
    enrichedAt = new Date().toISOString(),
  } = {}) {
    const current = await this.getByUser({ userId });
    const mergedSignals = this.mergeSignals(current?.signals || {}, signals);
    const mergedSourceHealth = normalizeSourceHealth({
      ...(current?.sourceHealth || {}),
      ...sourceHealth,
      updated_at: new Date().toISOString(),
    });
    const mergedEvidence = normalizeEvidenceSummary({
      ...(current?.evidenceSummary || {}),
      ...evidenceSummary,
      updated_at: new Date().toISOString(),
    });
    const mergedMetadata = {
      ...(current?.metadata || {}),
      ...(parseJsonObject(metadata, {})),
      last_reason: toShortText(reason, 80),
      last_updated_at: new Date().toISOString(),
    };

    const { rows } = await pool.query(
      `INSERT INTO linkedin_persona_vault (
         user_id, status, signals, source_health, evidence_summary, metadata, last_enriched_at, updated_at
       )
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         status = EXCLUDED.status,
         signals = EXCLUDED.signals,
         source_health = EXCLUDED.source_health,
         evidence_summary = EXCLUDED.evidence_summary,
         metadata = EXCLUDED.metadata,
         last_enriched_at = EXCLUDED.last_enriched_at,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        String(status || 'ready').toLowerCase(),
        JSON.stringify(mergedSignals || {}),
        JSON.stringify(mergedSourceHealth || {}),
        JSON.stringify(mergedEvidence || {}),
        JSON.stringify(mergedMetadata || {}),
        enrichedAt,
      ]
    );

    return mapVaultRow(rows[0] || null);
  }

  async storeSourceSnapshots({ userId, snapshots = [] } = {}) {
    const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];
    if (safeSnapshots.length === 0) return { inserted: 0 };

    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const item of safeSnapshots.slice(0, 40)) {
        const sourceType = toShortText(item?.source_type || item?.sourceType || '', 32).toLowerCase();
        if (!sourceType) continue;
        const sourceKey = toShortText(item?.source_key || item?.sourceKey || '', 260) || null;
        const snapshot = parseJsonObject(item?.snapshot, {});
        const metadata = parseJsonObject(item?.metadata, {});
        await client.query(
          `INSERT INTO linkedin_persona_source_snapshots (
             user_id, source_type, source_key, snapshot, metadata, captured_at, expires_at
           ) VALUES (
             $1, $2, $3, $4::jsonb, $5::jsonb, NOW(), NOW() + ($6::text || ' days')::interval
           )`,
          [userId, sourceType, sourceKey, JSON.stringify(snapshot), JSON.stringify(metadata), String(SOURCE_RETENTION_DAYS)]
        );
        inserted += 1;
      }
      await client.query(
        `DELETE FROM linkedin_persona_source_snapshots
         WHERE user_id = $1
           AND expires_at < NOW()`,
        [userId]
      );
      await client.query('COMMIT');
      return { inserted };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveSnapshots({ userId, limit = 40 } = {}) {
    const safeLimit = Math.max(1, Math.min(120, Number(limit) || 40));
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_persona_source_snapshots
       WHERE user_id = $1
         AND expires_at >= NOW()
       ORDER BY captured_at DESC
       LIMIT $2`,
      [userId, safeLimit]
    );
    return rows.map((row) => ({
      id: row.id,
      sourceType: row.source_type,
      sourceKey: row.source_key || null,
      snapshot: parseJsonObject(row.snapshot, {}),
      metadata: parseJsonObject(row.metadata, {}),
      capturedAt: row.captured_at || null,
      expiresAt: row.expires_at || null,
    }));
  }

  buildStrategyPersonaSummary(vault = null) {
    if (!vault) return null;
    return {
      status: vault.status,
      last_enriched_at: vault.lastEnrichedAt,
      source_health: vault.sourceHealth,
      evidence_summary: vault.evidenceSummary,
      signals: {
        niche_candidates: mergeStringList(vault.signals?.niche_candidates, [], 8),
        audience_candidates: mergeStringList(vault.signals?.audience_candidates, [], 8),
        proof_points: mergeStringList(vault.signals?.proof_points, [], 10),
        skills: mergeStringList(vault.signals?.skills, [], 14),
        projects: mergeStringList(vault.signals?.projects, [], 10),
        topic_signals: mergeStringList(vault.signals?.topic_signals, [], 12),
        about: toShortText(vault.signals?.about || '', 380),
        experience: toShortText(vault.signals?.experience || '', 420),
        external_profiles: {
          linkedin: mergeStringList(vault.signals?.external_profiles?.linkedin, [], 6),
          x: mergeStringList(vault.signals?.external_profiles?.x, [], 6),
          github: mergeStringList(vault.signals?.external_profiles?.github, [], 6),
        },
      },
    };
  }

  async attachToStrategy({ userId, strategyId, source = 'persona_attach' } = {}) {
    const vault = await this.getByUser({ userId });
    if (!vault) {
      return { attached: false, vault: null };
    }

    const summary = this.buildStrategyPersonaSummary(vault);
    await pool.query(
      `UPDATE user_strategies
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
         AND user_id = $3`,
      [
        JSON.stringify({
          persona_vault: {
            ...summary,
            attached_at: new Date().toISOString(),
            attached_source: toShortText(source, 80) || 'persona_attach',
          },
        }),
        strategyId,
        userId,
      ]
    );

    return {
      attached: true,
      vault,
      summary,
    };
  }
}

const personaVaultService = new PersonaVaultService();
export default personaVaultService;

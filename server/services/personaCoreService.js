import crypto from 'crypto';
import axios from 'axios';
import { pool } from '../config/database.js';
import linkedinAutomationService from './linkedinAutomationService.js';
import personaVaultService from './personaVaultService.js';

const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const PAGE_BUDGET_DEFAULT = 6;
const PAGE_BUDGET_MAX = 10;
const FETCH_TIMEOUT_MS = 10000;

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
    const value = toShortText(item, 220);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

const normalizeUrl = (value = '', base = null) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (!/^https?:$/i.test(url.protocol)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
};

const safeJsonStringify = (value, fallback = '{}') => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? fallback : serialized;
  } catch {
    return fallback;
  }
};

const htmlToText = (html = '') =>
  sanitizeText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec) || 32))
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
  );

const extractLinksFromHtml = (html = '', baseUrl = '') => {
  const urls = [];
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match = regex.exec(String(html || ''));
  while (match) {
    const normalized = normalizeUrl(match[1], baseUrl);
    if (normalized) urls.push(normalized);
    match = regex.exec(String(html || ''));
  }
  return dedupeStrings(urls, 200);
};

const decodePdfLiteral = (raw = '') =>
  String(raw || '')
    .replace(/\\\r?\n/g, '')
    .replace(/\\([0-7]{1,3})/g, (_m, octal) => String.fromCharCode(Number.parseInt(octal, 8) || 32))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');

const extractPdfText = (buffer = Buffer.alloc(0)) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';
  const binary = buffer.toString('latin1');
  const chunks = [];
  const textRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match = textRegex.exec(binary);
  while (match) {
    chunks.push(decodePdfLiteral(match[1]));
    match = textRegex.exec(binary);
  }
  const arrRegex = /\[((?:[^\]\\]|\\.|\\\])*)\]\s*TJ/g;
  match = arrRegex.exec(binary);
  while (match) {
    const group = String(match[1] || '');
    const innerRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let inner = innerRegex.exec(group);
    while (inner) {
      chunks.push(decodePdfLiteral(inner[1]));
      inner = innerRegex.exec(group);
    }
    match = arrRegex.exec(binary);
  }
  return sanitizeText(chunks.join('\n'));
};

const extractExternalProfiles = (text = '', links = []) => {
  const candidates = [...(Array.isArray(links) ? links : [])];
  const regex =
    /(https?:\/\/(?:www\.)?(?:linkedin\.com\/(?:in|company)\/[a-zA-Z0-9._-]+|x\.com\/[a-zA-Z0-9_]+|twitter\.com\/[a-zA-Z0-9_]+|github\.com\/[a-zA-Z0-9_.-]+))/gi;
  let match = regex.exec(String(text || ''));
  while (match) {
    candidates.push(match[1]);
    match = regex.exec(String(text || ''));
  }

  const grouped = { linkedin: [], x: [], github: [], other: [] };
  for (const value of candidates) {
    const url = normalizeUrl(value);
    if (!url) continue;
    const lower = url.toLowerCase();
    if (/linkedin\.com\/(in|company)\//i.test(lower)) grouped.linkedin.push(url);
    else if (/x\.com\/|twitter\.com\//i.test(lower)) grouped.x.push(url);
    else if (/github\.com\//i.test(lower)) grouped.github.push(url);
    else grouped.other.push(url);
  }
  return {
    linkedin: dedupeStrings(grouped.linkedin, 8),
    x: dedupeStrings(grouped.x, 8),
    github: dedupeStrings(grouped.github, 8),
    other: dedupeStrings(grouped.other, 12),
  };
};

const extractSkills = (text = '', max = 28) => {
  const lower = String(text || '').toLowerCase();
  const dictionary = [
    'react', 'next.js', 'node', 'typescript', 'javascript', 'python', 'go', 'docker', 'kubernetes',
    'aws', 'azure', 'gcp', 'postgres', 'mongodb', 'redis', 'graphql', 'seo', 'devops', 'ci/cd',
    'security', 'api', 'automation',
  ];
  const hits = [];
  for (const word of dictionary) {
    if (lower.includes(word)) hits.push(word);
  }
  return dedupeStrings(hits, max).map((value) => value.replace(/^./, (c) => c.toUpperCase()));
};

const extractKeywords = (text = '', max = 20) => {
  const stop = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'our',
    'linkedin', 'content', 'strategy', 'social', 'media', 'suitegenie', 'build',
  ]);
  const frequencies = new Map();
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const token of cleaned.split(' ')) {
    if (!token || token.length < 3 || stop.has(token)) continue;
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }
  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
};

class PersonaCoreService {
  constructor() {
    this.activeJobs = new Map();
  }

  mapJob(row = null) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      strategyId: row.strategy_id || null,
      runId: row.run_id || null,
      status: String(row.status || 'queued').toLowerCase(),
      stage: String(row.stage || 'queued').toLowerCase(),
      progress: Number(row.progress || 0),
      inputs: parseJsonObject(row.inputs, {}),
      result: parseJsonObject(row.result, {}),
      errorCode: row.error_code || null,
      errorMessage: row.error_message || null,
      startedAt: row.started_at || null,
      completedAt: row.completed_at || null,
      metadata: parseJsonObject(row.metadata, {}),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
  }

  async getJob({ userId, jobId } = {}) {
    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_persona_enrichment_jobs
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [jobId, userId]
    );
    return rows[0] || null;
  }

  async updateJob(jobId, patch = {}) {
    const { rows: currentRows } = await pool.query(
      `SELECT * FROM linkedin_persona_enrichment_jobs WHERE id = $1 LIMIT 1`,
      [jobId]
    );
    const current = currentRows[0] || null;
    if (!current) return null;

    const nextResult = { ...parseJsonObject(current.result, {}), ...parseJsonObject(patch.result, {}) };
    const nextMetadata = { ...parseJsonObject(current.metadata, {}), ...parseJsonObject(patch.metadata, {}) };

    const { rows } = await pool.query(
      `UPDATE linkedin_persona_enrichment_jobs
       SET status = COALESCE($2, status),
           stage = COALESCE($3, stage),
           progress = COALESCE($4, progress),
           result = $5::jsonb,
           error_code = $6,
           error_message = $7,
           started_at = COALESCE($8, started_at),
           completed_at = COALESCE($9, completed_at),
           metadata = $10::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        jobId,
        patch.status || null,
        patch.stage || null,
        Number.isFinite(Number(patch.progress)) ? Number(patch.progress) : null,
        safeJsonStringify(nextResult, '{}'),
        patch.errorCode || null,
        patch.errorMessage || null,
        patch.startedAt || null,
        patch.completedAt || null,
        safeJsonStringify(nextMetadata, '{}'),
      ]
    );
    return rows[0] || null;
  }

  async fetchHtml(url) {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      validateStatus: () => true,
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SuiteGeniePersonaBot/1.0; +https://suitegenie.in)',
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`http_${response.status}`);
    }
    return typeof response.data === 'string' ? response.data : safeJsonStringify(response.data, '{}');
  }

  async crawlWebsite(url, pageBudget = PAGE_BUDGET_DEFAULT) {
    const baseUrl = normalizeUrl(url);
    if (!baseUrl) {
      return { success: false, pages: [], links: [], errors: ['invalid_url'], pageBudget: 0 };
    }
    const budget = Math.max(1, Math.min(PAGE_BUDGET_MAX, Number(pageBudget) || PAGE_BUDGET_DEFAULT));
    const base = new URL(baseUrl);
    const queue = [baseUrl];
    const visited = new Set();
    const pages = [];
    const links = [];
    const errors = [];

    while (queue.length > 0 && pages.length < budget) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      try {
        const html = await this.fetchHtml(current);
        const text = htmlToText(html);
        const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = toShortText(titleMatch?.[1] || '', 180);
        pages.push({
          url: current,
          title,
          text: toShortText(text, 3200),
          description: toShortText(text, 280),
        });

        const nextLinks = extractLinksFromHtml(html, current);
        for (const link of nextLinks) {
          links.push(link);
          try {
            const parsed = new URL(link);
            if (parsed.hostname === base.hostname && !visited.has(link) && !queue.includes(link)) {
              queue.push(link);
            }
          } catch {
            // ignore
          }
        }
      } catch (error) {
        errors.push(`${current}:${error?.message || 'fetch_failed'}`);
      }
    }

    return {
      success: pages.length > 0,
      pages,
      links: dedupeStrings(links, 200),
      errors,
      pageBudget: budget,
    };
  }

  parseResume(base64 = '', filename = 'resume.pdf') {
    const normalized = String(base64 || '').replace(/^data:application\/pdf;base64,/i, '').trim();
    if (!normalized) {
      return { success: false, error: 'not_provided', text: '', links: [], filename };
    }
    let buffer;
    try {
      buffer = Buffer.from(normalized, 'base64');
    } catch {
      return { success: false, error: 'invalid_base64', text: '', links: [], filename };
    }
    if (!buffer || buffer.length < 100 || buffer.length > MAX_RESUME_BYTES) {
      return { success: false, error: 'invalid_resume_size', text: '', links: [], filename };
    }
    const text = extractPdfText(buffer);
    const links = extractExternalProfiles(text, []).linkedin
      .concat(extractExternalProfiles(text, []).x, extractExternalProfiles(text, []).github);
    return {
      success: Boolean(text),
      error: text ? null : 'resume_parse_failed',
      text: toShortText(text, 9000),
      links: dedupeStrings(links, 24),
      filename: toShortText(filename, 180),
    };
  }

  buildSignals({ profileContext = {}, resume = {}, website = {}, external = {} } = {}) {
    const metadata = parseJsonObject(profileContext.metadata, {});
    const websiteText = Array.isArray(website.pages) ? website.pages.map((page) => page.text || '').join(' ') : '';
    const resumeText = String(resume.text || '');
    const mergedText = `${resumeText}\n${websiteText}`;

    return {
      niche_candidates: dedupeStrings([
        profileContext.role_niche,
        metadata.profile_headline,
        ...extractKeywords(mergedText, 16),
      ], 16),
      audience_candidates: dedupeStrings([
        profileContext.target_audience,
        profileContext.outcomes_30_90,
      ], 12),
      proof_points: dedupeStrings([
        profileContext.proof_points,
        profileContext.outcomes_30_90,
        ...extractKeywords(mergedText, 8).map((word) => `Evidence around ${word}`),
      ], 16),
      skills: dedupeStrings([
        ...(Array.isArray(metadata.linkedin_skills) ? metadata.linkedin_skills : []),
        ...(Array.isArray(metadata.portfolio_skills) ? metadata.portfolio_skills : []),
        ...extractSkills(mergedText, 24),
      ], 32),
      projects: dedupeStrings([
        metadata.portfolio_title,
        ...((Array.isArray(website.pages) ? website.pages : []).map((page) => page.title || '')),
      ], 20),
      topic_signals: dedupeStrings(extractKeywords(mergedText, 24), 24),
      about: toShortText(metadata.linkedin_about || metadata.portfolio_about || mergedText, 1200),
      experience: toShortText(metadata.linkedin_experience || metadata.portfolio_experience || mergedText, 1400),
      resume_highlights: dedupeStrings([resume.text], 8),
      website_highlights: dedupeStrings((website.pages || []).map((page) => page.description || ''), 12),
      external_profiles: external,
    };
  }

  runJobInBackground(jobId) {
    if (this.activeJobs.has(jobId)) return;
    const promise = this.processJob(jobId)
      .catch((error) => {
        console.error('[PersonaCore] job failed', { jobId, error: error?.message || error });
      })
      .finally(() => {
        this.activeJobs.delete(jobId);
      });
    this.activeJobs.set(jobId, promise);
  }

  async processJob(jobId) {
    const { rows } = await pool.query(
      `SELECT * FROM linkedin_persona_enrichment_jobs WHERE id = $1 LIMIT 1`,
      [jobId]
    );
    const job = rows[0] || null;
    if (!job) return null;

    const userId = job.user_id;
    const strategyId = job.strategy_id || null;
    const inputs = parseJsonObject(job.inputs, {});
    const profileContext = linkedinAutomationService.mapProfileContext(
      await linkedinAutomationService.getProfileContextRow(userId)
    );

    try {
      await this.updateJob(jobId, {
        status: 'running',
        stage: 'resume_parse',
        progress: 15,
        startedAt: new Date().toISOString(),
      });

      const resume = this.parseResume(inputs.resume_base64 || '', inputs.resume_filename || 'resume.pdf');

      await this.updateJob(jobId, {
        stage: 'website_crawl',
        progress: 40,
        result: {
          resume: {
            success: resume.success,
            error: resume.error,
            text_length: String(resume.text || '').length,
          },
        },
      });

      const website = inputs.website_url ? await this.crawlWebsite(inputs.website_url, PAGE_BUDGET_DEFAULT) : {
        success: false,
        pages: [],
        links: [],
        errors: ['not_provided'],
        pageBudget: 0,
      };

      await this.updateJob(jobId, {
        stage: 'external_profiles',
        progress: 65,
        result: {
          website: {
            success: website.success,
            pages_fetched: Array.isArray(website.pages) ? website.pages.length : 0,
            errors: Array.isArray(website.errors) ? website.errors.slice(0, 6) : [],
          },
        },
      });

      const external = extractExternalProfiles(
        `${resume.text}\n${(website.pages || []).map((page) => page.text || '').join(' ')}`,
        [...(resume.links || []), ...(website.links || [])]
      );
      const signals = this.buildSignals({ profileContext, resume, website, external });
      const sourceHealth = {
        resume: {
          status: resume.success ? 'ready' : (resume.error === 'not_provided' ? 'not_provided' : 'failed'),
          text_length: String(resume.text || '').length,
          error: resume.error || null,
          updated_at: new Date().toISOString(),
        },
        website: {
          status: website.success ? 'ready' : (inputs.website_url ? 'partial' : 'not_provided'),
          pages_fetched: Array.isArray(website.pages) ? website.pages.length : 0,
          page_budget: Number(website.pageBudget || 0),
          errors: Array.isArray(website.errors) ? website.errors.slice(0, 6) : [],
          updated_at: new Date().toISOString(),
        },
        external_profiles: {
          status: 'ready',
          found_count: external.linkedin.length + external.x.length + external.github.length + external.other.length,
          updated_at: new Date().toISOString(),
        },
      };
      const evidenceSummary = {
        highlights: dedupeStrings([
          ...(signals.proof_points || []),
          ...(signals.projects || []),
          ...(signals.skills || []),
        ], 20),
        sources: [
          { family: 'resume', count: Number(sourceHealth.resume.text_length || 0), freshness: sourceHealth.resume.updated_at },
          { family: 'website', count: Number(sourceHealth.website.pages_fetched || 0), freshness: sourceHealth.website.updated_at },
          { family: 'external_profiles', count: Number(sourceHealth.external_profiles.found_count || 0), freshness: sourceHealth.external_profiles.updated_at },
        ],
        updated_at: new Date().toISOString(),
      };

      const vault = await personaVaultService.upsert({
        userId,
        status: 'ready',
        signals,
        sourceHealth,
        evidenceSummary,
        metadata: {
          last_job_id: jobId,
          strategy_id: strategyId || null,
        },
        reason: 'persona_enrichment_job',
      });
      await personaVaultService.storeSourceSnapshots({
        userId,
        snapshots: [
          {
            source_type: 'resume_pdf',
            source_key: resume.filename || null,
            snapshot: { text_preview: toShortText(resume.text, 800), links: resume.links || [] },
          },
          {
            source_type: 'website',
            source_key: inputs.website_url || null,
            snapshot: { pages: (website.pages || []).slice(0, 6).map((page) => ({ url: page.url, title: page.title })) },
          },
        ],
      });

      await linkedinAutomationService.upsertProfileContext(userId, {
        role_niche: signals.niche_candidates?.[0] || profileContext.role_niche,
        target_audience: signals.audience_candidates?.[0] || profileContext.target_audience,
        proof_points: dedupeStrings([profileContext.proof_points, ...(signals.proof_points || [])], 6).join(' | '),
        metadata: {
          ...parseJsonObject(profileContext.metadata, {}),
          persona_signals: {
            niche_candidates: (signals.niche_candidates || []).slice(0, 10),
            audience_candidates: (signals.audience_candidates || []).slice(0, 10),
            proof_points: (signals.proof_points || []).slice(0, 10),
            skills: (signals.skills || []).slice(0, 16),
            projects: (signals.projects || []).slice(0, 12),
            topic_signals: (signals.topic_signals || []).slice(0, 14),
            external_profiles: signals.external_profiles || {},
            source_health: sourceHealth,
            updated_at: new Date().toISOString(),
          },
        },
      });

      if (strategyId) {
        await personaVaultService.attachToStrategy({
          userId,
          strategyId,
          source: 'persona_job_auto_attach',
        });
      }

      const finalRow = await this.updateJob(jobId, {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
        metadata: { stage_code: 'PERSONA_ENRICHMENT_COMPLETED' },
        result: {
          signals: {
            niche_candidates: (signals.niche_candidates || []).slice(0, 10),
            audience_candidates: (signals.audience_candidates || []).slice(0, 10),
            proof_points: (signals.proof_points || []).slice(0, 10),
            skills: (signals.skills || []).slice(0, 16),
            projects: (signals.projects || []).slice(0, 12),
            topic_signals: (signals.topic_signals || []).slice(0, 14),
          },
          source_health: sourceHealth,
          evidence_summary: evidenceSummary,
          vault_id: vault?.id || null,
        },
      });
      return this.mapJob(finalRow);
    } catch (error) {
      await this.updateJob(jobId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        completedAt: new Date().toISOString(),
        errorCode: 'PERSONA_ENRICHMENT_FAILED',
        errorMessage: toShortText(error?.message || 'Persona enrichment failed', 260),
      });
      throw error;
    }
  }

  async startEnrichmentJob({
    userId,
    strategyId = null,
    websiteUrl = '',
    resumeBase64 = '',
    resumeFilename = 'resume.pdf',
    consent = false,
    runId = crypto.randomUUID(),
  } = {}) {
    if (!consent) throw new Error('CONSENT_REQUIRED');
    const normalizedWebsite = normalizeUrl(websiteUrl);
    const normalizedResume = String(resumeBase64 || '').replace(/^data:application\/pdf;base64,/i, '').trim();
    if (!normalizedWebsite && !normalizedResume) {
      throw new Error('At least one source is required (website URL or resume PDF).');
    }
    if (normalizedResume) {
      const approxBytes = Math.floor((normalizedResume.length * 3) / 4);
      if (approxBytes > MAX_RESUME_BYTES) throw new Error('Resume PDF too large. Max size is 8MB.');
    }

    const inputs = {
      website_url: normalizedWebsite || null,
      has_resume_pdf: Boolean(normalizedResume),
      resume_base64: normalizedResume || null,
      resume_filename: toShortText(resumeFilename || 'resume.pdf', 180),
      consent: true,
    };
    const { rows } = await pool.query(
      `INSERT INTO linkedin_persona_enrichment_jobs (
         user_id, strategy_id, run_id, status, stage, progress, inputs, metadata, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'queued', 'queued', 0, $4::jsonb, $5::jsonb, NOW(), NOW()
       )
       RETURNING *`,
      [
        userId,
        strategyId || null,
        runId,
        safeJsonStringify(inputs, '{}'),
        safeJsonStringify({ correlation: { runId, strategyId } }, '{}'),
      ]
    );
    const job = rows[0] || null;
    if (job?.id) this.runJobInBackground(job.id);
    return this.mapJob(job);
  }

  async getJobStatus({ userId, jobId } = {}) {
    const row = await this.getJob({ userId, jobId });
    return this.mapJob(row);
  }

  async getPersonaSignals({ userId } = {}) {
    const vault = await personaVaultService.getByUser({ userId });
    if (!vault) return null;
    const snapshots = await personaVaultService.getActiveSnapshots({ userId, limit: 24 });
    return { vault, snapshots };
  }

  async attachJobToStrategy({ userId, jobId, strategyId = null } = {}) {
    const job = await this.getJobStatus({ userId, jobId });
    if (!job) throw new Error('Persona job not found');
    if (job.status !== 'completed') throw new Error('Persona job is not completed');
    const targetStrategyId = strategyId || job.strategyId;
    if (!targetStrategyId) throw new Error('strategyId is required');

    const attached = await personaVaultService.attachToStrategy({
      userId,
      strategyId: targetStrategyId,
      source: 'persona_attach_endpoint',
    });
    await this.updateJob(jobId, {
      metadata: {
        attached_strategy_id: targetStrategyId,
        attached_at: new Date().toISOString(),
      },
    });
    return {
      jobId,
      strategyId: targetStrategyId,
      attached: Boolean(attached?.attached),
      personaSummary: attached?.summary || null,
    };
  }
}

const personaCoreService = new PersonaCoreService();
export default personaCoreService;

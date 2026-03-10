import axios from 'axios';

const MAX_TARGETS = 5;
const MAX_MANUAL_EXAMPLES = 12;
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BUDGET_MS = 20000;

const DEFAULT_ALLOWLIST = [
  'linkedin.com',
  'x.com',
  'twitter.com',
  'github.com',
  'medium.com',
  'substack.com',
];

const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
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
    const value = toShortText(item, 200);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
};

const normalizeUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const candidate = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
    if (!/^https?:$/i.test(candidate.protocol)) return '';
    candidate.hash = '';
    return candidate.toString();
  } catch {
    return '';
  }
};

const normalizeHandle = (value = '') =>
  String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80);

const toLinkedinUrl = (handle = '') => {
  const clean = normalizeHandle(handle);
  if (!clean) return '';
  return `https://www.linkedin.com/in/${clean}`;
};

const parseAllowlist = () => {
  const raw = String(process.env.STRATEGY_COMPETITOR_ALLOWLIST || '').trim();
  if (!raw) return DEFAULT_ALLOWLIST;
  return dedupeStrings(raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean), 30);
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

const extractFirstRegexGroup = (input = '', patterns = []) => {
  for (const pattern of patterns) {
    const match = String(input || '').match(pattern);
    if (match?.[1]) return sanitizeText(match[1]);
  }
  return '';
};

const normalizeTargetInput = (target = '') => {
  const raw = String(target || '').trim();
  if (!raw) return null;
  const url = normalizeUrl(raw);
  if (url) {
    return {
      raw,
      normalized: url,
      type: 'url',
    };
  }
  const handle = normalizeHandle(raw);
  if (!handle) return null;
  return {
    raw,
    normalized: handle,
    type: 'handle',
  };
};

const parseTargets = (targets = []) =>
  dedupeStrings(
    (Array.isArray(targets) ? targets : [])
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return String(item.url || item.handle || item.target || '').trim();
        }
        return '';
      })
      .filter(Boolean),
    18
  )
    .map((item) => normalizeTargetInput(item))
    .filter(Boolean);

class CompetitorIntelService {
  isEnabled() {
    const raw = String(process.env.STRATEGY_COMPETITOR_SCRAPE_ENABLED || 'true').toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off';
  }

  isKillSwitchOn() {
    const raw = String(process.env.STRATEGY_COMPETITOR_SCRAPE_KILL_SWITCH || 'false').toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'on';
  }

  isAllowlisted(url = '') {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const allowlist = parseAllowlist();
      return allowlist.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  async fetchCompetitorSnapshot(targetUrl = '') {
    const response = await axios.get(targetUrl, {
      timeout: FETCH_TIMEOUT_MS,
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SuiteGenieCompetitorBot/1.0; +https://suitegenie.in)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`http_${response.status}`);
    }
    const html = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || {});
    const text = htmlToText(html);
    const title = extractFirstRegexGroup(html, [
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    ]);
    const description = extractFirstRegexGroup(html, [
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
    ]);
    return {
      title: toShortText(title, 180),
      description: toShortText(description, 260),
      textPreview: toShortText(text, 1800),
    };
  }

  buildHeuristicReference({
    label = '',
    winAngle = 'authority',
    manualExamples = [],
    snapshot = null,
  } = {}) {
    const insight = toShortText(
      snapshot?.description ||
        snapshot?.title ||
        manualExamples[0] ||
        `${label} appears active in your target niche.`,
      260
    );
    return {
      handle: label.startsWith('@') ? label : `@${label}`,
      key_takeaway: `Track this competitor for ${winAngle} positioning and tighter hook clarity.`,
      content_angles: dedupeStrings([
        ...manualExamples,
        insight,
      ], 3),
      what_works: dedupeStrings([
        snapshot?.title,
        snapshot?.description,
        `Consistent positioning around ${winAngle}.`,
      ], 3),
      gaps_you_can_fill: dedupeStrings([
        `Differentiate with stronger proof points and concrete outcomes.`,
        `Use a sharper ${winAngle} angle than generic commentary.`,
      ], 3),
    };
  }

  async analyzeTargets({
    competitorTargets = [],
    manualExamples = [],
    winAngle = 'authority',
    consentScrape = false,
  } = {}) {
    const cleanExamples = dedupeStrings(manualExamples, MAX_MANUAL_EXAMPLES);
    const parsedTargets = parseTargets(competitorTargets).slice(0, MAX_TARGETS);

    if (parsedTargets.length === 0 && cleanExamples.length === 0) {
      return {
        success: false,
        code: 'NO_COMPETITOR_INPUT',
        referenceAccounts: [],
        competitorProfiles: [],
        competitorExamples: [],
        scrapeReport: {
          totalTargets: 0,
          successCount: 0,
          failedCount: 0,
          partial: false,
          warnings: ['No competitor targets or manual examples provided.'],
        },
      };
    }

    const scrapingEnabled = this.isEnabled() && !this.isKillSwitchOn();
    const shouldScrape = scrapingEnabled && parseBoolean(consentScrape, false) && parsedTargets.length > 0;
    const startedAt = Date.now();

    const successes = [];
    const failures = [];
    const profileList = [];
    for (const target of parsedTargets) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > MAX_FETCH_BUDGET_MS) {
        failures.push({
          target: target.raw,
          code: 'BUDGET_TIMEOUT',
          message: 'Scrape budget exceeded',
        });
        continue;
      }

      const targetUrl = target.type === 'url' ? target.normalized : toLinkedinUrl(target.normalized);
      if (!targetUrl) {
        failures.push({
          target: target.raw,
          code: 'INVALID_TARGET',
          message: 'Could not normalize competitor target',
        });
        continue;
      }
      profileList.push(target.type === 'handle' ? target.normalized : targetUrl);

      if (!shouldScrape) {
        failures.push({
          target: targetUrl,
          code: scrapingEnabled ? 'CONSENT_REQUIRED' : 'SCRAPING_DISABLED',
          message: scrapingEnabled
            ? 'Consent required for competitor scraping'
            : 'Competitor scraping is disabled',
        });
        continue;
      }

      if (!this.isAllowlisted(targetUrl)) {
        failures.push({
          target: targetUrl,
          code: 'DOMAIN_NOT_ALLOWLISTED',
          message: 'Target domain is not allowlisted',
        });
        continue;
      }

      try {
        const snapshot = await this.fetchCompetitorSnapshot(targetUrl);
        successes.push({
          target: targetUrl,
          snapshot,
        });
      } catch (error) {
        failures.push({
          target: targetUrl,
          code: 'SCRAPE_FAILED',
          message: toShortText(error?.message || 'Scrape failed', 120),
        });
      }
    }

    const references = [];
    for (const row of successes) {
      const label = row.target.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
      references.push(this.buildHeuristicReference({
        label,
        winAngle,
        manualExamples: cleanExamples,
        snapshot: row.snapshot,
      }));
    }

    if (references.length === 0 && (cleanExamples.length > 0 || profileList.length > 0)) {
      const fallbackLabels = profileList.length > 0 ? profileList : ['competitor'];
      for (const label of fallbackLabels.slice(0, MAX_TARGETS)) {
        references.push(this.buildHeuristicReference({
          label,
          winAngle,
          manualExamples: cleanExamples,
        }));
      }
    }

    return {
      success: true,
      code: failures.length === 0 ? 'COMPETITOR_ANALYSIS_READY' : 'COMPETITOR_ANALYSIS_PARTIAL',
      referenceAccounts: references,
      competitorProfiles: dedupeStrings(profileList, MAX_TARGETS),
      competitorExamples: cleanExamples,
      scrapeReport: {
        totalTargets: parsedTargets.length,
        successCount: successes.length,
        failedCount: failures.length,
        partial: failures.length > 0,
        warnings: failures.map((item) => `${item.target} (${item.code})`),
        failures,
      },
    };
  }
}

const competitorIntelService = new CompetitorIntelService();
export default competitorIntelService;

import express from 'express';
import axios from 'axios';
import zlib from 'zlib';
import { strategyService } from '../services/strategyService.js';
import creditService from '../services/creditService.js';
import aiService from '../services/aiService.js';
import { pool } from '../config/database.js';
import linkedinAutomationService from '../services/linkedinAutomationService.js';
import contextVaultService from '../services/contextVaultService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Strategy Builder'));
const CONTENT_PLAN_QUEUE_TARGET = 2;

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

const decodeHtmlEntities = (value = '') =>
  String(value || '')
    .replace(/&#(\d+);/g, (_match, dec) => {
      const code = Number(dec);
      if (!Number.isFinite(code)) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code)) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const stripHtmlTags = (value = '') =>
  decodeHtmlEntities(String(value || '').replace(/<[^>]*>/g, ' '));

const stripUnsafeJsonControlChars = (value = '') =>
  String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\uFFFE\uFFFF]/g, ' ');

const sanitizeJsonSafeValue = (value) => {
  if (typeof value === 'string') {
    return stripUnsafeJsonControlChars(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSafeValue(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = sanitizeJsonSafeValue(item);
    }
    return out;
  }
  return value;
};

const normalizeWhitespace = (value = '') =>
  stripUnsafeJsonControlChars(value)
    .replace(/\s+/g, ' ')
    .trim();

const toShortText = (value = '', max = 800) => {
  const normalized = normalizeWhitespace(String(value || ''));
  if (!normalized) return '';
  const safeMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 800;
  return normalized.slice(0, safeMax);
};

const normalizePortfolioUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const repairedRaw = raw
    .replace(/^https?:\/\/htts\/\//i, 'https://')
    .replace(/^https?:\/\/https\/\//i, 'https://')
    .replace(/^https?:\/\/http\/\//i, 'http://')
    .replace(/^https?:\/\/https?:\/\//i, 'https://');
  const candidate = /^https?:\/\//i.test(repairedRaw) ? repairedRaw : `https://${repairedRaw}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    if (parsed.hostname.toLowerCase() === 'htts' || parsed.hostname.toLowerCase() === 'https') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

const extractFirstRegexGroup = (input = '', patterns = []) => {
  for (const pattern of patterns) {
    const match = String(input || '').match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(stripHtmlTags(match[1]));
    }
  }
  return '';
};

const htmlToPortableText = (html = '') => {
  const source = String(html || '');
  const withoutNonText = source
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const withHeadings = withoutNonText
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, inner) => `\n## ${normalizeWhitespace(stripHtmlTags(inner))}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n- ${normalizeWhitespace(stripHtmlTags(inner))}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|td|ul|ol)>/gi, '\n');

  return stripUnsafeJsonControlChars(decodeHtmlEntities(withHeadings.replace(/<[^>]*>/g, ' ')))
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
};

const extractSectionByHeading = (portableText = '', headingPattern = '') => {
  if (!portableText || !headingPattern) return '';
  const regex = new RegExp(`(?:^|\\n)##\\s*(?:${headingPattern})\\s*\\n([\\s\\S]{1,1800}?)(?=\\n##\\s|$)`, 'i');
  const match = portableText.match(regex);
  if (!match?.[1]) return '';
  const section = match[1]
    .split('\n')
    .map((line) => normalizeWhitespace(line.replace(/^-+\s*/, '')))
    .filter(Boolean)
    .join(' ');
  return section.slice(0, 700);
};

const extractSkillsFromText = (skillsSection = '', fullText = '') => {
  const seeds = [];
  if (skillsSection) {
    seeds.push(...skillsSection.split(/[\n,|/]+/));
  } else {
    const inlineMatch = String(fullText || '').match(/skills?\s*[:\-]\s*([^\n]{1,500})/i);
    if (inlineMatch?.[1]) {
      seeds.push(...inlineMatch[1].split(/[;,|/]+/));
    }
  }

  const normalizedSkills = dedupeStrings(
    seeds
      .map((value) => normalizeWhitespace(value.replace(/^[-•*]\s*/, '')))
      .filter((value) => value.length >= 2 && value.length <= 35)
      .filter((value) => !/\b(about|experience|education|contact|project|portfolio)\b/i.test(value))
      .slice(0, 40),
    20
  );

  if (normalizedSkills.length > 0) return normalizedSkills;

  // Heuristic fallback when portfolio has no explicit "Skills" section.
  const lowerText = String(fullText || '').toLowerCase();
  const techSignals = [
    ['react', 'React'],
    ['nextjs', 'Next.js'],
    ['next js', 'Next.js'],
    ['nodejs', 'Node.js'],
    ['node js', 'Node.js'],
    ['node', 'Node.js'],
    ['aws', 'AWS'],
    ['docker', 'Docker'],
    ['jenkins', 'Jenkins'],
    ['devops', 'DevOps'],
    ['seo', 'SEO'],
    ['security', 'Security'],
    ['typescript', 'TypeScript'],
    ['javascript', 'JavaScript'],
    ['postgres', 'PostgreSQL'],
    ['postgresql', 'PostgreSQL'],
    ['mongodb', 'MongoDB'],
    ['redis', 'Redis'],
    ['kubernetes', 'Kubernetes'],
    ['ci/cd', 'CI/CD'],
    ['cicd', 'CI/CD'],
  ];

  const inferred = dedupeStrings(
    techSignals
      .filter(([needle]) => lowerText.includes(needle))
      .map(([, label]) => label),
    20
  );

  if (inferred.length > 0) return inferred;
  return normalizedSkills;
};

const extractExperienceFromText = (experienceSection = '', fullText = '') => {
  const section = normalizeWhitespace(experienceSection);
  if (section) return section.slice(0, 700);

  const candidateLines = String(fullText || '')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => /(?:experience|worked|work(ed)? at|founder|engineer|manager|intern|consultant|freelance|built|shipped|launched|20\d{2})/i.test(line))
    .slice(0, 5);

  if (!candidateLines.length) return '';
  return normalizeWhitespace(candidateLines.join(' ')).slice(0, 700);
};

const buildCombinedContext = ({ userContext = '', about = '', skills = [], experience = '' }) => {
  const parts = [];
  if (String(userContext || '').trim()) {
    parts.push(`User context: ${String(userContext).trim()}`);
  }
  if (String(about || '').trim()) {
    parts.push(`Portfolio about: ${String(about).trim()}`);
  }
  if (Array.isArray(skills) && skills.length > 0) {
    parts.push(`Portfolio skills: ${skills.join(', ')}`);
  }
  if (String(experience || '').trim()) {
    parts.push(`Portfolio experience: ${String(experience).trim()}`);
  }
  return parts.join('\n\n').trim();
};

const fetchPortfolioMetadata = async (portfolioUrl = '') => {
  const normalizedUrl = normalizePortfolioUrl(portfolioUrl);
  if (!normalizedUrl) {
    return {
      url: '',
      fetched: false,
      error: 'invalid_url',
      status: null,
      title: '',
      description: '',
      about: '',
      skills: [],
      experience: '',
      contentPreview: '',
    };
  }

  try {
    const response = await axios.get(normalizedUrl, {
      timeout: 12000,
      maxContentLength: 1_000_000,
      maxBodyLength: 1_000_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SuiteGenieBot/1.0; +https://suitegenie.in)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        url: normalizedUrl,
        fetched: false,
        error: `http_${response.status}`,
        status: response.status,
        title: '',
        description: '',
        about: '',
        skills: [],
        experience: '',
        contentPreview: '',
      };
    }

    const html = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data || {});
    const portableText = htmlToPortableText(html);

    const title = extractFirstRegexGroup(html, [
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i,
    ]).slice(0, 180);

    const description = extractFirstRegexGroup(html, [
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i,
      /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i,
      /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["'][^>]*>/i,
    ]).slice(0, 500);

    const aboutSection =
      extractSectionByHeading(portableText, 'about(?:\\s+me)?|bio|summary|profile|introduction') ||
      description ||
      normalizeWhitespace(
        portableText
          .split('\n')
          .filter((line) => !line.startsWith('##') && !line.startsWith('-'))
          .slice(0, 6)
          .join(' ')
      );
    const about = aboutSection.slice(0, 700);

    const skillsSection = extractSectionByHeading(
      portableText,
      'skills?|technical\\s+skills?|tech\\s+stack|tools?|expertise'
    );
    const skills = extractSkillsFromText(skillsSection, portableText);

    const experienceSection = extractSectionByHeading(
      portableText,
      'experience|work\\s+experience|employment|career|professional\\s+experience'
    );
    const experience = extractExperienceFromText(experienceSection, portableText);

    return {
      url: normalizedUrl,
      fetched: true,
      error: null,
      status: response.status,
      title,
      description,
      about,
      skills,
      experience,
      contentPreview: portableText.slice(0, 2500),
    };
  } catch (error) {
    return {
      url: normalizedUrl,
      fetched: false,
      error: error?.message || 'fetch_failed',
      status: Number(error?.response?.status || 0) || null,
      title: '',
      description: '',
      about: '',
      skills: [],
      experience: '',
      contentPreview: '',
    };
  }
};

const dedupeStrings = (items = [], max = 20) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = normalizeWhitespace(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= max) break;
  }
  return result;
};

const decodePdfLiteralString = (rawValue = '') => {
  if (!rawValue) return '';
  let value = String(rawValue || '');
  value = value
    .replace(/\\\r?\n/g, '')
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => {
      const code = Number.parseInt(octal, 8);
      if (!Number.isFinite(code)) return ' ';
      return String.fromCharCode(code);
    })
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
  return value;
};

const decodePdfHexString = (rawHex = '') => {
  const cleaned = String(rawHex || '').replace(/[^0-9a-f]/gi, '');
  if (!cleaned || cleaned.length < 4) return '';
  const evenHex = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;
  try {
    const bytes = Buffer.from(evenHex, 'hex');
    if (bytes.length === 0) return '';

    const decodeUtf16 = (isLittleEndian = false, start = 0) => {
      let out = '';
      for (let index = start; index + 1 < bytes.length; index += 2) {
        const code = isLittleEndian
          ? (bytes[index] | (bytes[index + 1] << 8))
          : ((bytes[index] << 8) | bytes[index + 1]);
        out += String.fromCharCode(code);
      }
      return out;
    };

    // UTF-16 with BOM
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return decodeUtf16(false, 2);
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return decodeUtf16(true, 2);
    }

    // Heuristic UTF-16 without BOM (common in PDF text runs)
    if (bytes.length >= 4 && bytes.length % 2 === 0) {
      let evenZeros = 0;
      let oddZeros = 0;
      for (let index = 0; index < bytes.length; index += 1) {
        if (bytes[index] === 0) {
          if (index % 2 === 0) evenZeros += 1;
          else oddZeros += 1;
        }
      }
      const half = bytes.length / 2;
      if (evenZeros / half > 0.35) {
        return decodeUtf16(false, 0);
      }
      if (oddZeros / half > 0.35) {
        return decodeUtf16(true, 0);
      }
    }

    return bytes.toString('latin1');
  } catch {
    return '';
  }
};

const normalizePdfReadableText = (value = '') =>
  normalizeWhitespace(
    stripUnsafeJsonControlChars(String(value || ''))
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
  );

const isLikelyHumanReadableText = (value = '') => {
  const normalized = normalizePdfReadableText(value);
  if (!normalized || normalized.length < 3) return false;

  const totalLength = normalized.length;
  const symbolCount = (normalized.match(/[^A-Za-z0-9\s]/g) || []).length;
  if (totalLength > 0 && symbolCount / totalLength > 0.18) return false;

  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  const digits = (normalized.match(/[0-9]/g) || []).length;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const alphaTokens = tokens.filter((token) => /[A-Za-z]/.test(token));
  const singleLetterAlphaTokens = alphaTokens.filter((token) => /^[A-Za-z]$/.test(token)).length;
  const shortUpperOrDigitTokens = tokens.filter((token) => /^[A-Z0-9]{1,2}$/.test(token)).length;
  const vowels = (normalized.match(/[AEIOUaeiou]/g) || []).length;

  if (tokens.length >= 6 && shortUpperOrDigitTokens / tokens.length > 0.3) return false;
  if (letters < 2) return false;
  if (alphaTokens.length >= 4 && singleLetterAlphaTokens / alphaTokens.length > 0.4) return false;
  if (letters >= 20 && vowels / letters < 0.1) return false;
  if (digits > letters * 1.5) return false;

  return true;
};

const isUsefulPdfTextSnippet = (value = '') => {
  const normalized = normalizePdfReadableText(value);
  if (!normalized || normalized.length < 2) return false;
  const alphaNumericCount = (normalized.match(/[a-zA-Z0-9]/g) || []).length;
  if (alphaNumericCount < 2) return false;
  if (!isLikelyHumanReadableText(normalized)) return false;
  return true;
};

const extractPdfTextOperands = (input = '') => {
  const values = [];
  const source = String(input || '');

  const pushValue = (rawValue = '', type = 'literal') => {
    const decoded = type === 'hex'
      ? decodePdfHexString(rawValue)
      : decodePdfLiteralString(rawValue);
    const normalized = normalizePdfReadableText(decoded);
    if (!isUsefulPdfTextSnippet(normalized)) return;
    values.push(normalized);
  };

  // Direct text-show operators: Tj, ', "
  const directRegex = /(\((?:\\.|[^\\)]){1,2400}\)|<([0-9A-Fa-f\s]{2,5000})>)\s*(?:Tj|'|")/g;
  let directMatch = directRegex.exec(source);
  while (directMatch) {
    const token = directMatch[1] || '';
    if (token.startsWith('(')) {
      pushValue(token.slice(1, -1), 'literal');
    } else if (directMatch[2]) {
      pushValue(directMatch[2], 'hex');
    }
    directMatch = directRegex.exec(source);
  }

  // Text arrays for TJ operator.
  const arrayRegex = /\[([\s\S]{1,6000}?)\]\s*TJ/g;
  let arrayMatch = arrayRegex.exec(source);
  while (arrayMatch) {
    const arrayBody = arrayMatch[1] || '';
    const itemRegex = /(\((?:\\.|[^\\)]){1,2400}\)|<([0-9A-Fa-f\s]{2,5000})>)/g;
    let itemMatch = itemRegex.exec(arrayBody);
    while (itemMatch) {
      const itemToken = itemMatch[1] || '';
      if (itemToken.startsWith('(')) {
        pushValue(itemToken.slice(1, -1), 'literal');
      } else if (itemMatch[2]) {
        pushValue(itemMatch[2], 'hex');
      }
      itemMatch = itemRegex.exec(arrayBody);
    }
    arrayMatch = arrayRegex.exec(source);
  }

  return values;
};

const tryInflatePdfStream = (buffer = Buffer.alloc(0)) => {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  const attempts = [
    () => zlib.inflateSync(source),
    () => zlib.inflateRawSync(source),
    () => zlib.unzipSync(source),
  ];
  for (const inflate of attempts) {
    try {
      return inflate();
    } catch {
      // try next decoder
    }
  }
  return null;
};

const extractPdfPortableText = (pdfBuffer = Buffer.alloc(0)) => {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) return '';
  const binaryText = pdfBuffer.toString('latin1');
  const snippets = [];

  const pushSnippet = (value = '') => {
    const normalized = normalizePdfReadableText(value);
    if (!isUsefulPdfTextSnippet(normalized)) return;
    snippets.push(normalized.slice(0, 1200));
  };

  const metadataPatterns = [
    /\/Title\s*\(([\s\S]{1,800}?)\)/gi,
    /\/Subject\s*\(([\s\S]{1,1200}?)\)/gi,
    /\/Keywords\s*\(([\s\S]{1,1200}?)\)/gi,
    /\/Author\s*\(([\s\S]{1,400}?)\)/gi,
  ];
  for (const pattern of metadataPatterns) {
    let match = pattern.exec(binaryText);
    while (match) {
      pushSnippet(decodePdfLiteralString(match[1] || ''));
      match = pattern.exec(binaryText);
    }
  }

  const streamRegex = /stream\r?\n/g;
  let streamMatch = streamRegex.exec(binaryText);
  while (streamMatch) {
    const streamStart = streamMatch.index + streamMatch[0].length;
    const streamEnd = binaryText.indexOf('endstream', streamStart);
    if (streamEnd < 0) break;

    let rawStream = pdfBuffer.subarray(streamStart, streamEnd);
    while (rawStream.length > 0 && (rawStream[0] === 0x0d || rawStream[0] === 0x0a)) {
      rawStream = rawStream.subarray(1);
    }
    while (
      rawStream.length > 0 &&
      (rawStream[rawStream.length - 1] === 0x0d || rawStream[rawStream.length - 1] === 0x0a)
    ) {
      rawStream = rawStream.subarray(0, rawStream.length - 1);
    }

    const candidates = [rawStream];
    const inflated = tryInflatePdfStream(rawStream);
    if (inflated) candidates.push(inflated);

    for (const candidate of candidates) {
      const candidateText = candidate.toString('latin1');
      if (!/(?:Tj|TJ|'|")/.test(candidateText)) {
        continue;
      }
      for (const textOperand of extractPdfTextOperands(candidateText)) {
        pushSnippet(textOperand);
      }
    }

    const nextIndex = streamEnd + 'endstream'.length;
    streamRegex.lastIndex = nextIndex;
    streamMatch = streamRegex.exec(binaryText);
  }

  const deduped = dedupeStrings(snippets, 300);
  return deduped.join('\n').slice(0, 20000);
};

const extractLinkedInProfilePdfDiscoveries = (pdfBuffer = Buffer.alloc(0)) => {
  const portableText = extractPdfPortableText(pdfBuffer);
  const aboutSectionCandidate =
    extractSectionByHeading(portableText, 'about(?:\\s+me)?|summary|bio|profile') ||
    normalizeWhitespace(
      portableText
        .split('\n')
        .filter((line) => !line.startsWith('##') && !line.startsWith('-'))
        .slice(0, 6)
        .join(' ')
    );
  const skillsSection = extractSectionByHeading(
    portableText,
    'skills?|technical\\s+skills?|tech\\s+stack|tools?|expertise|core\\s+skills'
  );
  const experienceSection = extractSectionByHeading(
    portableText,
    'experience|work\\s+experience|employment|career|professional\\s+experience'
  );

  const aboutSection = isLikelyHumanReadableText(aboutSectionCandidate) ? aboutSectionCandidate : '';
  const about = toShortText(aboutSection, 700);
  const skills = extractSkillsFromText(skillsSection, portableText);
  const experienceCandidate = extractExperienceFromText(experienceSection, portableText);
  const experience = isLikelyHumanReadableText(experienceCandidate)
    ? toShortText(experienceCandidate, 700)
    : '';

  return {
    about,
    skills,
    experience,
    contentPreview: portableText.slice(0, 2500),
    textLength: portableText.length,
  };
};

const pickReadableProfileText = (values = [], max = 700) => {
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = toShortText(value || '', max);
    if (!normalized) continue;
    if (!isLikelyHumanReadableText(normalized)) continue;
    return normalized;
  }
  return '';
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
  'didn', 'don', 'isn', 'aren', 'wasn', 'weren', 'hasn', 'haven', 'hadn',
  'won', 'wouldn', 'couldn', 'shouldn', 'mustn', 'needn', 'shan',
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
    .replace(/\bsocialmedia\b/gi, 'social media')
    .replace(/\bsoftwareengineering\b/gi, 'software engineering')
    .replace(/\bmachinelearning\b/gi, 'machine learning')
    .replace(/\bwebdevelopment\b/gi, 'web development')
    .replace(/\bmobiledevelopment\b/gi, 'mobile development')
    .replace(/\bdatascience\b/gi, 'data science')
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
      if (
        word.endsWith('s') &&
        !word.endsWith('ss') &&
        !word.endsWith('is') &&
        !word.endsWith('us') &&
        !word.endsWith('ops') &&
        !word.endsWith('ics') &&
        word.length > 4
      ) {
        return word.slice(0, -1);
      }
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
      if (isOverlyGenericNicheValue(topic)) return false;
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
const GENERIC_NICHE_PATTERNS = [
  /^personal\s+growth$/i,
  /^self\s+improvement$/i,
  /^personal\s+development$/i,
  /^motivational?$/i,
  /^lifestyle$/i,
  /^content\s+creator$/i,
  /^portfolio$/i,
  /^resume$/i,
  /^cv$/i,
];

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

const isOverlyGenericNicheValue = (value = '') => {
  const normalized = normalizeTopicCandidate(value);
  if (!normalized) return true;
  if (GENERIC_NICHE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return false;
};

const isJunkNicheCandidate = (value = '', profileDisplayName = '') => {
  const normalized = normalizeTopicCandidate(value);
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, ' ').trim();
  if (/^(his|her|their|my|our|your)\b/i.test(compact)) {
    return true;
  }
  if (/\b(primary|main)\s+focu(s)?\b/i.test(compact)) {
    return true;
  }
  if (/\bfocus\b/i.test(compact) && compact.split(' ').length <= 4) {
    return true;
  }
  if (/\bfocu\b/i.test(compact)) {
    return true;
  }
  if (/\b(portfolio|resume|cv)\b/i.test(compact) && compact.split(' ').length <= 4) {
    return true;
  }

  const personName = normalizeTopicCandidate(profileDisplayName);
  if (personName && compact === personName) return true;
  if (personName && compact === `${personName} portfolio`) return true;

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
  const profileDisplayName = String(metadata?.profile_display_name || accountSnapshot?.display_name || '').trim();
  const topicBased = normalizeTopicList(topTopics || [], 8);
  const strongTopicBased = topicBased.filter(
    (topic) => !isWeakNicheValue(topic) && !isWeakTopicCandidate(topic)
  );

  const accountAndPortfolioCandidates = [
    { value: accountSnapshot?.headline, source: 'account_headline' },
    { value: accountSnapshot?.about, source: 'account_about' },
    { value: accountSnapshot?.experience, source: 'account_experience' },
    { value: metadata?.profile_headline, source: 'metadata_profile_headline' },
    { value: metadata?.profile_about, source: 'metadata_profile_about' },
    { value: metadata?.linkedin_about, source: 'metadata_linkedin_about' },
    { value: metadata?.linkedin_experience, source: 'metadata_linkedin_experience' },
    { value: metadata?.organization_name, source: 'metadata_organization_name' },
    { value: metadata?.portfolio_title, source: 'portfolio_title' },
    { value: metadata?.portfolio_description, source: 'portfolio_description' },
    { value: metadata?.portfolio_about, source: 'portfolio_about' },
    { value: metadata?.portfolio_experience, source: 'portfolio_experience' },
    ...(Array.isArray(metadata?.linkedin_skills) ? metadata.linkedin_skills.map((value) => ({ value, source: 'linkedin_skill' })) : []),
    ...(Array.isArray(metadata?.portfolio_skills) ? metadata.portfolio_skills.map((value) => ({ value, source: 'portfolio_skill' })) : []),
  ].map((entry) => ({
    value: String(entry?.value || '').trim(),
    source: String(entry?.source || '').trim(),
  })).filter((entry) => Boolean(entry.value));

  for (const { value: candidate, source } of accountAndPortfolioCandidates) {
    if (source === 'portfolio_title' && isJunkNicheCandidate(candidate, profileDisplayName)) {
      continue;
    }
    const compact = extractCompactNicheFromText(candidate);
    if (!compact) continue;
    if (isJunkNicheCandidate(compact, profileDisplayName)) continue;
    if (isOverlyGenericNicheValue(compact) && strongTopicBased.length > 0) continue;
    return compact;
  }

  if (strongTopicBased.length >= 2) {
    return titleCaseWords(`${strongTopicBased[0]} and ${strongTopicBased[1]}`);
  }
  if (strongTopicBased.length === 1) {
    return titleCaseWords(strongTopicBased[0]);
  }

  const seededCandidates = [
    profileContext?.role_niche,
    strategy?.niche,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of seededCandidates) {
    const compact = extractCompactNicheFromText(candidate);
    if (!compact) continue;
    if (isOverlyGenericNicheValue(compact)) continue;
    return compact;
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
  const profileMetadata = parseJsonObject(profileContext?.metadata, {});
  const portfolioSignalTopics = normalizeTopicList(
    [
      ...(Array.isArray(profileMetadata?.linkedin_skills) ? profileMetadata.linkedin_skills : []),
      ...(Array.isArray(profileMetadata?.portfolio_skills) ? profileMetadata.portfolio_skills : []),
      profileMetadata?.linkedin_about,
      profileMetadata?.linkedin_experience,
      profileMetadata?.portfolio_title,
      profileMetadata?.portfolio_description,
      profileMetadata?.portfolio_about,
      profileMetadata?.portfolio_experience,
    ],
    12
  );

  const queueTopics = hashtagsFromQueue(queue).map(([tag]) => tag.replace(/[-_]/g, ' '));
  const strategyTopics = Array.isArray(strategy?.topics) ? strategy.topics : [];
  const summaryThemes = Array.isArray(postSummary?.themes) ? postSummary.themes : [];
  const analysisTopics = [
    ...extractTopicsFromInsights(runAnalysis?.opportunities || [], 8),
    ...extractTopicsFromInsights(runAnalysis?.gaps || [], 8),
  ];
  let topTopics = normalizeTopicList(
    [...portfolioSignalTopics, ...summaryThemes, ...analysisTopics, ...strategyTopics, ...queueTopics],
    12
  ).filter((topic) => {
    if (isWeakTopicCandidate(topic)) return false;
    if (isOverlyGenericNicheValue(topic)) return false;
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
      if (isOverlyGenericNicheValue(topic)) return false;
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

const getLatestAnalysisRunForStrategy = async ({ userId, strategyId }) => {
  const { rows } = await pool.query(
    `SELECT *
     FROM linkedin_automation_runs
     WHERE user_id = $1
       AND metadata->>'strategy_id' = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, strategyId]
  );
  return rows[0] || null;
};

const markContentPlanPromptsUsed = async ({
  userId,
  strategyId,
  runId = null,
  queueCount = CONTENT_PLAN_QUEUE_TARGET,
} = {}) => {
  const safeQueueCount = Math.max(1, Math.min(8, Number(queueCount || CONTENT_PLAN_QUEUE_TARGET)));
  const prompts = await strategyService.getPrompts(strategyId, {
    limit: Math.max(12, safeQueueCount * 3),
  });
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return [];
  }

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
      console.warn('[Strategy] content-plan prompt usage mark failed:', {
        userId,
        strategyId,
        runId,
        promptId: prompt?.id || null,
        error: error?.message || error,
      });
    }
  }

  return dedupeStrings(usedPromptIds, safeQueueCount);
};

const syncProfileContextWithConfirmedAnalysis = async ({
  userId,
  strategyId,
  strategy = {},
  analysisData = {},
  analysisMetadata = {},
} = {}) => {
  const currentProfileContext = linkedinAutomationService.mapProfileContext(
    await linkedinAutomationService.getProfileContextRow(userId)
  );
  const currentProfileMetadata = parseJsonObject(currentProfileContext.metadata, {});
  const strategyMetadata = parseJsonObject(strategy.metadata, {});
  const deeperContext =
    analysisMetadata?.extra_context &&
    typeof analysisMetadata.extra_context === 'object'
      ? String(analysisMetadata.extra_context.deeper_context || '').trim()
      : '';
  const mergedExtraContext = toShortText(
    deeperContext || strategyMetadata.extra_context || currentProfileMetadata.extra_context || '',
    3000
  );
  const normalizedGoals = dedupeStrings(
    Array.isArray(analysisData?.goals) ? analysisData.goals : splitToList(analysisData?.goals || '', 10),
    10
  );
  const normalizedTopics = normalizeTopicList(analysisData?.top_topics || [], 12);
  const nextRoleNiche = toShortText(
    analysisData?.niche || strategy?.niche || currentProfileContext.role_niche || '',
    180
  );
  const nextAudience = toShortText(
    analysisData?.audience || strategy?.target_audience || currentProfileContext.target_audience || '',
    300
  );
  const nextOutcomes = toShortText(
    normalizedGoals.join(', ') || currentProfileContext.outcomes_30_90 || '',
    1200
  );
  const nextProofPoints = toShortText(
    mergedExtraContext || currentProfileContext.proof_points || '',
    1200
  );

  const mergedProfileMetadata = sanitizeJsonSafeValue({
    ...currentProfileMetadata,
    strategy_id: strategyId,
    role_niche: nextRoleNiche || currentProfileMetadata.role_niche || '',
    target_audience: nextAudience || currentProfileMetadata.target_audience || '',
    outcomes_30_90: nextOutcomes || currentProfileMetadata.outcomes_30_90 || '',
    analysis_goals: normalizedGoals,
    analysis_topics: normalizedTopics,
    extra_context: mergedExtraContext || currentProfileMetadata.extra_context || '',
    sourced_from: 'strategy_generate_analysis_prompts',
  });

  await linkedinAutomationService.upsertProfileContext(userId, {
    role_niche: nextRoleNiche,
    target_audience: nextAudience,
    outcomes_30_90: nextOutcomes,
    proof_points: nextProofPoints || undefined,
    tone_style: normalizeToneEnum(
      analysisData?.tone || strategy?.tone_style || currentProfileContext.tone_style || 'professional'
    ),
    consent_use_posts: currentProfileContext.consent_use_posts,
    consent_store_profile: currentProfileContext.consent_store_profile,
    metadata: mergedProfileMetadata,
  });

  return {
    goals: normalizedGoals,
    topics: normalizedTopics,
    extraContext: mergedExtraContext,
  };
};

const refreshContextVaultSafe = async ({
  userId,
  strategy = null,
  strategyId = null,
  reason = 'manual_refresh',
} = {}) => {
  try {
    const targetStrategy =
      strategy && typeof strategy === 'object'
        ? strategy
        : (strategyId ? await strategyService.getStrategy(strategyId) : null);

    if (!targetStrategy?.id) return null;
    if (String(targetStrategy.user_id || '') !== String(userId || '')) return null;

    return await contextVaultService.refresh({
      userId,
      strategy: targetStrategy,
      reason,
    });
  } catch (error) {
    console.warn('[Strategy] context vault refresh skipped:', {
      userId,
      strategyId: strategy?.id || strategyId || null,
      reason,
      error: error?.message || error,
    });
    return null;
  }
};

const buildContentPlanContextPayload = ({ strategy = null, analysisRun = null } = {}) => {
  const strategyMetadata = parseJsonObject(strategy?.metadata, {});
  const analysisRunMetadata = parseJsonObject(analysisRun?.metadata, {});
  const analysisData = sanitizeAnalysisData(
    analysisRunMetadata?.analysis_data ||
      strategyMetadata?.analysis_cache ||
      {}
  );
  const snapshot = parseJsonObject(analysisRun?.analysis_snapshot, {});
  const profileContext = parseJsonObject(snapshot.profileContext, {});
  const profileMetadata = parseJsonObject(profileContext.metadata, {});
  const postSummary = parseJsonObject(snapshot.postSummary, {});
  const analysisCache = parseJsonObject(strategyMetadata.analysis_cache, {});

  const linkedInSkills = dedupeStrings(
    [
      ...(Array.isArray(analysisRunMetadata.linkedin_skills) ? analysisRunMetadata.linkedin_skills : []),
      ...(Array.isArray(profileMetadata.linkedin_skills) ? profileMetadata.linkedin_skills : []),
    ],
    20
  );
  const portfolioSkills = dedupeStrings(
    [
      ...(Array.isArray(analysisRunMetadata.portfolio_skills) ? analysisRunMetadata.portfolio_skills : []),
      ...(Array.isArray(profileMetadata.portfolio_skills) ? profileMetadata.portfolio_skills : []),
      ...(Array.isArray(strategyMetadata.portfolio_skills) ? strategyMetadata.portfolio_skills : []),
    ],
    20
  );
  const topSkills = dedupeStrings([...linkedInSkills, ...portfolioSkills], 12);

  const aboutPreview = toShortText(
    pickReadableProfileText(
      [
        analysisRunMetadata.linkedin_about,
        profileMetadata.linkedin_about,
        strategyMetadata.linkedin_about,
        analysisRunMetadata.portfolio_about,
        profileMetadata.portfolio_about,
        strategyMetadata.portfolio_about,
      ],
      500
    ),
    320
  );
  const experiencePreview = toShortText(
    pickReadableProfileText(
      [
        analysisRunMetadata.linkedin_experience,
        profileMetadata.linkedin_experience,
        strategyMetadata.linkedin_experience,
        analysisRunMetadata.portfolio_experience,
        profileMetadata.portfolio_experience,
        strategyMetadata.portfolio_experience,
      ],
      700
    ),
    320
  );

  const postsCount = Number(
    analysisRunMetadata.tweets_analysed ||
      postSummary.postCount ||
      analysisCache.tweets_analysed ||
      0
  );
  const referenceCount = Array.isArray(analysisRunMetadata.reference_accounts)
    ? analysisRunMetadata.reference_accounts.length
    : 0;
  const hasPortfolioSignal = Boolean(
    analysisRunMetadata.portfolio_about ||
      profileMetadata.portfolio_about ||
      strategyMetadata.portfolio_about ||
      analysisRunMetadata.portfolio_experience ||
      profileMetadata.portfolio_experience ||
      strategyMetadata.portfolio_experience ||
      portfolioSkills.length > 0
  );
  const hasPdfSignal = Boolean(
    profileMetadata.linkedin_profile_pdf_uploaded_at ||
      strategyMetadata.linkedin_profile_pdf_uploaded_at ||
      profileMetadata.linkedin_profile_pdf_extraction_source ||
      strategyMetadata.linkedin_profile_pdf_extraction_source
  );

  return {
    niche: analysisData.niche || extractCompactNicheFromText(strategy?.niche || '') || 'LinkedIn Growth Strategy',
    audience: toShortText(
      analysisData.audience ||
        strategy?.target_audience ||
        profileContext?.target_audience ||
        '',
      220
    ),
    tone: toShortText(
      analysisData.tone ||
        toneLabelFromEnum(strategy?.tone_style || profileContext?.tone_style || 'professional'),
      120
    ),
    topTopics: normalizeTopicList(
      [
        ...(Array.isArray(analysisData.top_topics) ? analysisData.top_topics : []),
        ...(Array.isArray(strategy?.topics) ? strategy.topics : []),
        ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
      ],
      10
    ),
    aboutPreview,
    topSkills,
    experiencePreview,
    confidence: String(analysisRunMetadata.confidence || analysisCache.confidence || 'low'),
    confidenceReason: toShortText(
      analysisRunMetadata.confidence_reason || analysisCache.confidence_reason || '',
      220
    ),
    sources: [
      {
        key: 'posts',
        label: 'LinkedIn posts',
        active: postsCount > 0,
        count: postsCount,
      },
      {
        key: 'portfolio',
        label: 'Portfolio',
        active: hasPortfolioSignal,
        count: hasPortfolioSignal ? 1 : 0,
      },
      {
        key: 'pdf',
        label: 'LinkedIn profile PDF',
        active: hasPdfSignal,
        count: hasPdfSignal ? 1 : 0,
      },
      {
        key: 'reference',
        label: 'Reference accounts',
        active: referenceCount > 0,
        count: referenceCount,
      },
    ],
  };
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
    const refreshedStrategy = await strategyService.getStrategy(id);
    await refreshContextVaultSafe({
      userId,
      strategy: refreshedStrategy || strategy,
      reason: 'prompt_pack_generated_manual',
    });

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

// POST /api/strategy/upload-linkedin-profile-pdf - parse LinkedIn exported PDF and store discoveries
router.post('/upload-linkedin-profile-pdf', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      strategyId,
      base64 = '',
      filename = 'linkedin-profile.pdf',
      mimetype = 'application/pdf',
    } = req.body || {};

    if (!strategyId) {
      return res.status(400).json({ error: 'strategyId is required' });
    }
    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const normalizedBase64 = String(base64 || '')
      .replace(/^data:application\/pdf;base64,/i, '')
      .replace(/\s+/g, '')
      .trim();
    if (!normalizedBase64) {
      return res.status(400).json({ error: 'PDF base64 payload is required' });
    }

    const safeFilename = String(filename || 'linkedin-profile.pdf').slice(0, 180);
    const safeMimetype = String(mimetype || '').toLowerCase().trim();
    if (safeMimetype && !safeMimetype.includes('pdf') && !safeFilename.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'Only PDF uploads are supported' });
    }

    let pdfBuffer;
    try {
      pdfBuffer = Buffer.from(normalizedBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64 payload' });
    }
    if (!pdfBuffer || pdfBuffer.length < 100) {
      return res.status(400).json({ error: 'Uploaded PDF is empty or invalid' });
    }
    if (pdfBuffer.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'PDF too large. Maximum supported size is 8MB.' });
    }
    if (pdfBuffer.subarray(0, 4).toString('latin1') !== '%PDF') {
      return res.status(400).json({ error: 'Uploaded file is not a valid PDF' });
    }

    const currentMetadata = parseJsonObject(strategy.metadata, {});
    const currentProfileContext = linkedinAutomationService.mapProfileContext(
      await linkedinAutomationService.getProfileContextRow(userId)
    );
    const profileMetadata = parseJsonObject(currentProfileContext.metadata, {});

    // Fetch real post content for Gemini cross-reference
    const recentPostsForPdf = await pool.query(
      `SELECT post_content, likes, comments, shares
       FROM linkedin_posts
       WHERE user_id = $1 AND status = 'posted'
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    ).then((result) => result.rows).catch(() => []);

    const geminiContext = {
      displayName: currentMetadata.profile_display_name || profileMetadata.profile_display_name || '',
      headline: currentMetadata.profile_headline || profileMetadata.profile_headline || '',
      existingAbout: currentMetadata.linkedin_about || profileMetadata.linkedin_about || '',
      existingSkills: [
        ...(Array.isArray(currentMetadata.linkedin_skills) ? currentMetadata.linkedin_skills : []),
        ...(Array.isArray(profileMetadata.linkedin_skills) ? profileMetadata.linkedin_skills : []),
      ],
      existingExperience: currentMetadata.linkedin_experience || profileMetadata.linkedin_experience || '',
      portfolioAbout: currentMetadata.portfolio_about || profileMetadata.portfolio_about || '',
      portfolioSkills: [
        ...(Array.isArray(currentMetadata.portfolio_skills) ? currentMetadata.portfolio_skills : []),
        ...(Array.isArray(profileMetadata.portfolio_skills) ? profileMetadata.portfolio_skills : []),
      ],
      extraContext: currentMetadata.extra_context || profileMetadata.extra_context || '',
      recentPostCount: recentPostsForPdf.length,
      recentPosts: recentPostsForPdf.map((post) => ({
        content: String(post.post_content || '').slice(0, 400),
        engagement: Number(post.likes || 0) + Number(post.comments || 0) + Number(post.shares || 0),
      })),
    };

    const authHeader = req.headers['authorization'];
    const userToken = req.cookies?.accessToken || (authHeader && authHeader.split(' ')[1]) || null;
    const refreshToken = req.cookies?.refreshToken;
    const cookieParts = [];
    if (userToken) cookieParts.push(`accessToken=${userToken}`);
    if (refreshToken) cookieParts.push(`refreshToken=${refreshToken}`);
    const cookieHeader = cookieParts.length > 0 ? cookieParts.join('; ') : null;

    let geminiExtraction = null;
    let geminiErrorMessage = null;
    try {
      geminiExtraction = await aiService.extractLinkedinProfileFromPdf(normalizedBase64, {
        filename: safeFilename,
        mimetype: safeMimetype || 'application/pdf',
        userToken,
        userId,
        cookieHeader,
        context: geminiContext,
      });
    } catch (error) {
      geminiErrorMessage = String(error?.message || 'gemini_pdf_extraction_failed').slice(0, 300);
      console.warn('[Strategy] Gemini PDF extraction failed, falling back to local parser', {
        userId,
        strategyId,
        filename: safeFilename,
        error: geminiErrorMessage,
      });
    }

    const localDiscoveries = extractLinkedInProfilePdfDiscoveries(pdfBuffer);
    const geminiParsed = geminiExtraction?.parsed || {};
    const useLocalFallback = !geminiExtraction;
    const discoveries = {
      about: pickReadableProfileText(
        useLocalFallback ? [geminiParsed.about, localDiscoveries.about] : [geminiParsed.about],
        700
      ),
      skills: dedupeStrings(
        [
          ...(Array.isArray(geminiParsed.skills) ? geminiParsed.skills : []),
          ...(useLocalFallback && Array.isArray(localDiscoveries.skills) ? localDiscoveries.skills : []),
        ],
        20
      ),
      experience: pickReadableProfileText(
        useLocalFallback ? [geminiParsed.experience, localDiscoveries.experience] : [geminiParsed.experience],
        700
      ),
      contentPreview: toShortText(
        pickReadableProfileText([geminiParsed.about, geminiParsed.experience], 2200) ||
          (useLocalFallback ? localDiscoveries.contentPreview : '') ||
          '',
        2500
      ),
      textLength: Number(localDiscoveries.textLength || 0),
      extractionSource: geminiExtraction ? 'gemini' : 'local_fallback',
      geminiProvider: geminiExtraction?.provider || null,
      geminiNormalizationPassUsed: Boolean(geminiExtraction?.normalizationPassUsed),
      geminiConfidence: String(geminiParsed.confidence || '').trim() || null,
      geminiNotes: toShortText(geminiParsed.notes || '', 240) || null,
      geminiError: geminiErrorMessage,
    };
    const rawDiscoverySignalCount =
      (discoveries.about ? 1 : 0) +
      ((Array.isArray(discoveries.skills) && discoveries.skills.length > 0) ? 1 : 0) +
      (discoveries.experience ? 1 : 0);

    const mergedLinkedinAbout = pickReadableProfileText(
      [discoveries.about, currentMetadata.linkedin_about, profileMetadata.linkedin_about],
      700
    );
    const mergedLinkedinSkills = dedupeStrings(
      [
        ...(Array.isArray(currentMetadata.linkedin_skills) ? currentMetadata.linkedin_skills : []),
        ...(Array.isArray(profileMetadata.linkedin_skills) ? profileMetadata.linkedin_skills : []),
        ...(Array.isArray(discoveries.skills) ? discoveries.skills : []),
      ],
      20
    );
    const mergedLinkedinExperience = pickReadableProfileText(
      [discoveries.experience, currentMetadata.linkedin_experience, profileMetadata.linkedin_experience],
      700
    );

    const mergedAbout = dedupeStrings(
      [mergedLinkedinAbout, currentMetadata.portfolio_about, profileMetadata.portfolio_about],
      3
    ).join(' ');
    const mergedSkills = dedupeStrings(
      [
        ...mergedLinkedinSkills,
        ...(Array.isArray(currentMetadata.portfolio_skills) ? currentMetadata.portfolio_skills : []),
        ...(Array.isArray(profileMetadata.portfolio_skills) ? profileMetadata.portfolio_skills : []),
      ],
      24
    );
    const mergedExperience = dedupeStrings(
      [mergedLinkedinExperience, currentMetadata.portfolio_experience, profileMetadata.portfolio_experience],
      3
    ).join(' ');
    const preservedUserContext = String(
      currentMetadata.user_context || profileMetadata.user_context || ''
    ).slice(0, 300);
    const combinedContext = buildCombinedContext({
      userContext: preservedUserContext,
      about: mergedAbout,
      skills: mergedSkills,
      experience: mergedExperience,
    });

    const uploadedAt = new Date().toISOString();
    const metadataPatch = {
      linkedin_about: mergedLinkedinAbout || null,
      linkedin_skills: mergedLinkedinSkills,
      linkedin_experience: mergedLinkedinExperience || null,
      linkedin_profile_pdf_filename: safeFilename || null,
      linkedin_profile_pdf_uploaded_at: uploadedAt,
      linkedin_profile_pdf_text_length: Number(discoveries.textLength || 0),
      linkedin_profile_pdf_content_preview: toShortText(discoveries.contentPreview || '', 2500) || null,
      linkedin_profile_pdf_source: 'user_upload',
      linkedin_profile_pdf_extraction_source: discoveries.extractionSource,
      linkedin_profile_pdf_ai_provider: discoveries.geminiProvider,
      linkedin_profile_pdf_ai_normalized: discoveries.geminiNormalizationPassUsed,
      linkedin_profile_pdf_ai_confidence: discoveries.geminiConfidence,
      linkedin_profile_pdf_ai_notes: discoveries.geminiNotes,
      linkedin_profile_pdf_ai_error: discoveries.geminiError,
      extra_context: toShortText(combinedContext, 3000),
      sourced_from: 'strategy_pdf_upload',
    };
    const safeMetadataPatch = sanitizeJsonSafeValue(metadataPatch);
    const safeProfileMetadata = sanitizeJsonSafeValue({
      ...profileMetadata,
      ...safeMetadataPatch,
    });

    await pool.query(
      `UPDATE user_strategies
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [strategyId, JSON.stringify(safeMetadataPatch)]
    );

    await linkedinAutomationService.upsertProfileContext(userId, {
      proof_points: toShortText(combinedContext, 1200) || undefined,
      metadata: safeProfileMetadata,
    });
    const refreshedStrategy = await strategyService.getStrategy(strategyId);
    await refreshContextVaultSafe({
      userId,
      strategy: refreshedStrategy || strategy,
      reason: 'linkedin_pdf_uploaded',
    });

    console.log('[Strategy] linkedin profile pdf uploaded', {
      userId,
      strategyId,
      filename: safeFilename,
      sizeBytes: pdfBuffer.length,
      textLength: Number(discoveries.textLength || 0),
      extractionSource: discoveries.extractionSource,
      aiProvider: discoveries.geminiProvider,
      aiNormalizationPassUsed: discoveries.geminiNormalizationPassUsed,
      aiConfidence: discoveries.geminiConfidence,
      aiError: discoveries.geminiError,
      hasAbout: Boolean(mergedLinkedinAbout),
      skillsCount: mergedLinkedinSkills.length,
      hasExperience: Boolean(mergedLinkedinExperience),
      aboutPreview: mergedLinkedinAbout.slice(0, 180) || null,
      skillsPreview: mergedLinkedinSkills.slice(0, 8),
      experiencePreview: mergedLinkedinExperience.slice(0, 180) || null,
    });

    const warningMessages = [];
    if (!geminiExtraction && geminiErrorMessage) {
      warningMessages.push(
        useLocalFallback
          ? 'Gemini extraction failed; used local parser fallback.'
          : 'Gemini extraction failed and local fallback was skipped to avoid noisy output. Try a clearer text-selectable PDF.'
      );
    }
    if (rawDiscoverySignalCount === 0) {
      warningMessages.push('Could not reliably parse readable profile text from this PDF. Please upload a text-selectable PDF export.');
    }

    return res.json({
      success: true,
      warning: warningMessages.length > 0 ? warningMessages.join(' ') : null,
      discoveries: {
        about: mergedLinkedinAbout || '',
        skills: mergedLinkedinSkills,
        experience: mergedLinkedinExperience || '',
        confidence:
          discoveries.geminiConfidence ||
          (discoveries.extractionSource === 'local_fallback' ? 'low' : null),
        notes: discoveries.geminiNotes || null,
        filename: safeFilename,
        textLength: Number(discoveries.textLength || 0),
        extractionSource: discoveries.extractionSource,
      },
    });
  } catch (error) {
    console.error('[Strategy] upload-linkedin-profile-pdf error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process LinkedIn profile PDF.' });
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
    const normalizedPortfolioUrl = normalizePortfolioUrl(portfolioUrl);
    const normalizedUserContext = String(userContext || '').trim();

    console.log('[Strategy] init-analysis request', {
      userId,
      strategyId,
      accountId,
      accountType,
      hasPortfolioUrl: Boolean(normalizedPortfolioUrl),
      hasUserContext: Boolean(normalizedUserContext),
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
    const [accountSnapshot, portfolioMetadata] = await Promise.all([
      linkedinAutomationService.getLinkedinAccountSnapshot(userId, {
        accountId,
        accountType,
      }),
      normalizedPortfolioUrl ? fetchPortfolioMetadata(normalizedPortfolioUrl) : Promise.resolve(null),
    ]);

    if (normalizedPortfolioUrl) {
      console.log('[Strategy] portfolio metadata fetch result', {
        userId,
        strategyId,
        portfolioUrl: normalizedPortfolioUrl,
        fetched: Boolean(portfolioMetadata?.fetched),
        status: portfolioMetadata?.status || null,
        error: portfolioMetadata?.error || null,
        title: String(portfolioMetadata?.title || '').slice(0, 120) || null,
        hasAbout: Boolean(String(portfolioMetadata?.about || '').trim()),
        skillsCount: Array.isArray(portfolioMetadata?.skills) ? portfolioMetadata.skills.length : 0,
        hasExperience: Boolean(String(portfolioMetadata?.experience || '').trim()),
        contentPreview: String(portfolioMetadata?.contentPreview || '').slice(0, 500),
      });
    }

    const portfolioAbout = String(
      portfolioMetadata?.about || currentMetadata.portfolio_about || ''
    ).trim();
    const portfolioSkills = Array.isArray(portfolioMetadata?.skills) && portfolioMetadata.skills.length > 0
      ? portfolioMetadata.skills
      : (Array.isArray(currentMetadata.portfolio_skills) ? currentMetadata.portfolio_skills : []);
    const portfolioExperience = String(
      portfolioMetadata?.experience || currentMetadata.portfolio_experience || ''
    ).trim();
    const linkedinAbout = String(
      accountSnapshot?.about || currentMetadata.linkedin_about || ''
    ).trim();
    const linkedinSkills = Array.isArray(accountSnapshot?.skills) && accountSnapshot.skills.length > 0
      ? accountSnapshot.skills
      : (Array.isArray(currentMetadata.linkedin_skills) ? currentMetadata.linkedin_skills : []);
    const linkedinExperience = String(
      accountSnapshot?.experience || currentMetadata.linkedin_experience || ''
    ).trim();
    console.log('[Strategy] linkedin profile discoveries', {
      userId,
      strategyId,
      hasLinkedinAbout: Boolean(linkedinAbout),
      linkedinSkillsCount: linkedinSkills.length,
      hasLinkedinExperience: Boolean(linkedinExperience),
      linkedinAboutPreview: linkedinAbout.slice(0, 180) || null,
      linkedinSkillsPreview: linkedinSkills.slice(0, 8),
      linkedinExperiencePreview: linkedinExperience.slice(0, 180) || null,
    });

    const mergedAbout = dedupeStrings([linkedinAbout, portfolioAbout], 2).join(' ');
    const mergedSkills = dedupeStrings([...(Array.isArray(linkedinSkills) ? linkedinSkills : []), ...(Array.isArray(portfolioSkills) ? portfolioSkills : [])], 20);
    const mergedExperience = dedupeStrings([linkedinExperience, portfolioExperience], 2).join(' ');
    const combinedContext = buildCombinedContext({
      userContext: normalizedUserContext,
      about: mergedAbout,
      skills: mergedSkills,
      experience: mergedExperience,
    });
    const combinedContextValue = String(combinedContext || '').trim();
    const extraContext = combinedContextValue
      ? combinedContextValue.slice(0, 3000)
      : String(currentMetadata.extra_context || '').slice(0, 3000);
    const proofPoints = combinedContextValue
      ? combinedContextValue.slice(0, 1200)
      : '';
    const portfolioFetchStatus = normalizedPortfolioUrl
      ? (portfolioMetadata?.fetched ? 'fetched' : 'failed')
      : (currentMetadata.portfolio_fetch_status || 'not_provided');
    const portfolioFetchError = normalizedPortfolioUrl
      ? (portfolioMetadata?.error || null)
      : (currentMetadata.portfolio_fetch_error || null);
    const portfolioFetchedAt = normalizedPortfolioUrl && portfolioMetadata?.fetched
      ? new Date().toISOString()
      : (currentMetadata.portfolio_fetched_at || null);
    const portfolioContentPreview = normalizedPortfolioUrl
      ? String(portfolioMetadata?.contentPreview || '').slice(0, 2500)
      : String(currentMetadata.portfolio_content_preview || '').slice(0, 2500);

    const profileHeadline = String(
      accountSnapshot?.headline || currentMetadata.profile_headline || ''
    ).trim();
    const profileDisplayName = String(accountSnapshot?.display_name || currentMetadata.profile_display_name || '').trim();
    const strategyNiche = String(strategy.niche || '').trim();
    const metadataNiche = String(currentMetadata.role_niche || '').trim();
    const seededNicheCandidates = [
      profileHeadline,
      linkedinAbout,
      linkedinExperience,
      linkedinSkills.join(' '),
      portfolioAbout,
      portfolioExperience,
      portfolioSkills.join(' '),
      metadataNiche,
      strategyNiche,
    ]
      .map((value) => extractCompactNicheFromText(value))
      .filter(Boolean)
      .filter((value) => !isJunkNicheCandidate(value, profileDisplayName))
      .filter((value) => !isOverlyGenericNicheValue(value));
    const seededRoleNiche = String(seededNicheCandidates[0] || '').trim();
    const roleNicheForUpsert = seededRoleNiche || '';
    const proofPointsForUpsert = proofPoints || undefined;

    await linkedinAutomationService.upsertProfileContext(userId, {
      role_niche: roleNicheForUpsert,
      target_audience: strategy.target_audience || '',
      outcomes_30_90: derivedGoals || currentMetadata.outcomes_30_90 || '',
      proof_points: proofPointsForUpsert,
      tone_style: normalizeToneEnum(strategy.tone_style),
      consent_use_posts: true,
      consent_store_profile: true,
      metadata: {
        ...currentMetadata,
        portfolio_url: normalizedPortfolioUrl || currentMetadata.portfolio_url || '',
        portfolio_fetch_status: portfolioFetchStatus,
        portfolio_fetch_error: portfolioFetchError,
        portfolio_fetched_at: portfolioFetchedAt,
        portfolio_title: String(portfolioMetadata?.title || currentMetadata.portfolio_title || '').slice(0, 180),
        portfolio_description: String(portfolioMetadata?.description || currentMetadata.portfolio_description || '').slice(0, 500),
        portfolio_about: portfolioAbout ? portfolioAbout.slice(0, 700) : null,
        portfolio_skills: portfolioSkills,
        portfolio_experience: portfolioExperience ? portfolioExperience.slice(0, 700) : null,
        linkedin_about: linkedinAbout ? linkedinAbout.slice(0, 700) : null,
        linkedin_skills: linkedinSkills,
        linkedin_experience: linkedinExperience ? linkedinExperience.slice(0, 700) : null,
        portfolio_content_preview: portfolioContentPreview || null,
        user_context: normalizedUserContext || currentMetadata.user_context || '',
        extra_context: extraContext,
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
    console.log('[Strategy] niche derivation snapshot', {
      userId,
      strategyId,
      selectedNiche: analysisData?.niche || null,
      selectedAudience: analysisData?.audience || null,
      topTopics: Array.isArray(analysisData?.top_topics) ? analysisData.top_topics.slice(0, 8) : [],
      roleNicheInput: String(profileContext?.role_niche || '').slice(0, 120),
      strategyNicheInput: String(strategy?.niche || '').slice(0, 120),
      profileHeadlineInput: String(analysisAccountSnapshot?.headline || '').slice(0, 160),
      linkedinAboutInput: String(profileContext?.metadata?.linkedin_about || '').slice(0, 200),
      linkedinExperienceInput: String(profileContext?.metadata?.linkedin_experience || '').slice(0, 200),
      linkedinSkillsCount: Array.isArray(profileContext?.metadata?.linkedin_skills)
        ? profileContext.metadata.linkedin_skills.length
        : 0,
      portfolioTitleInput: String(profileContext?.metadata?.portfolio_title || '').slice(0, 160),
      portfolioSkillsCount: Array.isArray(profileContext?.metadata?.portfolio_skills)
        ? profileContext.metadata.portfolio_skills.length
        : 0,
    });
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
      portfolio_url: normalizedPortfolioUrl || currentMetadata.portfolio_url || '',
      portfolio_fetch_status: portfolioFetchStatus,
      portfolio_fetch_error: portfolioFetchError,
      portfolio_about: portfolioAbout ? portfolioAbout.slice(0, 700) : null,
      portfolio_skills: portfolioSkills,
      portfolio_experience: portfolioExperience ? portfolioExperience.slice(0, 700) : null,
      linkedin_about: linkedinAbout ? linkedinAbout.slice(0, 700) : null,
      linkedin_skills: linkedinSkills,
      linkedin_experience: linkedinExperience ? linkedinExperience.slice(0, 700) : null,
      user_context: normalizedUserContext || currentMetadata.user_context || '',
      queue_preview_count: Array.isArray(runResult.queue) ? runResult.queue.length : 0,
    };
    await updateRunMetadata(runResult.runId, nextMetadata);
    const refreshedStrategy = await strategyService.getStrategy(strategyId);
    await refreshContextVaultSafe({
      userId,
      strategy: refreshedStrategy || strategy,
      reason: 'analysis_completed',
    });

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
      portfolioFetchStatus,
      portfolioSkillsCount: portfolioSkills.length,
      hasPortfolioAbout: Boolean(portfolioAbout),
      hasPortfolioExperience: Boolean(portfolioExperience),
      linkedinSkillsCount: linkedinSkills.length,
      hasLinkedinAbout: Boolean(linkedinAbout),
      hasLinkedinExperience: Boolean(linkedinExperience),
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
    await refreshContextVaultSafe({
      userId,
      strategyId,
      reason: 'analysis_prompt_pack_generated',
    });

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
    const promptGeneratedAt = new Date().toISOString();

    let contentPlan = {
      runId: null,
      queueCount: 0,
      status: 'failed',
    };
    let contentPlanWarning = null;
    let contentPlanPromptIds = [];

    try {
      await syncProfileContextWithConfirmedAnalysis({
        userId,
        strategyId,
        strategy,
        analysisData,
        analysisMetadata: metadata,
      });

      const runResult = await linkedinAutomationService.runPipeline({
        userId,
        queueTarget: CONTENT_PLAN_QUEUE_TARGET,
        userToken: getUserTokenFromRequest(req),
        cookieHeader: buildCookieHeader(req),
      });

      contentPlan = {
        runId: runResult?.runId || null,
        queueCount: Array.isArray(runResult?.queue) ? runResult.queue.length : 0,
        status: 'ready',
      };

      contentPlanPromptIds = await markContentPlanPromptsUsed({
        userId,
        strategyId,
        runId: contentPlan.runId,
        queueCount: contentPlan.queueCount || CONTENT_PLAN_QUEUE_TARGET,
      });
    } catch (contentPlanError) {
      contentPlanWarning = toShortText(
        contentPlanError?.message || 'Content plan generation failed.',
        260
      );
      console.warn('[Strategy] content plan generation warning', {
        userId,
        strategyId,
        analysisId,
        warning: contentPlanWarning,
      });
    }

    const refreshedStrategy = await strategyService.getStrategy(strategyId);
    const refreshedStrategyMetadata = parseJsonObject(refreshedStrategy?.metadata, {});
    const nextStrategyMetadata = {
      ...refreshedStrategyMetadata,
      content_plan_run_id: contentPlan.runId || refreshedStrategyMetadata.content_plan_run_id || null,
      content_plan_generated_at:
        contentPlan.runId ? promptGeneratedAt : (refreshedStrategyMetadata.content_plan_generated_at || null),
      content_plan_queue_count:
        contentPlan.runId
          ? Number(contentPlan.queueCount || 0)
          : Number(refreshedStrategyMetadata.content_plan_queue_count || 0),
      content_plan_status: contentPlan.runId ? 'ready' : 'failed',
      content_plan_prompt_ids: contentPlan.runId
        ? dedupeStrings(contentPlanPromptIds, 8)
        : (Array.isArray(refreshedStrategyMetadata.content_plan_prompt_ids)
            ? refreshedStrategyMetadata.content_plan_prompt_ids
            : []),
      content_plan_prompt_used_at: contentPlan.runId
        ? promptGeneratedAt
        : (refreshedStrategyMetadata.content_plan_prompt_used_at || null),
    };
    if (contentPlanWarning) {
      nextStrategyMetadata.content_plan_warning = contentPlanWarning;
    } else {
      delete nextStrategyMetadata.content_plan_warning;
    }

    await strategyService.updateStrategy(strategyId, {
      metadata: nextStrategyMetadata,
    });

    metadata.prompt_generation = {
      generated_at: promptGeneratedAt,
      count: result?.count || 0,
      success: true,
    };
    metadata.content_plan = {
      run_id: contentPlan.runId,
      generated_at: contentPlan.runId
        ? promptGeneratedAt
        : (nextStrategyMetadata.content_plan_generated_at || null),
      queue_count: contentPlan.runId
        ? Number(contentPlan.queueCount || 0)
        : Number(nextStrategyMetadata.content_plan_queue_count || 0),
      status: nextStrategyMetadata.content_plan_status || 'failed',
      warning: contentPlanWarning || null,
      prompt_ids: Array.isArray(nextStrategyMetadata.content_plan_prompt_ids)
        ? nextStrategyMetadata.content_plan_prompt_ids
        : [],
    };
    await updateRunMetadata(analysisId, metadata);

    return res.json({
      success: true,
      promptCount: result?.count || 0,
      prompts: result?.prompts || [],
      contentPlan: {
        runId: contentPlan.runId,
        queueCount: contentPlan.runId
          ? Number(contentPlan.queueCount || 0)
          : Number(nextStrategyMetadata.content_plan_queue_count || 0),
        status: nextStrategyMetadata.content_plan_status || 'failed',
        warning: contentPlanWarning || undefined,
        promptIds: Array.isArray(nextStrategyMetadata.content_plan_prompt_ids)
          ? nextStrategyMetadata.content_plan_prompt_ids
          : [],
      },
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

// POST /api/strategy/:id/content-plan/generate - generate strategy-scoped publish-ready queue
router.post('/:id/content-plan/generate', async (req, res) => {
  try {
    const strategyId = req.params.id;
    const userId = req.user.id;

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategyMetadata = parseJsonObject(strategy.metadata, {});
    const analysisCache = parseJsonObject(strategyMetadata.analysis_cache, {});
    const cachedAnalysisId = String(analysisCache.analysis_id || '').trim();

    let analysisRun = null;
    if (cachedAnalysisId) {
      analysisRun = await getRunById(cachedAnalysisId, userId);
    }
    if (!analysisRun) {
      analysisRun = await getLatestAnalysisRunForStrategy({ userId, strategyId });
    }
    if (!analysisRun) {
      return res.status(400).json({
        error: 'No analysis found for this strategy. Run analysis first, then generate content plan.',
      });
    }

    const analysisMetadata = parseJsonObject(analysisRun.metadata, {});
    const analysisData = sanitizeAnalysisData(
      analysisMetadata.analysis_data || analysisCache || {}
    );

    await syncProfileContextWithConfirmedAnalysis({
      userId,
      strategyId,
      strategy,
      analysisData,
      analysisMetadata,
    });

    const runResult = await linkedinAutomationService.runPipeline({
      userId,
      queueTarget: CONTENT_PLAN_QUEUE_TARGET,
      userToken: getUserTokenFromRequest(req),
      cookieHeader: buildCookieHeader(req),
    });

    const generatedAt = new Date().toISOString();
    const queueCount = Array.isArray(runResult?.queue) ? runResult.queue.length : 0;
    const contentPlanPromptIds = await markContentPlanPromptsUsed({
      userId,
      strategyId,
      runId: runResult?.runId || null,
      queueCount: queueCount || CONTENT_PLAN_QUEUE_TARGET,
    });
    const refreshedAfterPromptUsage = await strategyService.getStrategy(strategyId);
    const refreshedMetadata = parseJsonObject(refreshedAfterPromptUsage?.metadata, {});
    const nextStrategyMetadata = {
      ...refreshedMetadata,
      content_plan_run_id: runResult?.runId || null,
      content_plan_generated_at: generatedAt,
      content_plan_queue_count: Number(queueCount || 0),
      content_plan_status: 'ready',
      content_plan_prompt_ids: dedupeStrings(contentPlanPromptIds, 8),
      content_plan_prompt_used_at: generatedAt,
    };
    delete nextStrategyMetadata.content_plan_warning;

    await strategyService.updateStrategy(strategyId, {
      metadata: nextStrategyMetadata,
    });

    await updateRunMetadata(analysisRun.id, {
      ...analysisMetadata,
      content_plan: {
        run_id: runResult?.runId || null,
        generated_at: generatedAt,
        queue_count: Number(queueCount || 0),
        status: 'ready',
        warning: null,
        prompt_ids: dedupeStrings(contentPlanPromptIds, 8),
      },
    });
    const refreshedStrategy = await strategyService.getStrategy(strategyId);
    await refreshContextVaultSafe({
      userId,
      strategy: refreshedStrategy || strategy,
      reason: 'content_plan_generated',
    });

    return res.json({
      success: true,
      contentPlan: {
        runId: runResult?.runId || null,
        queueCount: Number(queueCount || 0),
        status: 'ready',
        promptIds: dedupeStrings(contentPlanPromptIds, 8),
      },
    });
  } catch (error) {
    console.error('[Strategy] content-plan generate error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate content plan' });
  }
});

// GET /api/strategy/:id/context-vault - fetch latest strategy context vault snapshot
router.get('/:id/context-vault', async (req, res) => {
  try {
    const strategyId = req.params.id;
    const userId = req.user.id;
    const shouldRefresh = String(req.query.refresh || '').toLowerCase() === 'true';

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    let vault = await contextVaultService.getByStrategy({ userId, strategyId });
    if (!vault || shouldRefresh) {
      vault = await refreshContextVaultSafe({
        userId,
        strategy,
        reason: shouldRefresh ? 'context_vault_manual_refresh' : 'context_vault_bootstrap',
      });
    }

    return res.json({
      success: true,
      vault: vault || null,
    });
  } catch (error) {
    console.error('[Strategy] context-vault fetch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to load context vault' });
  }
});

// POST /api/strategy/:id/context-vault/refresh - force refresh strategy context vault snapshot
router.post('/:id/context-vault/refresh', async (req, res) => {
  try {
    const strategyId = req.params.id;
    const userId = req.user.id;
    const reasonInput = String(req.body?.reason || '').trim();

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const vault = await refreshContextVaultSafe({
      userId,
      strategy,
      reason: reasonInput || 'context_vault_manual_refresh',
    });

    return res.json({
      success: true,
      vault: vault || null,
    });
  } catch (error) {
    console.error('[Strategy] context-vault refresh error:', error);
    return res.status(500).json({ error: error.message || 'Failed to refresh context vault' });
  }
});

// POST /api/strategy/:id/context-vault/apply - apply vault insights to strategy fields
router.post('/:id/context-vault/apply', async (req, res) => {
  try {
    const strategyId = req.params.id;
    const userId = req.user.id;
    const mode = String(req.body?.mode || 'merge').trim().toLowerCase();
    const useWinningOnly = Boolean(req.body?.useWinningOnly ?? true);

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    let vault = await contextVaultService.getByStrategy({ userId, strategyId });
    if (!vault) {
      vault = await refreshContextVaultSafe({
        userId,
        strategy,
        reason: 'context_vault_apply_bootstrap',
      });
    }
    if (!vault?.snapshot || typeof vault.snapshot !== 'object') {
      return res.status(400).json({ error: 'Context vault snapshot not available' });
    }

    const snapshot = parseJsonObject(vault.snapshot, {});
    const discoveries = parseJsonObject(snapshot.discoveries, {});
    const context = parseJsonObject(snapshot.context, {});

    const winningTopics = normalizeTopicList(
      Array.isArray(discoveries.winningTopics) ? discoveries.winningTopics : [],
      10
    );
    const underusedTopics = normalizeTopicList(
      Array.isArray(discoveries.underusedTopics) ? discoveries.underusedTopics : [],
      8
    );
    const vaultTopics = normalizeTopicList(
      Array.isArray(context.topics) ? context.topics : [],
      12
    );

    const pickedTopics = dedupeStrings(
      [
        ...winningTopics,
        ...(useWinningOnly ? [] : underusedTopics.slice(0, 4)),
        ...vaultTopics.slice(0, 4),
      ],
      12
    );
    if (pickedTopics.length === 0) {
      return res.status(400).json({ error: 'No usable topics found in context vault' });
    }

    const existingTopics = normalizeTopicList(Array.isArray(strategy.topics) ? strategy.topics : [], 20);
    const nextTopics =
      mode === 'replace'
        ? normalizeTopicList(pickedTopics, 20)
        : normalizeTopicList([...existingTopics, ...pickedTopics], 20);

    const strategyMetadata = parseJsonObject(strategy.metadata, {});
    const nowIso = new Date().toISOString();
    const nextMetadata = sanitizeJsonSafeValue({
      ...strategyMetadata,
      prompts_stale: true,
      prompts_stale_at: nowIso,
      prompts_refresh_recommendation: 'partial',
      last_strategy_update_source: 'context_vault_apply',
      context_vault: {
        ...(parseJsonObject(strategyMetadata.context_vault, {})),
        last_applied_at: nowIso,
        last_applied_mode: mode === 'replace' ? 'replace' : 'merge',
        last_applied_topics: pickedTopics.slice(0, 12),
      },
    });

    const updatedStrategy = await strategyService.updateStrategy(strategyId, {
      topics: nextTopics,
      metadata: nextMetadata,
    });
    const refreshedVault = await refreshContextVaultSafe({
      userId,
      strategy: updatedStrategy || strategy,
      reason: 'context_vault_apply',
    });

    return res.json({
      success: true,
      strategy: updatedStrategy,
      vault: refreshedVault || null,
      applied: {
        mode: mode === 'replace' ? 'replace' : 'merge',
        topicsAdded: pickedTopics,
        nextTopicCount: nextTopics.length,
      },
    });
  } catch (error) {
    console.error('[Strategy] context-vault apply error:', error);
    return res.status(500).json({ error: error.message || 'Failed to apply context vault insights' });
  }
});

// GET /api/strategy/:id/content-plan - strategy-scoped publish-ready queue
router.get('/:id/content-plan', async (req, res) => {
  try {
    const strategyId = req.params.id;
    const userId = req.user.id;

    const strategy = await strategyService.getStrategy(strategyId);
    if (!strategy || strategy.user_id !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    const strategyMetadata = parseJsonObject(strategy.metadata, {});
    const runId = String(strategyMetadata.content_plan_run_id || '').trim();
    const generatedAt = strategyMetadata.content_plan_generated_at || null;
    const storedStatus = String(strategyMetadata.content_plan_status || '').trim().toLowerCase();
    const warning = toShortText(strategyMetadata.content_plan_warning || '', 260) || null;
    const contentPlanPromptIds = Array.isArray(strategyMetadata.content_plan_prompt_ids)
      ? dedupeStrings(strategyMetadata.content_plan_prompt_ids, 8)
      : [];
    const analysisCache = parseJsonObject(strategyMetadata.analysis_cache, {});
    const analysisRunId = String(analysisCache.analysis_id || '').trim();

    let analysisRun = null;
    if (analysisRunId) {
      analysisRun = await getRunById(analysisRunId, userId);
    }

    if (!runId) {
      return res.json({
        success: true,
        runId: null,
        generatedAt,
        status: storedStatus || 'not_generated',
        warning,
        queueCount: 0,
        promptIds: contentPlanPromptIds,
        context: buildContentPlanContextPayload({ strategy, analysisRun }),
        queue: [],
      });
    }

    const run = await getRunById(runId, userId);
    if (!run) {
      return res.json({
        success: true,
        runId,
        generatedAt,
        status: 'failed',
        warning: warning || 'Saved content plan run could not be found.',
        queueCount: 0,
        promptIds: contentPlanPromptIds,
        context: buildContentPlanContextPayload({ strategy, analysisRun }),
        queue: [],
      });
    }

    if (!analysisRun) {
      analysisRun = run;
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM linkedin_automation_queue
       WHERE user_id = $1 AND run_id = $2
       ORDER BY created_at ASC`,
      [userId, runId]
    );

    const queue = rows.map((item) => {
      const itemMetadata = parseJsonObject(item.metadata, {});
      return {
        id: item.id,
        runId: item.run_id,
        title: item.title || '',
        content: item.content || '',
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
        status: item.status || 'draft',
        rejectionReason: item.rejection_reason || '',
        analysisSnapshot: parseJsonObject(item.analysis_snapshot, {}),
        reason: toShortText(itemMetadata.reason || '', 300),
        suggestedDayOffset: Number(itemMetadata.suggested_day_offset || 0),
        suggestedLocalTime: toShortText(itemMetadata.suggested_local_time || '', 12),
        metadata: itemMetadata,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      };
    });

    return res.json({
      success: true,
      runId,
      generatedAt: generatedAt || run.created_at || null,
      status: storedStatus || (queue.length > 0 ? 'ready' : 'empty'),
      warning,
      queueCount: queue.length,
      promptIds: contentPlanPromptIds,
      context: buildContentPlanContextPayload({ strategy, analysisRun }),
      queue,
    });
  } catch (error) {
    console.error('[Strategy] content-plan error:', error);
    return res.status(500).json({ error: error.message || 'Failed to load content plan' });
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

// Mark prompt as used (for usage-aware refresh recommendations)
router.post('/prompts/:promptId/mark-used', async (req, res) => {
  try {
    const { promptId } = req.params;
    const userId = req.user.id;
    const rawStrategyId = typeof req.body?.strategyId === 'string' ? req.body.strategyId.trim() : '';
    const strategyId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawStrategyId)
      ? rawStrategyId
      : null;

    const result = await strategyService.markPromptUsed(promptId, userId, { strategyId });
    res.json({
      success: true,
      prompt: result.prompt,
      usage: result.usage,
    });
  } catch (error) {
    if ((error?.message || '').toLowerCase().includes('not found')) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    console.error('Error marking prompt as used:', error);
    return res.status(500).json({ error: 'Failed to mark prompt as used' });
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

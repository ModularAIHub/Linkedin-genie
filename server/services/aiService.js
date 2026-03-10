import OpenAI from 'openai';
import axios from 'axios';
import { sanitizeInput } from '../utils/sanitization.js';

// Simple rate limiter
const rateLimits = new Map();
function checkRateLimit(userId) {
  if (!userId) return { allowed: true };
  
  const key = userId;
  const now = Date.now();
  const limit = { maxRequests: 50, windowMs: 60 * 60 * 1000 }; // 50/hour
  
  if (!rateLimits.has(key)) {
    rateLimits.set(key, { count: 1, resetTime: now + limit.windowMs });
    return { allowed: true };
  }
  
  const userLimit = rateLimits.get(key);
  if (now >= userLimit.resetTime) {
    userLimit.count = 1;
    userLimit.resetTime = now + limit.windowMs;
    return { allowed: true };
  }
  
  if (userLimit.count >= limit.maxRequests) {
    const resetIn = Math.ceil((userLimit.resetTime - now) / 1000 / 60);
    return { allowed: false, error: `Rate limit exceeded. Try again in ${resetIn} minutes.` };
  }
  
  userLimit.count++;
  return { allowed: true };
}

// Fetch user BYOK preference and keys with retry logic.
// cookieHeader should include both accessToken and refreshToken cookies so
// new-platform's authenticateToken can run its refresh-token fallback when
// the short-lived (15m) accessToken has expired.
async function getUserPreferenceAndKeys(userToken, maxRetries = 3, cookieHeader = null) {
  const baseUrl = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';

  const buildHeaders = () => {
    const headers = {};
    if (cookieHeader) headers['Cookie'] = cookieHeader;
    if (userToken) headers['Authorization'] = `Bearer ${userToken}`;
    return headers;
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const prefRes = await axios.get(`${baseUrl}/byok/preference`, {
        headers: buildHeaders(),
        timeout: 5000
      });
      const preference = prefRes.data.api_key_preference;
      let userKeys = [];
      
      if (preference === 'byok') {
        const keysRes = await axios.get(`${baseUrl}/byok/keys`, {
          headers: buildHeaders(),
          timeout: 5000
        });
        userKeys = keysRes.data.keys;
      }
      
      return { preference, userKeys };
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }
}

const stripMarkdownCodeFences = (value = '') =>
  String(value || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

const extractJsonObjectFromText = (value = '') => {
  const text = stripMarkdownCodeFences(value);
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

const extractJsonObjectLoose = (value = '') => {
  const text = stripMarkdownCodeFences(value);
  const candidates = [];
  if (text) candidates.push(text);
  const bracketMatch = text.match(/\{[\s\S]*\}/);
  if (bracketMatch?.[0]) candidates.push(bracketMatch[0]);

  const normalizedCandidates = candidates
    .map((candidate) => String(candidate || '').trim())
    .filter(Boolean)
    .flatMap((candidate) => {
      const base = candidate
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'");
      const repairedSingleQuotes = base
        .replace(/([{,]\s*)'([^']+?)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*?)'/g, (_match, inner) => {
          const escaped = String(inner || '')
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
          return `: "${escaped}"`;
        });
      const repairedTrailingCommas = repairedSingleQuotes.replace(/,\s*([}\]])/g, '$1');
      return [candidate, base, repairedSingleQuotes, repairedTrailingCommas];
    });

  for (const candidate of normalizedCandidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next
    }
  }
  return null;
};

const normalizeSimpleText = (value = '', max = 1200) =>
  String(value || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(0, Number(max) || 1200));

const normalizeStringArray = (values = [], maxItems = 20, maxText = 64) => {
  const list = Array.isArray(values) ? values : [];
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const normalized = normalizeSimpleText(value, maxText);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
};

const LINKEDIN_PDF_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    about: { type: 'STRING' },
    skills: { type: 'ARRAY', items: { type: 'STRING' } },
    experience: { type: 'STRING' },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
    notes: { type: 'STRING' },
  },
  required: ['about', 'skills', 'experience', 'confidence', 'notes'],
};

const STRATEGY_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    analysis: {
      type: 'OBJECT',
      properties: {
        strengths: { type: 'ARRAY', items: { type: 'STRING' } },
        gaps: { type: 'ARRAY', items: { type: 'STRING' } },
        opportunities: { type: 'ARRAY', items: { type: 'STRING' } },
        nextAngles: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['strengths', 'gaps', 'opportunities', 'nextAngles'],
    },
    queue: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          content: { type: 'STRING' },
          hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
          reason: { type: 'STRING' },
          suggested_day_offset: { type: 'NUMBER' },
          suggested_local_time: { type: 'STRING' },
        },
        required: [
          'title',
          'content',
          'hashtags',
          'reason',
          'suggested_day_offset',
          'suggested_local_time',
        ],
      },
    },
  },
  required: ['analysis', 'queue'],
};

const TREND_SIGNALS_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    trends: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          topic: { type: 'STRING' },
          trigger: { type: 'STRING' },
          implication: { type: 'STRING' },
          source: { type: 'STRING' },
          confidence: { type: 'STRING' },
        },
        required: ['topic', 'trigger', 'implication'],
      },
    },
  },
  required: ['trends'],
};

class AIService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      this.openai = null;
    }
    this.perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    this.googleApiKey = process.env.GOOGLE_AI_API_KEY;
  }

  // FIXED: Added input validation
  validatePrompt(prompt, options = {}) {
    const maxLength = Number.isFinite(options?.maxLength)
      ? Math.max(200, Math.floor(options.maxLength))
      : 2000;
    const minLength = Number.isFinite(options?.minLength)
      ? Math.max(1, Math.floor(options.minLength))
      : 5;

    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt');
    }
    
    const trimmed = prompt.trim();
    
    if (trimmed.length < minLength) throw new Error(`Prompt too short (min ${minLength} characters)`);
    if (trimmed.length > maxLength) throw new Error(`Prompt too long (max ${maxLength} characters)`);
    
    // Block prompt injection
    const dangerousPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/gi,
      /disregard\s+(all\s+)?prior\s+instructions/gi,
      /system\s*:\s*you\s+are/gi,
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmed)) {
        throw new Error('Invalid prompt content detected');
      }
    }
    
    return trimmed;
  }

  async generateContent(prompt, style = 'casual', maxRetries = 3, userToken = null, userId = null, cookieHeader = null) {
    // FIXED: Validate input
    const validatedPrompt = this.validatePrompt(prompt);
    const sanitizedPrompt = sanitizeInput(validatedPrompt);
    
    // FIXED: Rate limiting
    if (userId) {
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }

    // Helper function to convert markdown bold to Unicode bold
    const convertMarkdownToUnicode = (text) => {
      const boldMap = {
        a: '𝗮', b: '𝗯', c: '𝗰', d: '𝗱', e: '𝗲', f: '𝗳', g: '𝗴', h: '𝗵', i: '𝗶', j: '𝗷',
        k: '𝗸', l: '𝗹', m: '𝗺', n: '𝗻', o: '𝗼', p: '𝗽', q: '𝗾', r: '𝗿', s: '𝘀', t: '𝘁',
        u: '𝘂', v: '𝘃', w: '𝘄', x: '𝘅', y: '𝘆', z: '𝘇',
        A: '𝗔', B: '𝗕', C: '𝗖', D: '𝗗', E: '𝗘', F: '𝗙', G: '𝗚', H: '𝗛', I: '𝗜', J: '𝗝',
        K: '𝗞', L: '𝗟', M: '𝗠', N: '𝗡', O: '𝗢', P: '𝗣', Q: '𝗤', R: '𝗥', S: '𝗦', T: '𝗧',
        U: '𝗨', V: '𝗩', W: '𝗪', X: '𝗫', Y: '𝗬', Z: '𝗭',
        0: '𝟬', 1: '𝟭', 2: '𝟮', 3: '𝟯', 4: '𝟰', 5: '𝟱', 6: '𝟲', 7: '𝟳', 8: '𝟴', 9: '𝟵'
      };
      
      return text.replace(/\*\*([^*]+)\*\*/g, (match, content) => {
        return content.split('').map(char => boldMap[char] || char).join('');
      });
    };

    // Fetch user preference with error handling
    let preference = 'platform';
    let userKeys = [];
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken, 3, cookieHeader);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        // FIXED: Don't log API keys, only metadata
        console.log('[AI Service] User preference:', preference);
        console.log('[AI Service] Available providers:', userKeys.map(k => k.provider).join(', '));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys:', err.message);
        // Continue with platform keys
      }
    }

    // Build providers array
    const providers = [];
    
    let perplexityKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'perplexity')?.apiKey) : this.perplexityApiKey;
    if (perplexityKey) {
      providers.push({ 
        name: 'perplexity', 
        keyType: preference === 'byok' ? 'BYOK' : 'platform', 
        method: (p, s) => this.generateWithPerplexity(p, s, perplexityKey) 
      });
    }
    
    let googleKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'gemini')?.apiKey) : this.googleApiKey;
    if (googleKey) {
      providers.push({ 
        name: 'google', 
        keyType: preference === 'byok' ? 'BYOK' : 'platform', 
        method: (p, s) => this.generateWithGoogle(p, s, googleKey) 
      });
    }
    
    let openaiKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'openai')?.apiKey) : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      providers.push({ 
        name: 'openai', 
        keyType: preference === 'byok' ? 'BYOK' : 'platform', 
        method: (p, s) => this.generateWithOpenAI(p, s, openaiKey) 
      });
    }

    if (providers.length === 0) {
      const errorMsg = preference === 'byok' 
        ? 'No AI providers available. Please add your API keys in settings or switch to Platform mode.'
        : 'No platform AI providers configured. Please contact support or try BYOK mode.';
      throw new Error(errorMsg);
    }

    console.log(`Available AI providers: ${providers.map(p => p.name).join(', ')}`);

    // Try each provider
    let lastError = null;
    const authFailures = [];
    for (const provider of providers) {
      try {
        if (userId) {
          console.log(`[AI Key Usage] userId=${userId} provider=${provider.name} keyType=${provider.keyType}`);
        }
        console.log(`Attempting content generation with ${provider.name}...`);
        
        const result = await provider.method(sanitizedPrompt, style);
        
        // Convert markdown bold to Unicode.
        // Do not force LinkedIn's publish cap here; compose should receive full output.
        const convertedResult = convertMarkdownToUnicode(result);
        const safeOutputCap = Number.parseInt(process.env.AI_OUTPUT_HARD_CAP || '12000', 10);
        const normalizedResult = typeof convertedResult === 'string' ? convertedResult : '';
        const output =
          safeOutputCap > 0 && normalizedResult.length > safeOutputCap
            ? normalizedResult.slice(0, safeOutputCap)
            : normalizedResult;
        
        console.log(`✅ Content generated successfully with ${provider.name}`);
        
        return {
          content: output,
          provider: provider.name,
          keyType: provider.keyType,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} generation failed:`, error.message);
        // Detect authorization/expired-token errors and collect them
        const isAuthError = /unauthoriz|token expired|Unauthorized/i.test(error.message || '');
        if (isAuthError) {
          authFailures.push(`${provider.name} (${provider.keyType}): ${error.message}`);
        }
        lastError = error;
        continue;
      }
    }
    
    if (authFailures.length > 0) {
      throw new Error(`Authorization failures for AI providers: ${authFailures.join(' ; ')}`);
    }

    throw new Error(`All AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  async generateWithPerplexity(prompt, style, apiKey = null) {
    const keyToUse = apiKey || this.perplexityApiKey;
    if (!keyToUse) {
      throw new Error('Perplexity API key not configured');
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      humorous: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    // FIXED: Simplified system prompt
    const systemPrompt = `You are a LinkedIn content creator. ${stylePrompts[style] || stylePrompts.casual}

Generate one LinkedIn post based on this request: ${prompt}

Requirements:
- Keep under 3,000 characters
- Start with a strong hook
- Include 1-3 relevant hashtags at the end
- End with a call to action or question
- Be engaging and authentic

Generate the post now:`;

    try {
      // Perplexity's API has changed over time; provide more robust message shapes and parsing.
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'sonar',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          max_tokens: 2048,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${keyToUse}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // FIXED: Added timeout
        }
      );

      // Try multiple common response shapes for Perplexity / chat APIs
      let content = null;
      const d = response.data || {};
      content = d?.choices?.[0]?.message?.content?.trim();
      if (!content) content = d?.choices?.[0]?.text?.trim();
      if (!content) content = d?.output_text?.trim();
      if (!content) content = d?.result?.text?.trim();

      // Fallback: search shallowly for the first reasonably-sized string value
      if (!content) {
        const queue = [d];
        while (queue.length && !content) {
          const obj = queue.shift();
          if (!obj || typeof obj === 'string') continue;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (typeof val === 'string' && val.trim().length > 10) {
              content = val.trim();
              break;
            }
            if (typeof val === 'object') queue.push(val);
          }
        }
      }

      if (!content) {
        throw new Error('No content generated by Perplexity');
      }

      return content;
    } catch (error) {
      const status = error.response?.status;
      if (status === 400) {
        throw new Error(`Perplexity API Error: ${error.response.data?.error?.message || 'Bad Request'}`);
      }
      if (status === 401 || status === 403) {
        const msg = error.response?.data?.error?.message || error.response?.data?.message || 'Unauthorized or token expired';
        throw new Error(`Perplexity API Unauthorized (${status}): ${msg}`);
      }
      // Attach response body to the error message for easier debugging when possible
      if (error.response?.data) {
        try {
          const debugMsg = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
          error.message = `${error.message} | Perplexity response: ${debugMsg}`;
        } catch (e) {
          // ignore JSON stringify errors
        }
      }
      throw error;
    }
  }

  async generateWithGoogle(prompt, style, apiKey = null) {
    const keyToUse = apiKey || this.googleApiKey;
    if (!keyToUse) {
      throw new Error('Google AI API key not configured');
    }

    const stylePrompts = {
      professional: 'professional and business-appropriate',
      casual: 'casual and conversational',
      witty: 'witty, humorous, and clever',
      inspirational: 'inspirational and motivational',
      informative: 'informative and educational'
    };

    // FIXED: Simplified system prompt
    const systemPrompt = `You are a LinkedIn content creator. Be ${stylePrompts[style] || 'casual and conversational'}.

Generate one LinkedIn post for: ${prompt}

Requirements:
- Keep under 3,000 characters
- Include 1-3 relevant hashtags at the end
- Be engaging and professional

Generate the post now:`;

    try {
      // Updated to test gemini-2.5-flash for quota differences
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyToUse}`,
        {
          contents: [{
            parts: [{ text: systemPrompt }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 1,
            topP: 1,
            maxOutputTokens: 2048,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000 // FIXED: Added timeout
        }
      );

      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!content) {
        throw new Error('No content generated by Google Gemini');
      }

      return content;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error('Google Gemini model not found. Please contact support.');
      }
      if (error.response?.data?.error) {
        throw new Error(`Google Gemini API error: ${error.response.data.error.message}`);
      }
      throw new Error(`Google Gemini API request failed: ${error.message}`);
    }
  }

  async resolveGoogleKeyForUser(userToken = null, cookieHeader = null) {
    let preference = 'platform';
    let userKeys = [];

    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken, 3, cookieHeader);
        preference = prefResult.preference || 'platform';
        userKeys = Array.isArray(prefResult.userKeys) ? prefResult.userKeys : [];
      } catch (error) {
        console.error('[AI Service] Failed to resolve BYOK preference for google key:', error.message);
      }
    }

    const byokGoogleKey = userKeys.find((key) => key.provider === 'gemini')?.apiKey;
    if (preference === 'byok' && byokGoogleKey) {
      return { key: byokGoogleKey, keyType: 'BYOK', preference };
    }
    if (this.googleApiKey) {
      return { key: this.googleApiKey, keyType: 'platform', preference };
    }
    if (byokGoogleKey) {
      return { key: byokGoogleKey, keyType: 'BYOK', preference };
    }
    return { key: null, keyType: null, preference };
  }

  async normalizeLinkedinPdfExtractionToJson(rawText = '', googleKey = '') {
    const keyToUse = String(googleKey || '').trim();
    if (!keyToUse) {
      throw new Error('Google key missing for JSON normalization');
    }

    const normalizedRaw = normalizeSimpleText(rawText, 7000);
    if (!normalizedRaw) {
      throw new Error('No text available for JSON normalization');
    }

    const normalizePrompt = [
      'Convert the profile analysis text below into STRICT JSON.',
      'Return ONLY JSON and match this exact schema:',
      '{"about":"","skills":[],"experience":"","confidence":"high|medium|low","notes":""}',
      'Rules:',
      '- about: max 700 chars.',
      '- experience: list all roles found (company + title + dates if present), max 1000 chars. Do NOT omit experience even if about is long.',
      '- skills must be short skill names only, max 20.',
      '- If missing, use empty string or empty array.',
      '- Do not invent facts not present in the input.',
      '',
      'Input text:',
      normalizedRaw,
    ].join('\n');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyToUse}`,
      {
        contents: [{ parts: [{ text: normalizePrompt }] }],
        generationConfig: {
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
          responseSchema: LINKEDIN_PDF_RESPONSE_SCHEMA,
        },
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const parts = Array.isArray(response.data?.candidates?.[0]?.content?.parts)
      ? response.data.candidates[0].content.parts
      : [];
    const normalizedText = parts
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!normalizedText) {
      throw new Error('Gemini JSON normalization returned empty output');
    }

    const parsed = extractJsonObjectFromText(normalizedText) || extractJsonObjectLoose(normalizedText);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Gemini JSON normalization failed: ${normalizeSimpleText(normalizedText, 220)}`);
    }

    return {
      parsed,
      raw: normalizedText,
    };
  }

  async extractLinkedinProfileFromPdf(base64Pdf, options = {}) {
    const {
      filename = 'linkedin-profile.pdf',
      mimetype = 'application/pdf',
      userToken = null,
      userId = null,
      cookieHeader = null,
      context = null,
    } = options || {};

    const normalizedBase64 = String(base64Pdf || '').replace(/\s+/g, '').trim();
    if (!normalizedBase64) {
      throw new Error('PDF payload is empty');
    }

    const keyResolution = await this.resolveGoogleKeyForUser(userToken, cookieHeader);
    if (!keyResolution.key) {
      throw new Error('Google Gemini key not available for PDF extraction');
    }

    const normalizedContext = context && typeof context === 'object' ? context : {};
    const recentPosts = Array.isArray(normalizedContext.recentPosts)
      ? normalizedContext.recentPosts.filter((post) => String(post?.content || '').trim().length > 10)
      : [];
    const recentPostCount = Number(normalizedContext.recentPostCount || recentPosts.length || 0);

    const contextPayload = {
      displayName: normalizeSimpleText(normalizedContext.displayName || '', 120),
      headline: normalizeSimpleText(normalizedContext.headline || '', 180),
      existingAbout: normalizeSimpleText(normalizedContext.existingAbout || '', 700),
      existingSkills: normalizeStringArray(normalizedContext.existingSkills || [], 20, 48),
      existingExperience: normalizeSimpleText(normalizedContext.existingExperience || '', 700),
      portfolioAbout: normalizeSimpleText(normalizedContext.portfolioAbout || '', 500),
      portfolioSkills: normalizeStringArray(normalizedContext.portfolioSkills || [], 16, 48),
      extraContext: normalizeSimpleText(normalizedContext.extraContext || '', 600),
    };
    const hasContext = Object.values(contextPayload).some((value) => (
      Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim())
    ));

    const prompt = [
      recentPostCount > 0
        ? 'You are analyzing a LinkedIn profile PDF AND the person\'s recent LinkedIn posts together.'
        : 'You are extracting structured profile data from a LinkedIn profile PDF.',
      'Return ONLY strict JSON. No markdown, no prose.',
      'Schema:',
      '{"about":"","skills":[],"experience":"","confidence":"high|medium|low","notes":""}',
      'Rules:',
      '- about: max 300 chars. One concise sentence only. Do not expand.',
      '- skills: extract from PDF first, then infer additional skills from post topics (max 20, no duplicates).',
      '- experience: from PDF experience section; use post content to add context on current focus (max 700 chars).',
      '- confidence: "high" if PDF has clear sections and posts align; "medium" if one source is weak; "low" if both are sparse.',
      '- notes: flag any mismatch between PDF claims and actual post content.',
      '- Do not hallucinate. If not in either source, omit it.',
      '- Ignore binary/garbled text and OCR noise.',
      recentPostCount > 0
        ? `- ${recentPostCount} LinkedIn posts are provided. Use them to infer real expertise and current focus areas.`
        : '',
      `Filename: ${normalizeSimpleText(filename, 140) || 'linkedin-profile.pdf'}`,
    ].filter(Boolean).join('\n');

    const requestParts = [{ text: prompt }];
    if (hasContext) {
      requestParts.push({
        text: `Known profile context (may be partial): ${JSON.stringify(contextPayload).slice(0, 2600)}`,
      });
    }
    if (recentPosts.length > 0) {
      const postsText = recentPosts
        .map((post, index) => {
          const engagement = Number(post.engagement || 0);
          return `Post ${index + 1}${engagement > 0 ? ` [${engagement} engagements]` : ''}:\n${String(post.content || '').trim()}`;
        })
        .join('\n\n---\n\n');

      requestParts.push({
        text: `Recent LinkedIn posts (${recentPosts.length}, newest first):\n\n${postsText}`,
      });
    }
    requestParts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: normalizedBase64,
      },
    });

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyResolution.key}`,
      {
        systemInstruction: {
          parts: [
            {
              text: 'You are a structured extractor. Always return strict JSON only.',
            },
          ],
        },
        contents: [
          {
            parts: requestParts,
          },
        ],
        generationConfig: {
          temperature: 0.1,
          topK: 1,
          topP: 1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: LINKEDIN_PDF_RESPONSE_SCHEMA,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000,
      }
    );

    const parts = Array.isArray(response.data?.candidates?.[0]?.content?.parts)
      ? response.data.candidates[0].content.parts
      : [];
    const textParts = parts
      .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
      .filter(Boolean);

    if (!textParts.length) {
      throw new Error('Google Gemini returned empty PDF extraction response');
    }

    const rawText = textParts.join('\n').trim();

    // Try each part individually first - Gemini 2.5 Flash sometimes adds
    // commentary in a second part which breaks JSON.parse on the joined string.
    let parsed = null;
    for (const textPart of textParts) {
      const cleaned = textPart.replace(/^\uFEFF/, '').trim();
      parsed = extractJsonObjectFromText(cleaned) || extractJsonObjectLoose(cleaned);
      if (parsed && typeof parsed === 'object') break;
    }
    if (!parsed) {
      parsed = extractJsonObjectFromText(rawText) || extractJsonObjectLoose(rawText);
    }

    console.log(
      '[AI Service] Gemini PDF raw parts count:',
      textParts.length,
      'rawText preview:',
      rawText.slice(0, 300)
    );
    let normalizationPassUsed = false;
    let normalizationPassError = null;
    if (!parsed || typeof parsed !== 'object') {
      try {
        const normalized = await this.normalizeLinkedinPdfExtractionToJson(rawText, keyResolution.key);
        parsed = normalized.parsed;
        normalizationPassUsed = true;
      } catch (normalizationError) {
        normalizationPassError = String(normalizationError?.message || 'json_normalization_failed').slice(0, 260);
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(
        `Google Gemini PDF extraction failed to parse structured output: ${normalizeSimpleText(rawText, 220)}${normalizationPassError ? ` | normalization: ${normalizationPassError}` : ''}`
      );
    }

    const about = normalizeSimpleText(parsed.about || parsed.summary || '', 700);
    const experience = normalizeSimpleText(parsed.experience || parsed.work_experience || '', 700);
    const skills = normalizeStringArray(parsed.skills || parsed.skill_set || [], 20, 48);
    const confidenceRaw = normalizeSimpleText(parsed.confidence || '', 20).toLowerCase();
    const confidence =
      confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
        ? confidenceRaw
        : null;
    const notes = normalizeSimpleText(parsed.notes || parsed.reason || '', 240);

    if (userId) {
      console.log('[AI Service] Gemini PDF profile extraction completed', {
        userId,
        keyType: keyResolution.keyType,
        hasAbout: Boolean(about),
        skillsCount: skills.length,
        hasExperience: Boolean(experience),
        confidence,
        normalizationPassUsed,
      });
    }

    return {
      provider: 'google',
      keyType: keyResolution.keyType,
      normalizationPassUsed,
      parsed: {
        about,
        skills,
        experience,
        confidence,
        notes,
      },
      raw: rawText.slice(0, 2400),
    };
  }

  async generateWithOpenAI(prompt, style, apiKey = null) {
    const keyToUse = apiKey || process.env.OPENAI_API_KEY;
    if (!keyToUse) {
      throw new Error('OpenAI API key not configured');
    }

    let openaiClient = this.openai;
    if (apiKey && apiKey !== process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      openaiClient = new OpenAI({ apiKey });
    }

    const stylePrompts = {
      professional: 'Write in a professional, business-appropriate tone.',
      casual: 'Write in a casual, conversational tone.',
      witty: 'Write with humor and wit, be clever and engaging.',
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };

    // FIXED: Simplified system prompt
    const systemPrompt = `You are a LinkedIn content creator. ${stylePrompts[style] || stylePrompts.casual}

Generate one LinkedIn post for: ${prompt}

Requirements:
- Keep under 3,000 characters
- Include 1-3 relevant hashtags at the end
- Be engaging and professional

Generate the post now:`;

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini', // FIXED: Updated to more recent model
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2048,
      temperature: 0.7,
      timeout: 30000 // FIXED: Added timeout
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI');
    }

    return content;
  }

  async generateStrategyContent(prompt, style = 'professional', userToken = null, userId = null, cookieHeader = null) {
    const validatedPrompt = this.validatePrompt(prompt, { maxLength: 9000, minLength: 20 });
    const sanitizedPrompt = sanitizeInput(validatedPrompt);

    if (userId) {
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }

    let preference = 'platform';
    let userKeys = [];

    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken, 3, cookieHeader);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys for strategy generation:', err.message);
      }
    }

    const providers = [];

    const perplexityKey =
      preference === 'byok'
        ? userKeys.find((key) => key.provider === 'perplexity')?.apiKey
        : this.perplexityApiKey;
    if (perplexityKey) {
      providers.push({
        name: 'perplexity',
        keyType: preference === 'byok' ? 'BYOK' : 'platform',
        method: (strategyPrompt) => this.generateStrategyWithPerplexity(strategyPrompt, perplexityKey),
      });
    }

    const googleKey =
      preference === 'byok'
        ? userKeys.find((key) => key.provider === 'gemini')?.apiKey
        : this.googleApiKey;
    if (googleKey) {
      providers.push({
        name: 'google',
        keyType: preference === 'byok' ? 'BYOK' : 'platform',
        method: (strategyPrompt) => this.generateStrategyWithGoogle(strategyPrompt, googleKey),
      });
    }

    const openaiKey =
      preference === 'byok'
        ? userKeys.find((key) => key.provider === 'openai')?.apiKey
        : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      providers.push({
        name: 'openai',
        keyType: preference === 'byok' ? 'BYOK' : 'platform',
        method: (strategyPrompt) => this.generateStrategyWithOpenAI(strategyPrompt, openaiKey),
      });
    }

    if (providers.length === 0) {
      throw new Error('No AI providers configured');
    }

    let lastError = null;

    for (const provider of providers) {
      try {
        const content = await provider.method(sanitizedPrompt, style);
        return {
          content,
          provider: provider.name,
          keyType: provider.keyType,
          success: true,
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`All strategy AI providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  normalizeTrendSignals(items = [], maxItems = 8) {
    const safeMax = Math.max(1, Math.min(12, Number(maxItems) || 8));
    const seen = new Set();
    const out = [];
    const rows = Array.isArray(items) ? items : [];

    for (const rawItem of rows) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : { topic: rawItem };
      const topic = normalizeSimpleText(item.topic || item.name || '', 64).toLowerCase();
      if (!topic || topic.length < 3) continue;

      const trigger = normalizeSimpleText(item.trigger || item.signal || item.trend || '', 180);
      const implication = normalizeSimpleText(item.implication || item.angle || item.recommendation || '', 200);
      const source = normalizeSimpleText(item.source || item.sources || '', 120);
      const confidenceRaw = String(item.confidence || '').toLowerCase();
      const confidence = ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : 'medium';
      const key = `${topic}|${trigger}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        topic,
        trigger: trigger || `New updates are shaping ${topic} right now.`,
        implication: implication || `Translate this ${topic} shift into one applied workflow update this week.`,
        source,
        confidence,
      });

      if (out.length >= safeMax) break;
    }

    return out;
  }

  buildTrendFallback({ niche = '', topics = [], maxItems = 6 } = {}) {
    const safeMax = Math.max(1, Math.min(8, Number(maxItems) || 6));
    const seedTopics = normalizeStringArray(
      [...(Array.isArray(topics) ? topics : []), niche],
      safeMax + 4,
      56
    )
      .map((value) => normalizeSimpleText(value, 56).toLowerCase())
      .filter(Boolean);

    const fallbackPool = seedTopics.length > 0 ? seedTopics : ['web development', 'cloud', 'devops', 'saas'];

    return fallbackPool.slice(0, safeMax).map((topic) => ({
      topic,
      trigger: `Market conversations around ${topic} are accelerating this week.`,
      implication: `Share one change you applied in your product because of this ${topic} shift.`,
      source: 'fallback',
      confidence: 'low',
    }));
  }

  async fetchNicheTrendSignals({
    niche = '',
    topics = [],
    audience = '',
    projectContext = '',
    maxItems = 6,
    userToken = null,
    userId = null,
    cookieHeader = null,
  } = {}) {
    if (userId) {
      const rateCheck = checkRateLimit(userId);
      if (!rateCheck.allowed) {
        throw new Error(rateCheck.error);
      }
    }

    const safeMax = Math.max(1, Math.min(8, Number(maxItems) || 6));
    const normalizedNiche = normalizeSimpleText(niche, 120);
    const normalizedTopics = normalizeStringArray(topics, 12, 56);
    const normalizedAudience = normalizeSimpleText(audience, 120);
    const normalizedProjectContext = normalizeSimpleText(projectContext, 220);
    const today = new Date().toISOString().slice(0, 10);

    const prompt = [
      'Return ONLY JSON.',
      'Schema:',
      '{"trends":[{"topic":"","trigger":"","implication":"","source":"","confidence":"high|medium|low"}]}',
      `Date: ${today}`,
      `Find up to ${safeMax} high-signal trend shifts relevant to this niche in the last 60 days when possible.`,
      'Trend shifts can include: feature releases, benchmark changes, API updates, platform policy shifts, ecosystem launches.',
      'Keep each trigger practical and specific (max 140 chars).',
      'Each implication must say what a builder should do this week (max 170 chars).',
      'Avoid generic terms like growth strategy or personal branding.',
      `Niche: ${normalizedNiche || 'not provided'}`,
      `Topics: ${normalizedTopics.join(', ') || 'not provided'}`,
      `Audience: ${normalizedAudience || 'not provided'}`,
      `Project context: ${normalizedProjectContext || 'not provided'}`,
    ].join('\n');

    let preference = 'platform';
    let userKeys = [];

    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken, 3, cookieHeader);
        preference = prefResult.preference || 'platform';
        userKeys = Array.isArray(prefResult.userKeys) ? prefResult.userKeys : [];
      } catch (error) {
        console.error('[AI Service] Failed to fetch preference for trend signals:', error.message);
      }
    }

    const providers = [];
    const perplexityKey =
      preference === 'byok'
        ? userKeys.find((key) => key.provider === 'perplexity')?.apiKey
        : this.perplexityApiKey;
    if (perplexityKey) {
      providers.push({
        name: 'perplexity',
        keyType: preference === 'byok' ? 'BYOK' : 'platform',
        usedLiveSearch: true,
        method: (trendPrompt) => this.fetchTrendSignalsWithPerplexity(trendPrompt, perplexityKey),
      });
    }

    const googleKey =
      preference === 'byok'
        ? userKeys.find((key) => key.provider === 'gemini')?.apiKey
        : this.googleApiKey;
    if (googleKey) {
      providers.push({
        name: 'google',
        keyType: preference === 'byok' ? 'BYOK' : 'platform',
        usedLiveSearch: true,
        method: (trendPrompt) => this.fetchTrendSignalsWithGoogle(trendPrompt, googleKey),
      });
    }

    let lastError = null;
    for (const provider of providers) {
      try {
        const parsed = await provider.method(prompt);
        const normalized = this.normalizeTrendSignals(parsed?.trends || parsed, safeMax);
        if (normalized.length === 0) {
          throw new Error('Trend response contained no valid signals');
        }
        return {
          trends: normalized,
          provider: provider.name,
          keyType: provider.keyType,
          usedLiveSearch: provider.usedLiveSearch,
          fallback: false,
        };
      } catch (error) {
        lastError = error;
      }
    }

    return {
      trends: this.buildTrendFallback({
        niche: normalizedNiche,
        topics: normalizedTopics,
        maxItems: safeMax,
      }),
      provider: 'fallback',
      keyType: null,
      usedLiveSearch: false,
      fallback: true,
      error: lastError?.message || null,
    };
  }

  async fetchTrendSignalsWithPerplexity(prompt, apiKey = null) {
    const keyToUse = apiKey || this.perplexityApiKey;
    if (!keyToUse) {
      throw new Error('Perplexity API key not configured');
    }

    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a niche trend analyst for LinkedIn creators. Return only strict JSON in the exact requested schema.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.2,
      },
      {
        headers: {
          Authorization: `Bearer ${keyToUse}`,
          'Content-Type': 'application/json',
        },
        timeout: 45000,
      }
    );

    const content =
      response.data?.choices?.[0]?.message?.content?.trim() ||
      response.data?.choices?.[0]?.text?.trim() ||
      response.data?.output_text?.trim() ||
      response.data?.result?.text?.trim();

    if (!content) {
      throw new Error('No trend signals generated by Perplexity');
    }

    const parsed = extractJsonObjectFromText(content) || extractJsonObjectLoose(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Perplexity trend response was not valid JSON');
    }

    return parsed;
  }

  async fetchTrendSignalsWithGoogle(prompt, apiKey = null) {
    const keyToUse = apiKey || this.googleApiKey;
    if (!keyToUse) {
      throw new Error('Google AI API key not configured');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyToUse}`;
    const buildPayload = (useSearchTool = false) => {
      const payload = {
        contents: [
          {
            parts: [
              {
                text:
                  'You are a niche trend analyst for LinkedIn creators. Return only strict JSON in the exact requested schema.',
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 1,
          topP: 1,
          maxOutputTokens: 1600,
          responseMimeType: 'application/json',
          responseSchema: TREND_SIGNALS_RESPONSE_SCHEMA,
        },
      };
      if (useSearchTool) {
        // Best-effort live grounding. If the account/model does not support this tool,
        // we fallback to the standard generation request.
        payload.tools = [{ google_search: {} }];
      }
      return payload;
    };

    let lastError = null;
    for (const useSearchTool of [true, false]) {
      try {
        const response = await axios.post(
          endpoint,
          buildPayload(useSearchTool),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 45000,
          }
        );

        const parts = Array.isArray(response.data?.candidates?.[0]?.content?.parts)
          ? response.data.candidates[0].content.parts
          : [];
        const textParts = parts
          .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
          .filter(Boolean);

        if (textParts.length === 0) {
          throw new Error('No trend signals generated by Google Gemini');
        }

        for (const text of textParts) {
          const parsed = extractJsonObjectFromText(text) || extractJsonObjectLoose(text);
          if (parsed && typeof parsed === 'object') {
            return parsed;
          }
        }

        throw new Error('Google trend response was not valid JSON');
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Google trend signal generation failed');
  }

  async generateStrategyWithPerplexity(prompt, apiKey = null) {
    const keyToUse = apiKey || this.perplexityApiKey;
    if (!keyToUse) {
      throw new Error('Perplexity API key not configured');
    }

    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'sonar',
          messages: [
            {
              role: 'system',
              content:
                'You are a LinkedIn strategy copilot. Follow the user instructions exactly and return only the requested format.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: 1200,
          temperature: 0.4,
        },
        {
          headers: {
            Authorization: `Bearer ${keyToUse}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const content =
        response.data?.choices?.[0]?.message?.content?.trim() ||
        response.data?.choices?.[0]?.text?.trim() ||
        response.data?.output_text?.trim() ||
        response.data?.result?.text?.trim();

      if (!content) {
        throw new Error('No strategy content generated by Perplexity');
      }

      return content;
    } catch (error) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        const message =
          error.response?.data?.error?.message ||
          error.response?.data?.message ||
          'Unauthorized or token expired';
        throw new Error(`Perplexity strategy request unauthorized (${status}): ${message}`);
      }
      throw error;
    }
  }

  async generateStrategyWithGoogle(prompt, apiKey = null) {
    const keyToUse = apiKey || this.googleApiKey;
    if (!keyToUse) {
      throw new Error('Google AI API key not configured');
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyToUse}`,
        {
          contents: [
            {
              parts: [
                {
                  text:
                    'You are a LinkedIn strategy copilot. Follow the user instructions exactly and return only the requested format.',
                },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            topK: 1,
            topP: 1,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            responseSchema: STRATEGY_RESPONSE_SCHEMA,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const parts = Array.isArray(response.data?.candidates?.[0]?.content?.parts)
        ? response.data.candidates[0].content.parts
        : [];
      const textParts = parts
        .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean);
      if (textParts.length === 0) {
        throw new Error('No strategy content generated by Google Gemini');
      }

      let content = textParts.join('\n').trim();
      for (const textPart of textParts) {
        const parsedPart = extractJsonObjectFromText(textPart) || extractJsonObjectLoose(textPart);
        if (parsedPart && typeof parsedPart === 'object') {
          content = JSON.stringify(parsedPart);
          break;
        }
      }
      if (!content) {
        throw new Error('No strategy content generated by Google Gemini');
      }

      return content;
    } catch (error) {
      if (error.response?.data?.error?.message) {
        throw new Error(`Google Gemini strategy API error: ${error.response.data.error.message}`);
      }
      throw error;
    }
  }

  async generateStrategyWithOpenAI(prompt, apiKey = null) {
    const keyToUse = apiKey || process.env.OPENAI_API_KEY;
    if (!keyToUse) {
      throw new Error('OpenAI API key not configured');
    }

    let openaiClient = this.openai;
    if (apiKey && apiKey !== process.env.OPENAI_API_KEY) {
      const OpenAI = (await import('openai')).default;
      openaiClient = new OpenAI({ apiKey });
    }

    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a LinkedIn strategy copilot. Follow the user instructions exactly and return only the requested format.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_tokens: 1200,
      temperature: 0.4,
      timeout: 30000,
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No strategy content generated by OpenAI');
    }

    return content;
  }
}

const aiService = new AIService();
export default aiService;

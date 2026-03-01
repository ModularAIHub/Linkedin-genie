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
  validatePrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt');
    }
    
    const trimmed = prompt.trim();
    
    if (trimmed.length < 5) throw new Error('Prompt too short (min 5 characters)');
    if (trimmed.length > 2000) throw new Error('Prompt too long (max 2000 characters)');
    
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
        
        // Convert markdown bold to Unicode
        const convertedResult = convertMarkdownToUnicode(result);
        
        // FIXED: Enforce 3,000 character limit
        const trimmedResult = convertedResult && convertedResult.length > 3000 
          ? convertedResult.slice(0, 2997) + '...' 
          : convertedResult;
        
        console.log(`✅ Content generated successfully with ${provider.name}`);
        
        return {
          content: trimmedResult,
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
          max_tokens: 800,
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
            maxOutputTokens: 800,
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
      max_tokens: 800,
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
    const validatedPrompt = this.validatePrompt(prompt);
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
            maxOutputTokens: 1200,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
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

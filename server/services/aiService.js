
import OpenAI from 'openai';
// import { sanitizeInput } from '../utils/sanitization.js';


// --- BEGIN TWEET GENIE AI SERVICE ---
import axios from 'axios';
import { sanitizeInput } from '../utils/sanitization.js';

async function getUserPreferenceAndKeys(userToken) {
  const baseUrl = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';
  const prefRes = await axios.get(`${baseUrl}/byok/preference`, {
    headers: { Authorization: `Bearer ${userToken}` }
  });
  const preference = prefRes.data.api_key_preference;
  let userKeys = [];
  if (preference === 'byok') {
    const keysRes = await axios.get(`${baseUrl}/byok/keys`, {
      headers: { Authorization: `Bearer ${userToken}` }
    });
    userKeys = keysRes.data.keys;
  }
  return { preference, userKeys };
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

  async generateContent(prompt, style = 'casual', maxRetries = 3, userToken = null, userId = null) {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      throw new Error('Invalid or too short prompt');
    }
    const sanitizedPrompt = sanitizeInput(prompt.trim());

    // Only support single LinkedIn post generation, no thread/multi-post/carousel logic
    let preference = 'platform';
    let userKeys = [];
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        console.log('[AI Service] User preference:', preference);
        console.log('[AI Service] User keys:', userKeys.map(k => ({ provider: k.provider, keyName: k.keyName, hasKey: !!k.apiKey })));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys:', err.message);
      }
    }

    const providers = [];
    console.log('[AI Service] Setting up providers for preference:', preference);
    
    // Only support single LinkedIn post, not thread or carousel
    let perplexityKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'perplexity')?.apiKey) : this.perplexityApiKey;
    if (perplexityKey) {
      console.log('[AI Service] Perplexity key available:', preference === 'byok' ? 'BYOK' : 'Platform');
      providers.push({ name: 'perplexity', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s) => this.generateWithPerplexity(p, s, perplexityKey) });
    } else {
      console.log('[AI Service] Perplexity key NOT available for mode:', preference);
    }
    
    let googleKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'gemini')?.apiKey) : this.googleApiKey;
    if (googleKey) {
      console.log('[AI Service] Google/Gemini key available:', preference === 'byok' ? 'BYOK' : 'Platform');
      providers.push({ name: 'google', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s) => this.generateWithGoogle(p, s, googleKey) });
    } else {
      console.log('[AI Service] Google/Gemini key NOT available for mode:', preference);
    }
    
    let openaiKey = preference === 'byok' ? (userKeys.find(k => k.provider === 'openai')?.apiKey) : process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log('[AI Service] OpenAI key available:', preference === 'byok' ? 'BYOK' : 'Platform');
      providers.push({ name: 'openai', keyType: preference === 'byok' ? 'BYOK' : 'platform', method: (p, s) => this.generateWithOpenAI(p, s, openaiKey) });
    } else {
      console.log('[AI Service] OpenAI key NOT available for mode:', preference);
    }

    if (providers.length === 0) {
      const errorMsg = preference === 'byok' 
        ? 'No AI providers available. Please add your API keys in the platform settings or switch to Platform mode.'
        : 'No platform AI providers configured. Please contact support or try BYOK mode with your own API keys.';
      throw new Error(errorMsg);
    }

    console.log(`Available AI providers: ${providers.map(p => p.name).join(', ')}`);

    let lastError = null;
    for (const provider of providers) {
      try {
        if (userId) {
          console.log(`[AI Key Usage] userId=${userId} provider=${provider.name} keyType=${provider.keyType}`);
        }
        console.log(`Attempting content generation with ${provider.name}...`);
        const result = await provider.method(sanitizedPrompt, style);
        // Enforce 3,000 character limit strictly
        const trimmedResult = result && result.length > 3000 ? result.slice(0, 2997) + '...' : result;
        console.log(`✅ Content generated successfully with ${provider.name}`);
        return {
          content: trimmedResult,
          provider: provider.name,
          keyType: provider.keyType,
          success: true
        };
      } catch (error) {
        console.error(`❌ ${provider.name} generation failed:`, error.message);
        lastError = error;
        continue;
      }
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
      inspirational: 'Write in an inspirational, motivational tone.',
      informative: 'Write in an informative, educational tone.'
    };
    let systemPrompt;
    systemPrompt = `You are an expert LinkedIn content creator. Strictly match the following style: ${stylePrompts[style] || stylePrompts.casual}\n\nCONTENT RULES:\n- Generate ONLY one LinkedIn post, no explanations\n- DO NOT include "Here's a post" or similar phrases\n- Keep under 3,000 characters per post\n- Start with a strong hook to grab attention\n- Clearly communicate value, insight, or story\n- End with a clear call to action or question\n- Avoid generic or boilerplate language\n- Use the chosen style/tone throughout\n- Include 1-3 relevant hashtags at the end of the post\n- Be engaging, authentic, and professional\n- The post should be complete and standalone\n\nUser request: ${prompt}\n\nGenerate a single, high-quality LinkedIn post with relevant hashtags, strictly matching the chosen style.`;
    try {
      const response = await axios.post(
        'https://api.perplexity.ai/chat/completions',
        {
          model: 'sonar',
          messages: [
            { role: 'user', content: systemPrompt }
          ],
          max_tokens: 800,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${keyToUse}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const content = response.data.choices[0]?.message?.content?.trim();
      if (!content) {
        throw new Error('No content generated by Perplexity');
      }
      return content;
    } catch (error) {
      console.error('Perplexity API Error Details:', error.response ? error.response.data : error.message);
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
    let systemPrompt;
    systemPrompt = `You are a LinkedIn content creator. Be ${stylePrompts[style] || 'casual and conversational'}.\n\nCONTENT RULES:\n- Generate ONLY one LinkedIn post, no explanations\n- DO NOT include "Here's a post" or similar phrases\n- Keep under 3,000 characters per post\n- Include 1-3 relevant hashtags at the end of the post\n- Be engaging and informative\n- The post should be complete and standalone\n\nUser request: ${prompt}\n\nGenerate a single LinkedIn post with relevant hashtags.`;
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${keyToUse}`,
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
        }
      }
    );
    const content = response.data.candidates[0]?.content?.parts[0]?.text?.trim();
    if (!content) {
      throw new Error('No content generated by Google Gemini');
    }
    return content;
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
    let systemPrompt;
    systemPrompt = `You are a LinkedIn content creator. ${stylePrompts[style] || stylePrompts.casual}\n\nCONTENT RULES:\n- Generate ONLY one LinkedIn post, no explanations\n- DO NOT include "Here's a post" or similar phrases\n- Keep under 3,000 characters per post\n- Include 1-3 relevant hashtags at the end of the post\n- Be engaging and informative\n- The post should be complete and standalone\n\nUser request: ${prompt}\n\nGenerate a single LinkedIn post with relevant hashtags.`;
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 600,
      temperature: 0.7,
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('No content generated by OpenAI');
    }
    return content;
  }
}

const aiService = new AIService();
export default aiService;
// --- END TWEET GENIE AI SERVICE ---

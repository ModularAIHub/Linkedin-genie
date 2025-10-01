import OpenAI from 'openai';
import axios from 'axios';

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

class ImageGenerationService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      this.openai = null;
    }
  }

  async generateImage(prompt, style = 'natural', size = '1024x1024', userToken = null, userId = null) {
    // Determine which API key to use based on user preference
    let preference = 'platform';
    let userKeys = [];
    let keyType = 'platform';
    
    if (userToken) {
      try {
        const prefResult = await getUserPreferenceAndKeys(userToken);
        preference = prefResult.preference;
        userKeys = prefResult.userKeys;
        console.log('[Image Service] User preference:', preference);
        console.log('[Image Service] User keys:', userKeys.map(k => ({ provider: k.provider, keyName: k.keyName, hasKey: !!k.apiKey })));
      } catch (err) {
        console.error('Failed to fetch user BYOK preference/keys for image generation:', err.message);
      }
    }

    // Get the appropriate OpenAI key
    let openaiKey = process.env.OPENAI_API_KEY;
    console.log('[Image Service] Platform OpenAI key available:', !!openaiKey);
    
    if (preference === 'byok') {
      const userOpenAIKey = userKeys.find(k => k.provider === 'openai')?.apiKey;
      if (userOpenAIKey) {
        openaiKey = userOpenAIKey;
        keyType = 'BYOK';
        console.log('[Image Service] Using BYOK OpenAI key');
      } else {
        console.log('[Image Service] No BYOK OpenAI key found, falling back to platform key');
      }
    } else {
      console.log('[Image Service] Using Platform OpenAI key');
    }

    if (!openaiKey) {
      const errorMsg = preference === 'byok' 
        ? 'OpenAI API key not found in your BYOK keys. Please add your OpenAI API key in the platform settings or switch to Platform mode.'
        : 'Platform OpenAI API key not configured for image generation. Please contact support or try BYOK mode with your own OpenAI API key.';
      throw new Error(errorMsg);
    }

    // Use the appropriate OpenAI client
    let openaiClient = this.openai;
    if (keyType === 'BYOK' || openaiKey !== process.env.OPENAI_API_KEY) {
      openaiClient = new OpenAI({ apiKey: openaiKey });
    }

    if (userId) {
      console.log(`[IMAGE Key Usage] userId=${userId} provider=openai keyType=${keyType}`);
    }

    console.log(`Generating image with OpenAI (${keyType})...`);
    
    // For LinkedIn Genie, use DALL-E for image generation
    const response = await openaiClient.images.generate({
      prompt: `${prompt} (style: ${style})`,
      n: 1,
      size,
      response_format: 'b64_json'
    });
    
    const imageBuffer = Buffer.from(response.data[0].b64_json, 'base64');
    
    console.log(`✅ Image generated successfully with OpenAI (${keyType})`);
    
    return {
      imageBuffer,
      filename: `linkedin_image_${Date.now()}.png`,
      provider: 'openai',
      keyType,
      success: true
    };
  }
}

const imageGenerationService = new ImageGenerationService();
export default imageGenerationService;

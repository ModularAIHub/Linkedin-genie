import OpenAI from 'openai';

class ImageGenerationService {
  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } else {
      this.openai = null;
    }
  }

  async generateImage(prompt, style = 'natural', size = '1024x1024') {
    if (!this.openai) throw new Error('OpenAI API key not configured');
    // For LinkedIn Genie, use DALL-E or similar
    const response = await this.openai.images.generate({
      prompt: `${prompt} (style: ${style})`,
      n: 1,
      size,
      response_format: 'b64_json'
    });
    const imageBuffer = Buffer.from(response.data[0].b64_json, 'base64');
    return {
      imageBuffer,
      filename: `linkedin_image_${Date.now()}.png`,
      provider: 'openai',
      success: true
    };
  }
}

const imageGenerationService = new ImageGenerationService();
export default imageGenerationService;

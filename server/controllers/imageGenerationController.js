import * as imageGenerationService from '../services/imageGenerationService.js';

export async function generateImage(req, res) {
  try {
    const { prompt, style = 'natural' } = req.body;
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.trim().length > 1000) {
      return res.status(400).json({ error: 'Prompt too long (max 1000 characters)' });
    }

    // Get user token and ID for BYOK/Platform mode detection
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const userId = req.user?.id;

    const result = await imageGenerationService.generateImage(prompt.trim(), style, 'natural', token, userId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate image' });
  }
}

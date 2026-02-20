import * as imageGenerationService from '../services/imageGenerationService.js';
import creditService from '../services/creditService.js';

export async function generateImage(req, res) {
  try {
    const { prompt, style = 'natural' } = req.body;
    const userPlanType = String(req.user?.plan_type || req.user?.planType || 'free').toLowerCase();

    if (userPlanType === 'free') {
      return res.status(403).json({
        error: 'Image generation is available on Pro and above only. Upgrade your plan to continue.'
      });
    }

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
    const creditCost = 2;

    const creditCheck = await creditService.checkAndDeductCredits(
      userId,
      'ai_image_generation',
      creditCost,
      token
    );
    if (!creditCheck.success) {
      return res.status(402).json({
        error: 'Insufficient credits for AI image generation',
        creditsRequired: creditCost,
        creditsAvailable: creditCheck.creditsAvailable || 0
      });
    }

    const result = await imageGenerationService.generateImage(prompt.trim(), style, 'natural', token, userId);
    res.json({ success: true, ...result, creditsUsed: creditCost });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate image' });
  }
}

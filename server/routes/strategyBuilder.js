import express from 'express';
import { strategyService } from '../services/strategyService.js';
import creditService from '../services/creditService.js';
import aiService from '../services/aiService.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('Strategy Builder'));

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

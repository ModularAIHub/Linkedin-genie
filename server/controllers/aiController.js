
import aiService from '../services/aiService.js';
import creditService from '../services/creditService.js';

const MAX_BULK_PROMPTS = 30;

export async function generateContent(req, res) {
  try {
    const { prompt, style = 'casual', isThread = false, schedule = false, scheduleOptions = {} } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be at least 5 characters'
      });
    }

    // Validate style parameter
    const allowedStyles = ['casual', 'professional', 'humorous', 'witty', 'inspirational', 'informative'];
    if (!allowedStyles.includes(style)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid style parameter'
      });
    }

    // Only estimate thread count if isThread is true
    let estimatedThreadCount = 1;
    if (isThread) {
      const threadCountMatch = prompt.match(/generate\s+(\d+)\s+threads?/i);
      estimatedThreadCount = threadCountMatch ? parseInt(threadCountMatch[1]) : 1;
    }
    // Calculate estimated credits needed (1.2 credits per thread)
    const estimatedCreditsNeeded = estimatedThreadCount * 1.2;

    // Check and deduct credits before AI generation based on estimated count
    const token = req.cookies?.accessToken || (req.headers['authorization']?.split(' ')[1]);
    const refreshToken = req.cookies?.refreshToken;
    const cookieParts = [];
    if (token) cookieParts.push(`accessToken=${token}`);
    if (refreshToken) cookieParts.push(`refreshToken=${refreshToken}`);
    const cookieHeader = cookieParts.length > 0 ? cookieParts.join('; ') : null;

    const userId = req.user?.id;
    const creditCheck = await creditService.checkAndDeductCredits(userId, 'ai_text_generation', estimatedCreditsNeeded, token);
    if (!creditCheck.success) {
      return res.status(402).json({
        success: false,
        error: 'Insufficient credits',
        creditsRequired: estimatedCreditsNeeded,
        creditsAvailable: creditCheck.creditsAvailable || 0,
        estimatedThreads: estimatedThreadCount
      });
    }

    // Generate the content
    let result;
    try {
      result = await aiService.generateContent(prompt.trim(), style, 3, token, userId, cookieHeader);
    } catch (aiError) {
      console.error('[AI GENERATION ERROR]', aiError);
      return res.status(500).json({
        success: false,
        error: 'AI provider error',
        details: aiError.message || aiError.toString()
      });
    }
    const sanitizedContent = result.content;

    // Only treat as thread if isThread is true
    let threadCount = 1;
    let posts = [sanitizedContent];
    if (isThread) {
      const threadSeparators = sanitizedContent.split('---').filter(section => section.trim().length > 0);
      if (threadSeparators.length > 1) {
        threadCount = threadSeparators.length;
        posts = threadSeparators.map(t => t.trim());
      } else {
        const lines = sanitizedContent.split('\n').filter(line => line.trim().length > 0);
        if (lines.length > 3) {
          threadCount = Math.min(Math.ceil(lines.length / 3), 5);
          posts = [];
          for (let i = 0; i < lines.length; i += 3) {
            posts.push(lines.slice(i, i + 3).join('\n'));
          }
          posts = posts.slice(0, 5);
        }
      }
    }

    // Calculate actual credits needed (1.2 credits per thread)
    const actualCreditsNeeded = Math.round((threadCount * 1.2) * 100) / 100;
    const creditDifference = Math.round((actualCreditsNeeded - estimatedCreditsNeeded) * 100) / 100;

    if (creditDifference > 0.01) {
      // Need to deduct more credits
      const additionalCreditCheck = await creditService.checkAndDeductCredits(
        userId,
        'ai_thread_adjustment',
        creditDifference,
        token
      );
      if (!additionalCreditCheck.success) {
        // Refund the initial credits since we can't complete the request
        await creditService.refund(userId, estimatedCreditsNeeded, 'ai_text_generation', 'refund');
        return res.status(402).json({
          success: false,
          error: 'Insufficient credits for actual thread count',
          creditsRequired: actualCreditsNeeded,
          creditsAvailable: additionalCreditCheck.creditsAvailable || 0,
          threadCount: threadCount,
          estimatedThreads: estimatedThreadCount
        });
      }
    } else if (creditDifference < -0.01) {
      // Refund excess credits
      const refundAmount = Math.abs(creditDifference);
      await creditService.refund(userId, refundAmount, 'ai_thread_adjustment', 'refund');
    }

    res.json({
      success: true,
      content: sanitizedContent,
      provider: result.provider,
      keyType: result.keyType,
      threadCount,
      posts,
      creditsUsed: actualCreditsNeeded,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('[AI GENERATE FATAL ERROR]', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate content',
      details: error && (error.stack || error.message || error.toString())
    });
  }
}


export async function bulkGenerate(req, res) {
  try {
    const { prompts, options = [] } = req.body;
    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'No prompts provided' });
    }
    if (prompts.length > MAX_BULK_PROMPTS) {
      return res.status(400).json({
        error: `Bulk generation is limited to ${MAX_BULK_PROMPTS} prompts per run.`,
      });
    }
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const userId = req.user?.id;
    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      const opt = options[i] || {};
      try {
        const result = await aiService.generateContent(prompt, opt.style || 'casual', 3, token, userId);
        results.push({ success: true, result });
      } catch (err) {
        results.push({ success: false, error: err.message });
      }
    }
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk generate content', message: error.message });
  }
}

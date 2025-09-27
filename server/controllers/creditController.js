import creditService from '../services/creditService.js';

export async function getBalance(req, res) {
  try {
    console.log('DEBUG /credits/balance req.user:', req.user);
    const userId = req.user?.id;
    if (!userId) {
      console.error('No userId found in req.user!');
      return res.status(401).json({ error: 'Not authenticated (no userId)' });
    }
    const balance = await creditService.getBalance(userId);
    console.log(`DEBUG /credits/balance userId: ${userId}, balance: ${balance}`);
    res.json({ balance, creditsRemaining: balance });
  } catch (error) {
    console.error('Error in getBalance:', error);
    res.status(500).json({ error: 'Failed to fetch credit balance' });
  }
}

export async function getHistory(req, res) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;
    const history = await creditService.getUsageHistory(userId, { page: parseInt(page), limit: parseInt(limit), type });
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit history' });
  }
}

export async function getPricing(req, res) {
  try {
    const pricing = {
      post: 1,
      post_with_media: 2,
      ai_generation: 2,
      scheduling: 0,
      analytics_sync: 0
    };
    res.json({ pricing });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch pricing information' });
  }
}

export async function refund(req, res) {
  try {
    const userId = req.user.id;
    const { amount, reason, transaction_type } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid refund amount' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' });
    }
    await creditService.refund(userId, amount, reason, transaction_type);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process refund' });
  }
}

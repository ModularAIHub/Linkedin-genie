// Debug routes for testing BYOK/Platform integration
import express from 'express';
import aiService from '../services/aiService.js';
import imageGenerationService from '../services/imageGenerationService.js';

const router = express.Router();

// Debug endpoint to test AI service with current user's mode
router.post('/test-ai', async (req, res) => {
  try {
    const { prompt = 'Write a LinkedIn post about productivity tips', style = 'professional' } = req.body;
    
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const userId = req.user?.id;
    
    console.log('\n[DEBUG] Testing AI generation...');
    console.log('[DEBUG] User ID:', userId);
    console.log('[DEBUG] Has Token:', !!token);
    
    const result = await aiService.generateContent(prompt, style, 1, token, userId);
    
    res.json({
      success: true,
      debug: {
        userId,
        hasToken: !!token,
        prompt,
        style
      },
      result: {
        provider: result.provider,
        keyType: result.keyType,
        contentLength: result.content?.length || 0,
        content: result.content?.substring(0, 200) + '...' // Truncate for debug
      }
    });
  } catch (error) {
    console.error('[DEBUG] AI test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      debug: {
        userId: req.user?.id,
        hasToken: !!(req.cookies?.accessToken || req.headers['authorization'])
      }
    });
  }
});

// Debug endpoint to test image generation with current user's mode
router.post('/test-image', async (req, res) => {
  try {
    const { prompt = 'A professional office workspace', style = 'professional' } = req.body;
    
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const userId = req.user?.id;
    
    console.log('\n[DEBUG] Testing image generation...');
    console.log('[DEBUG] User ID:', userId);
    console.log('[DEBUG] Has Token:', !!token);
    
    const result = await imageGenerationService.generateImage(prompt, style, '1024x1024', token, userId);
    
    res.json({
      success: true,
      debug: {
        userId,
        hasToken: !!token,
        prompt,
        style
      },
      result: {
        provider: result.provider,
        keyType: result.keyType,
        imageSizeBytes: result.imageBuffer?.length || 0,
        filename: result.filename
      }
    });
  } catch (error) {
    console.error('[DEBUG] Image test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      debug: {
        userId: req.user?.id,
        hasToken: !!(req.cookies?.accessToken || req.headers['authorization'])
      }
    });
  }
});

// Debug endpoint to check user's current BYOK/Platform mode
router.get('/test-mode', async (req, res) => {
  try {
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    const userId = req.user?.id;
    
    if (!token) {
      return res.status(401).json({ error: 'No token found' });
    }
    
    // Test the preference fetching
    const baseUrl = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';
    const axios = await import('axios');
    
    console.log('\n[DEBUG] Testing mode detection...');
    console.log('[DEBUG] API URL:', `${baseUrl}/byok/preference`);
    
    const prefRes = await axios.default.get(`${baseUrl}/byok/preference`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const preference = prefRes.data.api_key_preference;
    let userKeys = [];
    
    if (preference === 'byok') {
      const keysRes = await axios.default.get(`${baseUrl}/byok/keys`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      userKeys = keysRes.data.keys || [];
    }
    
    res.json({
      success: true,
      debug: {
        userId,
        hasToken: !!token,
        apiUrl: baseUrl
      },
      result: {
        preference,
        keyCount: userKeys.length,
        availableProviders: userKeys.map(k => ({ provider: k.provider, keyName: k.keyName, hasKey: !!k.apiKey }))
      }
    });
  } catch (error) {
    console.error('[DEBUG] Mode test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details',
      debug: {
        userId: req.user?.id,
        hasToken: !!(req.cookies?.accessToken || req.headers['authorization'])
      }
    });
  }
});

export default router;
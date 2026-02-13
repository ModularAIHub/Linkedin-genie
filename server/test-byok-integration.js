#!/usr/bin/env node

// Test script to verify BYOK/Platform integration
// Usage: node test-byok-integration.js

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import aiService from './services/aiService.js';
import imageGenerationService from './services/imageGenerationService.js';

// Mock user token and preference responses
const mockPlatformUserToken = 'mock-platform-token';
const mockByokUserToken = 'mock-byok-token';

// Test configurations
const testConfigs = [
  {
    name: 'Platform Mode Test',
    token: mockPlatformUserToken,
    userId: 'platform-user-123',
    mockPreference: 'platform',
    mockKeys: []
  },
  {
    name: 'BYOK Mode Test',
    token: mockByokUserToken,
    userId: 'byok-user-456',
    mockPreference: 'byok',
    mockKeys: [
      { provider: 'openai', keyName: 'My OpenAI Key', apiKey: 'sk-test-openai-key' },
      { provider: 'perplexity', keyName: 'My Perplexity Key', apiKey: 'pplx-test-key' }
    ]
  }
];

// Mock the getUserPreferenceAndKeys function
async function mockGetUserPreferenceAndKeys(userToken) {
  const config = testConfigs.find(c => c.token === userToken);
  if (!config) {
    throw new Error('Unknown test token');
  }
  
  console.log(`[MOCK] Returning preference: ${config.mockPreference}, keys: ${config.mockKeys.length}`);
  return {
    preference: config.mockPreference,
    userKeys: config.mockKeys
  };
}

// Test function
async function testKeyIntegration() {
  console.log('🧪 Testing BYOK/Platform Key Integration\n');
  
  // Override the getUserPreferenceAndKeys function in aiService
  const originalGetUserPreferenceAndKeys = global.getUserPreferenceAndKeys;
  
  for (const config of testConfigs) {
    console.log(`\n=== ${config.name} ===`);
    
    try {
      // Test AI Content Generation
      console.log('\n📝 Testing AI Content Generation...');
      
      // Temporarily mock the function
      global.getUserPreferenceAndKeys = () => mockGetUserPreferenceAndKeys(config.token);
      
      // Test with a simple prompt
      const aiResult = await aiService.generateContent(
        'Write a LinkedIn post about productivity tips',
        'professional',
        1,
        config.token,
        config.userId
      );
      
      console.log('✅ AI Generation Success:');
      console.log(`   Provider: ${aiResult.provider}`);
      console.log(`   Key Type: ${aiResult.keyType}`);
      console.log(`   Content Length: ${aiResult.content?.length || 0} chars`);
      
    } catch (error) {
      console.log('❌ AI Generation Failed:');
      console.log(`   Error: ${error.message}`);
    }
    
    try {
      // Test Image Generation
      console.log('\n🖼️ Testing Image Generation...');
      
      const imageResult = await imageGenerationService.generateImage(
        'A professional office workspace',
        'professional',
        '1024x1024',
        config.token,
        config.userId
      );
      
      console.log('✅ Image Generation Success:');
      console.log(`   Provider: ${imageResult.provider}`);
      console.log(`   Key Type: ${imageResult.keyType}`);
      console.log(`   Image Size: ${imageResult.imageBuffer?.length || 0} bytes`);
      
    } catch (error) {
      console.log('❌ Image Generation Failed:');
      console.log(`   Error: ${error.message}`);
    }
  }
  
  // Restore original function
  global.getUserPreferenceAndKeys = originalGetUserPreferenceAndKeys;
  
  console.log('\n🏁 Test Complete\n');
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testKeyIntegration().catch(console.error);
}

export { testKeyIntegration };

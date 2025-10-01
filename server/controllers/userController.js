import { pool } from '../config/database.js';

// Fetch BYOK/platform mode and lock status from centralized new-platform API
export async function getApiKeyPreference(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    let token = req.cookies?.accessToken;
    if (!token) {
      const authHeader = req.headers['authorization'];
      token = authHeader && authHeader.split(' ')[1];
    }
    
    if (!token) {
      return res.status(401).json({ error: 'No access token found' });
    }
    
    // Fetch from centralized new-platform API instead of local database
    const baseUrl = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';
    const axios = await import('axios');
    const response = await axios.default.get(`${baseUrl}/byok/preference`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Failed to fetch API key preference from new-platform:', error.message);
    res.status(500).json({ error: 'Failed to fetch API key preference' });
  }
}
// LinkedIn Genie User Controller
export function getProfile(req, res) {
  // TODO: Fetch LinkedIn user profile
  res.send('Get LinkedIn user profile (not implemented)');
}

export function updateProfile(req, res) {
  // TODO: Update user profile/settings
  res.send('Update LinkedIn user profile (not implemented)');
}

// Add user status endpoint for /api/user/status
export function getUserStatus(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.user });
}

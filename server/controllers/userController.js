import { pool } from '../config/database.js';
import axios from 'axios';

const NEW_PLATFORM_BASE_URL = process.env.NEW_PLATFORM_API_URL || 'http://localhost:3000/api';

/**
 * Build headers for a server-to-server proxy call to new-platform.
 * Forwards both the accessToken (as Bearer) and both auth cookies so
 * new-platform's authenticateToken middleware can run its refresh-token
 * fallback when the 15-minute accessToken has expired.
 */
function buildNewPlatformProxyHeaders(req) {
  const accessToken = req.cookies?.accessToken;
  const refreshToken = req.cookies?.refreshToken;

  // Prefer the Cookie header so new-platform can auto-refresh via its
  // cookie-based refresh flow. Also include Authorization as a fallback.
  const cookieParts = [];
  if (accessToken) cookieParts.push(`accessToken=${accessToken}`);
  if (refreshToken) cookieParts.push(`refreshToken=${refreshToken}`);

  const headers = {};
  if (cookieParts.length > 0) {
    headers['Cookie'] = cookieParts.join('; ');
  }
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return headers;
}

// Fetch BYOK/platform mode and lock status from centralized new-platform API
export async function getApiKeyPreference(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const headers = buildNewPlatformProxyHeaders(req);
    if (!headers['Authorization'] && !headers['Cookie']) {
      return res.status(401).json({ error: 'No access token found' });
    }

    const response = await axios.get(`${NEW_PLATFORM_BASE_URL}/byok/preference`, { headers });
    res.json(response.data);
  } catch (error) {
    console.error('Failed to fetch API key preference from new-platform:', error.message);
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }
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

// Fetch BYOK keys from centralized new-platform API
export async function getByokKeys(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const headers = buildNewPlatformProxyHeaders(req);
    if (!headers['Authorization'] && !headers['Cookie']) {
      return res.status(401).json({ error: 'No access token found' });
    }

    const response = await axios.get(`${NEW_PLATFORM_BASE_URL}/byok/keys`, { headers });
    res.json(response.data);
  } catch (error) {
    console.error('Failed to fetch BYOK keys from new-platform:', error.message);
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }
    res.status(500).json({ error: 'Failed to fetch BYOK keys' });
  }
}

import { pool } from '../config/database.js';

// Fetch BYOK/platform mode and lock status for the current user
export async function getApiKeyPreference(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { id } = req.user;
    const result = await pool.query(
      'SELECT api_key_preference, byok_locked_until, byok_activated_at FROM users WHERE id = $1',
      [id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const pref = result.rows[0];
    res.json({
      api_key_preference: pref.api_key_preference,
      byok_locked_until: pref.byok_locked_until,
      byok_activated_at: pref.byok_activated_at
    });
  } catch (error) {
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

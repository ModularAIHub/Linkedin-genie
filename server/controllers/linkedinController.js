import { pool } from '../config/database.js';
import * as oauthController from './oauthController.mjs';

// GET /api/linkedin/status - Returns connected LinkedIn account info
export async function getStatus(req, res) {
  try {
    // Allow internal services to pass a platform user id via header when using x-internal-api-key.
    // internalAuth middleware sets `req.isInternal` for such requests.
    let userId = req.user?.id;
    if (!userId && req.isInternal) {
      const headerId = req.headers['x-platform-user-id'] || req.headers['x-platform-user-id'.toLowerCase()];
      if (headerId) userId = headerId;
    }
    console.log('[DEBUG] /api/linkedin/status userId:', userId, 'isInternal:', !!req.isInternal);
    if (req.isInternal) {
      const headerId = req.headers['x-platform-user-id'] || req.headers['x-platform-user-id'.toLowerCase()];
      console.log('[DEBUG] /api/linkedin/status internal header x-platform-user-id:', headerId || '(none)');
    }
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    // Fetch all linkedin_auth rows for this user
    const { rows } = await pool.query(
      `SELECT * FROM linkedin_auth WHERE user_id = $1`,
      [userId]
    );
    console.log('[DEBUG] /api/linkedin/status DB rows:', rows);
    if (rows.length === 0) {
      return res.json({ accounts: [] });
    }
    // Map all accounts (future-proof for multi-account)
    const accounts = rows.map(account => ({
      id: account.linkedin_user_id,
      username: account.linkedin_username,
      display_name: account.linkedin_display_name,
      profile_image_url: account.linkedin_profile_image_url,
      connections_count: account.connections_count,
      headline: account.headline,
      created_at: account.created_at
    }));
    res.json({ accounts });
  } catch (error) {
    console.error('LinkedIn status error:', error);
    res.status(500).json({ error: 'Failed to fetch LinkedIn account status' });
  }
}

// GET /api/linkedin/connect - Initiate LinkedIn OAuth (reuse existing logic)
export function startOAuth(req, res) {
  return oauthController.startOAuth(req, res);
}

// POST /api/linkedin/disconnect - Disconnect LinkedIn account
export async function disconnect(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    await pool.query('DELETE FROM linkedin_auth WHERE user_id = $1', [userId]);
    res.json({ success: true });
  } catch (error) {
    console.error('LinkedIn disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect LinkedIn account' });
  }
}

// GET /api/linkedin/profile - Get LinkedIn profile info
export async function getProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { rows } = await pool.query(
      `SELECT linkedin_user_id, linkedin_username, linkedin_display_name, linkedin_profile_image_url, headline, connections_count
       FROM linkedin_auth WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No LinkedIn account connected' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('LinkedIn profile error:', error);
    res.status(500).json({ error: 'Failed to fetch LinkedIn profile' });
  }
}

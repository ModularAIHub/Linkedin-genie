import { pool } from '../config/database.js';
import * as oauthController from './oauthController.mjs';

const parseSocialLinkedinUserId = (row = {}) => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const fromMetadata = String(metadata?.linkedin_user_id || '').trim();
  if (fromMetadata) return fromMetadata;
  const accountId = String(row?.account_id || '').trim();
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

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
    // Social-first: personal LinkedIn connections now live in social_connected_accounts.
    const { rows: socialRows } = await pool.query(
      `SELECT id, account_id, account_username, account_display_name, profile_image_url, followers_count, metadata, created_at
       FROM social_connected_accounts
       WHERE user_id::text = $1::text
         AND team_id IS NULL
         AND platform = 'linkedin'
         AND is_active = true
       ORDER BY updated_at DESC NULLS LAST, id DESC`,
      [userId]
    );
    console.log('[DEBUG] /api/linkedin/status social rows:', socialRows);
    if (socialRows.length > 0) {
      const accounts = socialRows.map((account) => ({
        id: parseSocialLinkedinUserId(account) || account.account_id || String(account.id),
        username: account.account_username || parseSocialLinkedinUserId(account),
        display_name: account.account_display_name || account.account_username || parseSocialLinkedinUserId(account),
        profile_image_url: account.profile_image_url || null,
        connections_count: Number(account.followers_count || 0),
        headline: null,
        created_at: account.created_at
      }));
      return res.json({ accounts });
    }

    // Legacy fallback for environments not yet fully backfilled.
    const { rows } = await pool.query(
      `SELECT * FROM linkedin_auth WHERE user_id = $1`,
      [userId]
    );
    console.log('[DEBUG] /api/linkedin/status legacy rows:', rows);
    if (rows.length === 0) {
      return res.json({ accounts: [] });
    }

    const accounts = rows.map((account) => ({
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
    await pool.query(
      `UPDATE social_connected_accounts
       SET is_active = false,
           updated_at = NOW()
       WHERE user_id = $1
         AND team_id IS NULL
         AND platform = 'linkedin'
         AND is_active = true`,
      [userId]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('LinkedIn disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect LinkedIn account' });
  }
}

// GET /api/linkedin/profile - Get LinkedIn profile info
export async function getProfile(req, res) {
  try {
    let userId = req.user?.id;
    if (!userId && req.isInternal) {
      const headerId = req.headers['x-platform-user-id'] || req.headers['x-platform-user-id'.toLowerCase()];
      if (headerId) userId = headerId;
    }
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { rows: socialRows } = await pool.query(
      `SELECT account_id, account_username, account_display_name, profile_image_url, followers_count, metadata
       FROM social_connected_accounts
       WHERE user_id::text = $1::text
         AND team_id IS NULL
         AND platform = 'linkedin'
         AND is_active = true
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );

    if (socialRows.length > 0) {
      const social = socialRows[0];
      return res.json({
        linkedin_user_id: parseSocialLinkedinUserId(social),
        linkedin_username: social.account_username || parseSocialLinkedinUserId(social),
        linkedin_display_name: social.account_display_name || social.account_username || parseSocialLinkedinUserId(social),
        linkedin_profile_image_url: social.profile_image_url || null,
        headline: null,
        connections_count: Number(social.followers_count || 0),
      });
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

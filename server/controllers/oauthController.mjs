// LinkedIn Genie OAuth controller (scaffold)
// Handles LinkedIn OAuth flow and token storage

import * as config from '../config/index.js';
import axios from 'axios';
import { pool } from '../config/database.js';

// Start LinkedIn OAuth: return LinkedIn OAuth URL for popup
export function startOAuth(req, res) {
  // Debug log to check env values
  console.log('DEBUG LINKEDIN_CLIENT_ID:', config.getLinkedInClientId());
  console.log('DEBUG LINKEDIN_REDIRECT_URI:', config.getLinkedInRedirectUri());
  const state = Math.random().toString(36).substring(2, 15); // Simple random state
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.getLinkedInClientId(),
    redirect_uri: config.getLinkedInRedirectUri(),
    // Only w_member_social for posting, remove r_member_social
    scope: 'openid email profile w_member_social',
    state
  });
  const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  res.json({ url, state });
}

// Handle LinkedIn OAuth callback: exchange code for access token
export async function handleOAuthCallback(req, res) {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');
  try {
    // Debug log for OAuth params
    const redirectUri = config.getLinkedInRedirectUri();
    const clientId = config.getLinkedInClientId();
    const clientSecret = config.getLinkedInClientSecret();
    console.log('[DEBUG] LinkedIn OAuth callback params:', {
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret ? '[HIDDEN]' : undefined
    });
    // Exchange code for access token (OIDC)
    let tokenRes;
    try {
      tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      console.log('[DEBUG] LinkedIn token exchange response:', tokenRes.data);
    } catch (tokenErr) {
      console.error('LinkedIn token exchange error:', tokenErr?.response?.data || tokenErr.message, tokenErr.stack);
      throw tokenErr;
    }
    const accessToken = tokenRes.data.access_token;
    // Fetch user info from OIDC userinfo endpoint
    let userInfo = null;
    try {
      const userInfoRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      userInfo = userInfoRes.data;
    } catch (userInfoErr) {
      console.error('Failed to fetch LinkedIn OIDC userinfo:', userInfoErr?.response?.data || userInfoErr.message, userInfoErr.stack);
    }

    // Persist LinkedIn OAuth tokens and profile in linkedin_auth table (parity with twitter_auth)
    if (userInfo && userInfo.email) {
      const linkedinUserId = userInfo.sub || userInfo.id || null;
      const linkedinUsername = userInfo.preferred_username || null;
      const linkedinDisplayName = userInfo.name || userInfo.given_name || null;
      const linkedinProfileImageUrl = userInfo.picture || null;
      const headline = userInfo.headline || null;
      // Do not fetch or store connections count (LinkedIn API does not allow it for most apps)
      let connectionsCount = null;
      // Find user_id from users table by email only
      let userId = null;
      const result = await pool.query('SELECT id FROM users WHERE email = $1', [userInfo.email]);
      if (result.rows[0]) userId = result.rows[0].id;
      if (userId) {
        // Upsert into linkedin_auth by linkedin_user_id (fixes unique constraint error)
        await pool.query(`
          INSERT INTO linkedin_auth (
            user_id, access_token, refresh_token, token_expires_at,
            linkedin_user_id, linkedin_username, linkedin_display_name,
            linkedin_profile_image_url, connections_count, headline, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          ON CONFLICT (linkedin_user_id) DO UPDATE SET
            user_id = $1,
            access_token = $2,
            refresh_token = $3,
            token_expires_at = $4,
            linkedin_username = $6,
            linkedin_display_name = $7,
            linkedin_profile_image_url = $8,
            connections_count = $9,
            headline = $10,
            updated_at = NOW()
        `, [
          userId,
          accessToken,
          null, // refresh_token (not used in OIDC flow)
          null, // token_expires_at (not used in OIDC flow)
          linkedinUserId,
          linkedinUsername,
          linkedinDisplayName,
          linkedinProfileImageUrl,
          connectionsCount,
          headline
        ]);
      }
    }

    // For popup flow: send a postMessage to opener and close window
    const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5175';
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:2em;">
      <script>
        console.log('OAuth popup: sending postMessage to opener...');
        if (window.opener) {
          window.opener.postMessage({ type: 'linkedin_auth_success', accessToken: '${accessToken}', user: ${JSON.stringify(userInfo)} }, '${clientOrigin}');
          window.close();
        }
      </script>
      <h2>LinkedIn connected!</h2>
      <p>You can close this window and return to the app.</p>
      </body></html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error?.response?.data || error.message, error.stack);
    const clientOrigin = process.env.CLIENT_URL || 'http://localhost:5175';
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:2em;">
      <script>
        console.log('OAuth popup: sending postMessage error to opener...');
        if (window.opener) {
          window.opener.postMessage({ type: 'linkedin_auth_error', error: '${error.message}' }, '${clientOrigin}');
          window.close();
        }
      </script>
      <h2>LinkedIn connection failed</h2>
      <p>There was a problem connecting your LinkedIn account.<br/>You can close this window and try again.</p>
      <pre style="color:#c00;font-size:0.9em;text-align:left;max-width:600px;margin:2em auto;overflow-x:auto;">${error?.response?.data ? JSON.stringify(error.response.data, null, 2) : error.message}</pre>
      </body></html>
    `);
  }
}

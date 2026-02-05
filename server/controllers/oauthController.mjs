// LinkedIn Genie OAuth controller (scaffold)
// Handles LinkedIn OAuth flow and token storage

import * as config from '../config/index.js';
import axios from 'axios';
import { pool } from '../config/database.js';
import pg from 'pg';

// Create a separate pool for new-platform database (for teams and team_members tables)
const { Pool } = pg;
const newPlatformPool = new Pool({
  connectionString: process.env.NEW_PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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
    // Use OpenID Connect scopes for LinkedIn Sign In with LinkedIn
    scope: 'openid profile email w_member_social',
    state
  });
  const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  res.json({ url, state });
}

// Handle LinkedIn OAuth callback: exchange code for access token
export async function handleOAuthCallback(req, res) {
  const { code, state } = req.query;
  if (!code) return res.status(400).send('Missing code');
  
  // Check if this is a team connection (state starts with 'team_')
  const isTeamConnection = state && state.startsWith('team_');
  const stateData = isTeamConnection ? stateStore.get(state) : null;
  
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
    // Fetch user info using LinkedIn OpenID Connect userinfo endpoint
    let userInfo = null;
    try {
      const userInfoRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      const profile = userInfoRes.data || {};
      
      // OpenID Connect format provides standardized fields
      const firstName = profile.given_name || '';
      const lastName = profile.family_name || '';
      let displayName = profile.name || `${firstName} ${lastName}`.trim();

      // Profile picture from OpenID response
      const profileImageUrl = profile.picture || null;

      userInfo = {
        id: profile.sub,
        email: profile.email,
        name: displayName || null,
        picture: profileImageUrl || null,
        // keep some OIDC-like aliases used by existing code
        sub: profile.sub,
        preferred_username: profile.preferred_username || null,
        given_name: firstName || null,
        family_name: lastName || null,
        headline: null
      };
      console.log('[DEBUG] LinkedIn profile fetched:', { id: userInfo.id, email: userInfo.email, name: userInfo.name });
    } catch (userInfoErr) {
      // This prevents throwing on 404 from an incorrect endpoint and surfaces a helpful debug message
      console.error('Failed to fetch LinkedIn profile/email:', userInfoErr?.response?.data || userInfoErr.message, userInfoErr.stack);
    }

    // Handle team connection
    if (isTeamConnection && stateData) {
      const { teamId, userId, returnUrl } = stateData;
      stateStore.delete(state);
      
      if (userInfo && userInfo.sub) {
        const linkedinUserId = userInfo.sub;
        const linkedinUsername = userInfo.preferred_username || null;
        const linkedinDisplayName = userInfo.name || userInfo.given_name || null;
        const linkedinProfileImageUrl = userInfo.picture || null;
        const headline = userInfo.headline || null;
        const connectionsCount = null;
        
        try {
          // Verify user is owner or admin of this team (query new-platform database)
          const { rows: memberRows } = await newPlatformPool.query(
            `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
            [teamId, userId]
          );
          
          if (!memberRows.length) {
            return res.redirect(`${returnUrl}?error=not_team_member`);
          }
          
          const userRole = memberRows[0].role;
          if (userRole !== 'owner' && userRole !== 'admin') {
            return res.redirect(`${returnUrl}?error=insufficient_permissions`);
          }
          
          // Check if this LinkedIn account is already connected to THIS SPECIFIC TEAM
          // (Same account CAN be connected to different teams)
          const { rows: existingRows } = await pool.query(
            `SELECT lta.id, lta.team_id, lta.linkedin_username, lta.linkedin_display_name
             FROM linkedin_team_accounts lta
             WHERE lta.linkedin_user_id = $1 AND lta.team_id = $2 AND lta.active = true`,
            [linkedinUserId, teamId]
          );
          
          if (existingRows.length > 0) {
            const existing = existingRows[0];
            // Get team name from new-platform database
            let teamName = 'this team';
            try {
              const { rows: teamRows } = await newPlatformPool.query(
                `SELECT name FROM teams WHERE id = $1`,
                [teamId]
              );
              if (teamRows.length > 0) {
                teamName = teamRows[0].name;
              }
            } catch (err) {
              console.warn('[Team OAuth] Could not fetch team name:', err);
            }
            
            console.log('[Team OAuth] LinkedIn account already connected to this team:', { linkedinUserId, teamId, teamName });
            // Include account info in error URL for better UX
            const errorParams = new URLSearchParams({
              error: 'already_connected',
              existingTeam: teamName,
              accountName: existing.linkedin_display_name || existing.linkedin_username || 'this account'
            });
            return res.redirect(`${returnUrl}?${errorParams.toString()}`);
          }
          
          // Insert into linkedin_team_accounts
          await pool.query(
            `INSERT INTO linkedin_team_accounts (
              team_id, user_id, linkedin_user_id, linkedin_username, linkedin_display_name,
              access_token, refresh_token, token_expires_at, linkedin_profile_image_url,
              connections_count, headline, active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
            [
              teamId,
              userId,
              linkedinUserId,
              linkedinUsername,
              linkedinDisplayName,
              accessToken,
              null, // refresh_token
              null, // token_expires_at
              linkedinProfileImageUrl,
              connectionsCount,
              headline
            ]
          );
          
          console.log('[Team OAuth] Successfully connected LinkedIn account to team:', { teamId, linkedinUserId });
          
          // Redirect back to team page with success
          return res.redirect(`${returnUrl}?success=team&username=${linkedinUsername || linkedinDisplayName}`);
        } catch (error) {
          console.error('[Team OAuth] Error saving team account:', error);
          return res.redirect(`${returnUrl}?error=save_failed`);
        }
      } else {
        return res.redirect(`${stateData.returnUrl}?error=profile_fetch_failed`);
      }
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
      
      // Fetch organization pages the user manages
      let organizations = [];
      try {
        const orgResponse = await axios.get(
          'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&projection=(elements*(organization~(localizedName,vanityName,logoV2(original~:playableStreams)),roleAssignee,state))',
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'LinkedIn-Version': '202405'
            }
          }
        );
        
        if (orgResponse.data?.elements) {
          organizations = orgResponse.data.elements
            .filter(acl => acl.state === 'APPROVED' && acl.roleAssignee)
            .map(acl => ({
              id: acl.organization?.replace('urn:li:organization:', ''),
              urn: acl.organization,
              name: acl['organization~']?.localizedName,
              vanityName: acl['organization~']?.vanityName,
              logo: acl['organization~']?.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0]?.identifier
            }));
          console.log(`[OAuth] Found ${organizations.length} organizations for user`);
        }
      } catch (orgError) {
        console.warn('[OAuth] Could not fetch organizations:', orgError.message);
        // Continue even if org fetch fails
      }
      
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
      
      // If user has organizations, redirect to selection page
      if (organizations.length > 0) {
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
        const orgsParam = encodeURIComponent(JSON.stringify(organizations));
        return res.redirect(`${clientUrl}/settings?linkedin_connected=true&select_account=true&organizations=${orgsParam}`);
      }
    }

    // Redirect to settings page after successful personal account connection
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
    res.redirect(`${clientUrl}/settings?linkedin_connected=true`);
  } catch (error) {
    console.error('OAuth callback error:', error?.response?.data || error.message, error.stack);
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
    res.redirect(`${clientUrl}/settings?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
  }
}

// In-memory store for team OAuth state (like Twitter's pkceStore)
const stateStore = new Map();

// Start Team LinkedIn OAuth
export function startTeamOAuth(req, res) {
  try {
    const { teamId, userId, returnUrl } = req.query;
    
    if (!teamId || !userId || !returnUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameters: teamId, userId, and returnUrl' 
      });
    }
    
    console.log('Generating LinkedIn OAuth URL for team connection:', { teamId, userId, returnUrl });
    
    // Generate unique state for this team connection
    const state = `team_${teamId}_${userId}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Store team context with state
    stateStore.set(state, {
      teamId,
      userId,
      returnUrl,
      timestamp: Date.now()
    });
    
    // Set expiry for the stored state (5 minutes)
    setTimeout(() => {
      stateStore.delete(state);
    }, 5 * 60 * 1000);
    
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.getLinkedInClientId(),
      redirect_uri: config.getLinkedInRedirectUri(),
      scope: 'openid profile email w_member_social',
      state
    });
    
    const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    console.log('Generated team OAuth URL, redirecting to LinkedIn...');
    res.redirect(url);
  } catch (error) {
    console.error('Failed to generate team OAuth URL:', error);
    const { returnUrl } = req.query;
    if (returnUrl) {
      return res.redirect(`${returnUrl}?error=oauth_init_failed`);
    }
    res.status(500).json({ error: 'Failed to initiate LinkedIn team connection' });
  }
}

// Select account type (personal profile vs organization page)
export async function selectAccountType(req, res) {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const { accountType, organizationId, organizationName, organizationVanityName } = req.body;
    
    if (!accountType || !['personal', 'organization'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type. Must be "personal" or "organization"' });
    }
    
    if (accountType === 'organization' && !organizationId) {
      return res.status(400).json({ error: 'Organization ID required when selecting organization account' });
    }
    
    // Update the linkedin_auth record with account type selection
    await pool.query(`
      UPDATE linkedin_auth 
      SET account_type = $1,
          organization_id = $2,
          organization_name = $3,
          organization_vanity_name = $4,
          updated_at = NOW()
      WHERE user_id = $5
    `, [
      accountType,
      accountType === 'organization' ? organizationId : null,
      accountType === 'organization' ? organizationName : null,
      accountType === 'organization' ? organizationVanityName : null,
      user.id
    ]);
    
    console.log(`[Select Account Type] User ${user.id} selected ${accountType}${accountType === 'organization' ? ` - ${organizationName}` : ''}`);
    
    res.json({ 
      success: true, 
      message: `Successfully configured ${accountType} account`,
      accountType,
      organizationName: accountType === 'organization' ? organizationName : null
    });
  } catch (error) {
    console.error('[Select Account Type] Error:', error);
    res.status(500).json({ error: 'Failed to save account type selection' });
  }
}

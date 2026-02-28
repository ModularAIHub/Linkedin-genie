// LinkedIn Genie OAuth controller
// Handles LinkedIn OAuth flow and token storage

import * as config from '../config/index.js';
import axios from 'axios';
import crypto from 'crypto';
import { pool } from '../config/database.js';
import pg from 'pg';

// Create a separate pool for new-platform database (for teams and team_members tables)
const { Pool } = pg;
const platformDatabaseUrl = process.env.NEW_PLATFORM_DATABASE_URL || process.env.DATABASE_URL || '';
const usePlatformDbSsl =
  platformDatabaseUrl.includes('supabase.com') ||
  platformDatabaseUrl.includes('supabase.co') ||
  process.env.NODE_ENV === 'production';

const newPlatformPool = new Pool({
  connectionString: platformDatabaseUrl,
  ssl: usePlatformDbSsl ? { rejectUnauthorized: false } : false,
});

// In-memory store for team OAuth state (like Twitter's pkceStore)
const stateStore = new Map();

// UPDATED SCOPES - includes analytics scopes
const LINKEDIN_SCOPES = 'openid profile email w_member_social r_organization_social r_organization_admin w_organization_social';
const LINKEDIN_PLATFORM = 'linkedin';

const normalizeString = (value, maxLen = null) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  if (Number.isFinite(maxLen) && maxLen > 0) {
    return stringValue.slice(0, maxLen);
  }
  return stringValue;
};

const resolveTeamReturnUrl = (returnUrl) => {
  const fallbackBase = String(
    process.env.PLATFORM_URL ||
    process.env.CLIENT_URL ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');

  try {
    const parsed = new URL(String(returnUrl));
    return `${parsed.origin}/team`;
  } catch {
    return `${fallbackBase}/team`;
  }
};

async function upsertLinkedInSocialConnectedAccount({
  userId,
  teamId = null,
  accountId,
  accountUsername = null,
  accountDisplayName = null,
  accessToken,
  refreshToken = null,
  tokenExpiresAt = null,
  profileImageUrl = null,
  followersCount = 0,
  metadata = {},
  connectedBy = null,
}) {
  const normalizedUserId = normalizeString(userId, 128);
  const normalizedTeamId = normalizeString(teamId, 128);
  const normalizedAccountId = normalizeString(accountId, 255);
  const normalizedAccessToken = normalizeString(accessToken);

  if (!normalizedUserId || !normalizedAccountId || !normalizedAccessToken) {
    return null;
  }

  const safeFollowersCount = Number.isFinite(Number(followersCount))
    ? Number(followersCount)
    : 0;
  const safeMetadata = metadata && typeof metadata === 'object' ? metadata : {};
  const connectedByUser = normalizeString(connectedBy, 128) || normalizedUserId;

  try {
    const lookup = normalizedTeamId
      ? await pool.query(
          `SELECT id
           FROM social_connected_accounts
           WHERE team_id::text = $1::text
             AND platform = $2
             AND account_id = $3
           LIMIT 1`,
          [normalizedTeamId, LINKEDIN_PLATFORM, normalizedAccountId]
        )
      : await pool.query(
          `SELECT id
           FROM social_connected_accounts
           WHERE user_id = $1
             AND team_id IS NULL
             AND platform = $2
             AND account_id = $3
           LIMIT 1`,
          [normalizedUserId, LINKEDIN_PLATFORM, normalizedAccountId]
        );

    if (lookup.rows[0]?.id) {
      const existingId = lookup.rows[0].id;
      await pool.query(
        `UPDATE social_connected_accounts
         SET account_username = $1,
             account_display_name = $2,
             access_token = $3,
             refresh_token = $4,
             token_expires_at = $5,
             profile_image_url = $6,
             followers_count = $7,
             metadata = $8::jsonb,
             connected_by = $9,
             is_active = true,
             updated_at = NOW()
         WHERE id = $10`,
        [
          normalizeString(accountUsername, 255),
          normalizeString(accountDisplayName, 255),
          normalizedAccessToken,
          normalizeString(refreshToken),
          tokenExpiresAt || null,
          normalizeString(profileImageUrl, 2048),
          safeFollowersCount,
          JSON.stringify(safeMetadata),
          connectedByUser,
          existingId,
        ]
      );
      return existingId;
    }

    const insertedId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO social_connected_accounts (
        id, user_id, team_id, platform, account_id, account_username, account_display_name,
        access_token, refresh_token, token_expires_at, profile_image_url, followers_count,
        metadata, connected_by, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13::jsonb, $14, true
      )`,
      [
        insertedId,
        normalizedUserId,
        normalizedTeamId,
        LINKEDIN_PLATFORM,
        normalizedAccountId,
        normalizeString(accountUsername, 255),
        normalizeString(accountDisplayName, 255),
        normalizedAccessToken,
        normalizeString(refreshToken),
        tokenExpiresAt || null,
        normalizeString(profileImageUrl, 2048),
        safeFollowersCount,
        JSON.stringify(safeMetadata),
        connectedByUser,
      ]
    );

    return insertedId;
  } catch (error) {
    console.warn('[OAuth] Failed to mirror LinkedIn account into social_connected_accounts:', error?.message || error);
    return null;
  }
}

function getClientCallbackUrl({ status = 'success', reason = null, message = null } = {}) {
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
  const params = new URLSearchParams({
    provider: 'linkedin',
    status
  });

  if (reason) {
    params.set('reason', reason);
  }
  if (message) {
    params.set('message', message);
  }

  return `${clientUrl}/auth/callback?${params.toString()}`;
}

function sendPopupResult(
  res,
  messageType,
  payload = {},
  message = 'Authentication complete. You can close this window.',
  fallbackRedirectUrl = null
) {
  const eventData = JSON.stringify({ type: messageType, ...payload })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
  const safeMessage = String(message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeFallbackUrl = fallbackRedirectUrl
    ? JSON.stringify(String(fallbackRedirectUrl).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'))
    : 'null';

  // Helmet default CSP/COOP can block inline script and sever opener for popup callbacks.
  // Override only for this tiny callback page.
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'");
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');

  return res.send(`
    <html>
      <body>
        <script>
          var fallbackUrl = ${safeFallbackUrl};
          try {
            if (window.opener) {
              window.opener.postMessage(${eventData}, '*');
            }
          } catch (e) {}
          window.close();
          // Chrome fallback for some popup states
          setTimeout(function () {
            try { window.open('', '_self'); } catch (e) {}
            try { window.close(); } catch (e) {}
            if (fallbackUrl) {
              try {
                window.location.replace(fallbackUrl);
              } catch (e) {
                window.location.href = fallbackUrl;
              }
            }
          }, 120);
        </script>
        <p>${safeMessage}</p>
      </body>
    </html>
  `);
}

// Start LinkedIn OAuth: return LinkedIn OAuth URL for popup
export function startOAuth(req, res) {
  const popup = String(req.query.popup || '').toLowerCase() === 'true';
  const state = `personal_${Math.random().toString(36).substring(2, 15)}`;
  stateStore.set(state, {
    popup,
    timestamp: Date.now()
  });
  setTimeout(() => {
    stateStore.delete(state);
  }, 10 * 60 * 1000);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.getLinkedInClientId(),
    redirect_uri: config.getLinkedInRedirectUri(),
    scope: LINKEDIN_SCOPES,
    state
  });
  const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  res.json({ url, state });
}

// Handle LinkedIn OAuth callback: exchange code for access token
export async function handleOAuthCallback(req, res) {
  const { code, state } = req.query;

  // Check if this is a team connection (state starts with 'team_')
  const isTeamConnection = state && state.startsWith('team_');
  const stateData = state ? stateStore.get(state) : null;
  const isPopupFlow = !isTeamConnection && !!stateData?.popup;

  if (!code) {
    if (!isTeamConnection) {
      return res.redirect(getClientCallbackUrl({ status: 'error', reason: 'missing_code' }));
    }
    if (isTeamConnection && stateData?.returnUrl) {
      return res.redirect(`${stateData.returnUrl}?error=missing_code`);
    }
    return res.status(400).send('Missing code');
  }

  if (state && !isTeamConnection) {
    stateStore.delete(state);
  }

  try {
    const redirectUri = config.getLinkedInRedirectUri();
    const clientId = config.getLinkedInClientId();
    const clientSecret = config.getLinkedInClientSecret();

    console.log('[DEBUG] LinkedIn OAuth callback params:', {
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret ? '[HIDDEN]' : undefined
    });

    // Exchange code for access token
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
      console.log('[DEBUG] LinkedIn token exchange response:', {
        ...tokenRes.data,
        access_token: '[HIDDEN]',
        id_token: '[HIDDEN]'
      });
    } catch (tokenErr) {
      console.error('LinkedIn token exchange error:', tokenErr?.response?.data || tokenErr.message);
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
      const firstName = profile.given_name || '';
      const lastName = profile.family_name || '';
      let displayName = profile.name || `${firstName} ${lastName}`.trim();
      const profileImageUrl = profile.picture || null;

      userInfo = {
        id: profile.sub,
        email: profile.email,
        name: displayName || null,
        picture: profileImageUrl || null,
        sub: profile.sub,
        preferred_username: profile.preferred_username || null,
        given_name: firstName || null,
        family_name: lastName || null,
        headline: null
      };

      console.log('[DEBUG] LinkedIn profile fetched:', {
        id: userInfo.id,
        email: userInfo.email,
        name: userInfo.name
      });
    } catch (userInfoErr) {
      console.error('Failed to fetch LinkedIn profile/email:', userInfoErr?.response?.data || userInfoErr.message);
    }

    // ─── TEAM CONNECTION FLOW ───────────────────────────────────────────────
    if (isTeamConnection && stateData) {
      const { teamId, userId, returnUrl } = stateData;
      stateStore.delete(state);

      if (userInfo && userInfo.sub) {
        const linkedinUserId = userInfo.sub;
        const linkedinUsername = userInfo.preferred_username || null;
        const linkedinDisplayName = userInfo.name || userInfo.given_name || null;
        const linkedinProfileImageUrl = userInfo.picture || null;
        const headline = userInfo.headline || null;

        try {
          // Verify user is owner or admin of this team
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

          // Fetch organization pages the user manages
          // Uses r_organization_admin scope (now included)
          let organizations = [];
          try {
            console.log('[Team OAuth] Fetching organization pages...');
            const orgResponse = await axios.get(
              'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED',
              {
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'LinkedIn-Version': '202405',
                  'X-Restli-Protocol-Version': '2.0.0'
                }
              }
            );

            if (orgResponse.data?.elements) {
              // Fetch org details for each
              const orgDetails = await Promise.allSettled(
                orgResponse.data.elements.map(async (acl) => {
                  const orgUrn = acl.organization;
                  const orgId = orgUrn?.replace('urn:li:organization:', '');
                  try {
                    const detailRes = await axios.get(
                      `https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`,
                      {
                        headers: {
                          'Authorization': `Bearer ${accessToken}`,
                          'LinkedIn-Version': '202405'
                        }
                      }
                    );
                    return {
                      id: orgId,
                      urn: orgUrn,
                      name: detailRes.data?.localizedName,
                      vanityName: detailRes.data?.vanityName,
                      logo: detailRes.data?.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0]?.identifier
                    };
                  } catch {
                    return { id: orgId, urn: orgUrn, name: `Organization ${orgId}` };
                  }
                })
              );

              organizations = orgDetails
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value);

              console.log(`[Team OAuth] Found ${organizations.length} organizations`);
            }
          } catch (orgError) {
            console.warn('[Team OAuth] Could not fetch organizations:', orgError.response?.data || orgError.message);
            // Continue without organizations - user can still connect personal account
          }

          // Check if personal account is already connected to ANY team globally
          const { rows: existingGlobalRows } = await pool.query(
            `SELECT lta.id, lta.linkedin_display_name, lta.team_id, t.name as team_name
             FROM linkedin_team_accounts lta
             LEFT JOIN teams t ON t.id::text = lta.team_id::text
             WHERE lta.linkedin_user_id = $1 AND lta.active = true`,
            [linkedinUserId]
          );

          const connectedToOtherTeam = existingGlobalRows.find(
            (row) => String(row.team_id) !== String(teamId)
          );
          if (connectedToOtherTeam) {
            return res.redirect(`${returnUrl}?error=already_connected&existingTeam=${encodeURIComponent(connectedToOtherTeam.team_name || 'another team')}&accountName=${encodeURIComponent(connectedToOtherTeam.linkedin_display_name || 'this account')}`);
          }

          const personalAlreadyConnected = existingGlobalRows.some(
            (row) => String(row.team_id) === String(teamId)
          );

          // If user has organizations, redirect to selection page
          if (organizations.length > 0) {
            const selectionId = crypto.randomUUID();
            stateStore.set(`selection_${selectionId}`, {
              teamId,
              userId,
              returnUrl,
              accessToken,
              linkedinUserId,
              linkedinUsername,
              linkedinDisplayName,
              linkedinProfileImageUrl,
              headline,
              organizations,
              personalAlreadyConnected,
              expiresAt: Date.now() + 10 * 60 * 1000
            });

            const clientUrl = resolveTeamReturnUrl(returnUrl);
            const orgsParam = encodeURIComponent(JSON.stringify(organizations.map(o => ({
              id: o.id,
              name: o.name,
              logo: o.logo
            }))));
            return res.redirect(`${clientUrl}?select_linkedin_account=true&selectionId=${selectionId}&organizations=${orgsParam}&personalConnected=${personalAlreadyConnected}&userName=${encodeURIComponent(linkedinDisplayName || linkedinUsername || '')}`);
          }

          if (personalAlreadyConnected) {
            return res.redirect(
              `${returnUrl}?success=team&already_connected=true&username=${encodeURIComponent(linkedinUsername || linkedinDisplayName || 'this account')}`
            );
          }

          // Insert personal account into linkedin_team_accounts
          const { rows: teamRows } = await pool.query(
            `INSERT INTO linkedin_team_accounts (
              team_id, user_id, linkedin_user_id, linkedin_username, linkedin_display_name,
              access_token, refresh_token, token_expires_at, linkedin_profile_image_url,
              connections_count, headline, active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
            ON CONFLICT (team_id, linkedin_user_id) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              linkedin_username = EXCLUDED.linkedin_username,
              linkedin_display_name = EXCLUDED.linkedin_display_name,
              access_token = EXCLUDED.access_token,
              linkedin_profile_image_url = EXCLUDED.linkedin_profile_image_url,
              connections_count = EXCLUDED.connections_count,
              headline = EXCLUDED.headline,
              active = true,
              updated_at = CURRENT_TIMESTAMP
            RETURNING id`,
            [
              teamId,
              userId,
              linkedinUserId,
              linkedinUsername,
              linkedinDisplayName,
              accessToken,
              null,
              null,
              linkedinProfileImageUrl,
              null,
              headline
            ]
          );

          await upsertLinkedInSocialConnectedAccount({
            userId,
            teamId,
            accountId: linkedinUserId || linkedinUsername || `${userId}_linkedin`,
            accountUsername: linkedinUsername,
            accountDisplayName: linkedinDisplayName || linkedinUsername,
            accessToken,
            refreshToken: null,
            tokenExpiresAt: null,
            profileImageUrl: linkedinProfileImageUrl,
            metadata: {
              source_table: 'linkedin_team_accounts',
              account_type: 'personal',
              legacy_team_account_id: teamRows[0]?.id || null,
              linkedin_user_id: linkedinUserId || null,
            },
            connectedBy: userId,
          });

          console.log('[Team OAuth] Successfully connected LinkedIn personal account to team:', { teamId, linkedinUserId });
          return res.redirect(`${returnUrl}?success=team&username=${linkedinUsername || linkedinDisplayName}`);

        } catch (error) {
          console.error('[Team OAuth] Error saving team account:', {
            message: error?.message || String(error),
            code: error?.code || null,
            detail: error?.detail || null,
            constraint: error?.constraint || null,
            teamId,
            userId,
            linkedinUserId,
            linkedinUsername,
            organizationsCount: organizations.length,
            stack: error?.stack || null,
          });
          return res.redirect(`${returnUrl}?error=save_failed`);
        }
      } else {
        return res.redirect(`${stateData.returnUrl}?error=profile_fetch_failed`);
      }
    }

    // ─── PERSONAL CONNECTION FLOW ────────────────────────────────────────────
    if (userInfo && userInfo.email) {
      const linkedinUserId = userInfo.sub || userInfo.id || null;
      const linkedinUsername = userInfo.preferred_username || null;
      const linkedinDisplayName = userInfo.name || userInfo.given_name || null;
      const linkedinProfileImageUrl = userInfo.picture || null;
      const headline = userInfo.headline || null;

      // Fetch organization pages using r_organization_admin scope
      let organizations = [];
      try {
        const orgResponse = await axios.get(
          'https://api.linkedin.com/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED',
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'LinkedIn-Version': '202405',
              'X-Restli-Protocol-Version': '2.0.0'
            }
          }
        );

        if (orgResponse.data?.elements) {
          const orgDetails = await Promise.allSettled(
            orgResponse.data.elements.map(async (acl) => {
              const orgUrn = acl.organization;
              const orgId = orgUrn?.replace('urn:li:organization:', '');
              try {
                const detailRes = await axios.get(
                  `https://api.linkedin.com/v2/organizations/${orgId}?projection=(id,localizedName,vanityName,logoV2(original~:playableStreams))`,
                  {
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'LinkedIn-Version': '202405'
                    }
                  }
                );
                return {
                  id: orgId,
                  urn: orgUrn,
                  name: detailRes.data?.localizedName,
                  vanityName: detailRes.data?.vanityName,
                  logo: detailRes.data?.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0]?.identifier
                };
              } catch {
                return { id: orgId, urn: orgUrn, name: `Organization ${orgId}` };
              }
            })
          );

          organizations = orgDetails
            .filter(r => r.status === 'fulfilled')
            .map(r => r.value);

          console.log(`[OAuth] Found ${organizations.length} organizations for user`);
        }
      } catch (orgError) {
        console.warn('[OAuth] Could not fetch organizations:', orgError.response?.status, orgError.message);
        // Continue even if org fetch fails — user can still connect personal account
      }

      // Find user_id from users table by email
      let userId = null;
      const result = await pool.query('SELECT id FROM users WHERE email = $1', [userInfo.email]);
      if (result.rows[0]) userId = result.rows[0].id;

      if (userId) {
        // Enforce team-mode lock before writing personal account rows.
        const membershipResult = await newPlatformPool.query(
          `SELECT 1
           FROM team_members
           WHERE user_id = $1
             AND status = 'active'
           LIMIT 1`,
          [userId]
        );
        const isInActiveTeam = membershipResult.rows.length > 0;
        if (isInActiveTeam) {
          console.log('[OAuth] User is in a team, blocking personal LinkedIn connection', { userId });
          return sendPopupResult(
            res,
            'linkedin_auth_error',
            { reason: 'in_team' },
            'Personal LinkedIn account not available for this workspace.',
            getClientCallbackUrl({ status: 'error', reason: 'in_team' })
          );
        }

        // Upsert into linkedin_auth
        const { rows: personalRows } = await pool.query(`
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
          RETURNING id
        `, [
          userId,
          accessToken,
          null,
          null,
          linkedinUserId,
          linkedinUsername,
          linkedinDisplayName,
          linkedinProfileImageUrl,
          null,
          headline
        ]);

        await upsertLinkedInSocialConnectedAccount({
          userId,
          teamId: null,
          accountId: linkedinUserId || linkedinUsername || `${userId}_linkedin`,
          accountUsername: linkedinUsername,
          accountDisplayName: linkedinDisplayName || linkedinUsername,
          accessToken,
          refreshToken: null,
          tokenExpiresAt: null,
          profileImageUrl: linkedinProfileImageUrl,
          metadata: {
            source_table: 'linkedin_auth',
            account_type: 'personal',
            legacy_personal_row_id: personalRows[0]?.id || null,
            linkedin_user_id: linkedinUserId || null,
          },
          connectedBy: userId,
        });
      }

      // If user has organizations, redirect to selection page
      if (organizations.length > 0) {
        if (isPopupFlow) {
          return sendPopupResult(
            res,
            'linkedin_auth_success',
            { organizations, selectAccount: true },
            'LinkedIn connected. Please continue in the original tab.',
            getClientCallbackUrl({ status: 'success' })
          );
        }
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:5175';
        const orgsParam = encodeURIComponent(JSON.stringify(organizations));
        return res.redirect(`${clientUrl}/settings?linkedin_connected=true&select_account=true&organizations=${orgsParam}`);
      }
    }

    if (isPopupFlow) {
      return sendPopupResult(
        res,
        'linkedin_auth_success',
        {},
        'LinkedIn account connected! You can close this window.',
        getClientCallbackUrl({ status: 'success' })
      );
    }

    return res.redirect(getClientCallbackUrl({ status: 'success' }));

  } catch (error) {
    console.error('OAuth callback error:', error?.response?.data || error.message, error.stack);
    if (isPopupFlow) {
      return sendPopupResult(
        res,
        'linkedin_auth_error',
        { reason: 'oauth_failed', message: error.message },
        `LinkedIn authentication failed: ${error.message}`,
        getClientCallbackUrl({ status: 'error', reason: 'oauth_failed', message: error.message })
      );
    }
    return res.redirect(getClientCallbackUrl({ status: 'error', reason: 'oauth_failed', message: error.message }));
  }
}

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

    const state = `team_${teamId}_${userId}_${Math.random().toString(36).substring(2, 15)}`;

    stateStore.set(state, {
      teamId,
      userId,
      returnUrl,
      timestamp: Date.now()
    });

    setTimeout(() => {
      stateStore.delete(state);
    }, 5 * 60 * 1000);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.getLinkedInClientId(),
      redirect_uri: config.getLinkedInRedirectUri(),
      scope: LINKEDIN_SCOPES,
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

// Complete team LinkedIn account selection (personal or organization)
export async function completeTeamAccountSelection(req, res) {
  try {
    const { selectionId, accountType, organizationId } = req.body;

    if (!selectionId) {
      return res.status(400).json({ error: 'Selection ID required' });
    }

    if (!accountType || !['personal', 'organization'].includes(accountType)) {
      return res.status(400).json({ error: 'Invalid account type' });
    }

    if (accountType === 'organization' && !organizationId) {
      return res.status(400).json({ error: 'Organization ID required for organization account' });
    }

    const storedData = stateStore.get(`selection_${selectionId}`);
    if (!storedData) {
      return res.status(400).json({ error: 'Selection session expired. Please try connecting again.' });
    }

    if (Date.now() > storedData.expiresAt) {
      stateStore.delete(`selection_${selectionId}`);
      return res.status(400).json({ error: 'Selection session expired. Please try connecting again.' });
    }

    const {
      teamId,
      userId,
      accessToken,
      linkedinUserId,
      linkedinUsername,
      linkedinDisplayName,
      linkedinProfileImageUrl,
      headline,
      organizations
    } = storedData;

    stateStore.delete(`selection_${selectionId}`);

    let accountName, accountId, profileUrl;

    if (accountType === 'personal') {
      const { rows: existingRows } = await pool.query(
        `SELECT id FROM linkedin_team_accounts 
         WHERE linkedin_user_id = $1 AND team_id = $2 AND active = true AND (account_type = 'personal' OR account_type IS NULL)`,
        [linkedinUserId, teamId]
      );

      if (existingRows.length > 0) {
        return res.status(400).json({ error: 'Personal account is already connected to this team' });
      }

      accountName = linkedinDisplayName || linkedinUsername;
      accountId = linkedinUserId;
      profileUrl = linkedinProfileImageUrl;

    } else {
      const org = organizations.find(o => o.id === organizationId);
      if (!org) {
        return res.status(400).json({ error: 'Organization not found in your authorized list' });
      }

      const { rows: existingOrgRows } = await pool.query(
        `SELECT id FROM linkedin_team_accounts 
         WHERE organization_id = $1 AND team_id = $2 AND active = true`,
        [organizationId, teamId]
      );

      if (existingOrgRows.length > 0) {
        return res.status(400).json({ error: `Organization "${org.name}" is already connected to this team` });
      }

      accountName = org.name;
      accountId = org.urn || `urn:li:organization:${organizationId}`;
      profileUrl = org.logo;
    }

    const { rows: teamInsertRows } = await pool.query(
      `INSERT INTO linkedin_team_accounts (
        team_id, user_id, linkedin_user_id, linkedin_username, linkedin_display_name,
        access_token, refresh_token, token_expires_at, linkedin_profile_image_url,
        connections_count, headline, active, account_type, organization_id, organization_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, $12, $13, $14)
      RETURNING id`,
      [
        teamId,
        userId,
        accountType === 'personal' ? linkedinUserId : linkedinUserId,
        accountType === 'personal' ? linkedinUsername : null,
        accountType === 'personal' ? linkedinDisplayName : accountName,
        accessToken,
        null,
        null,
        profileUrl,
        null,
        accountType === 'personal' ? headline : null,
        accountType,
        accountType === 'organization' ? organizationId : null,
        accountType === 'organization' ? accountName : null
      ]
    );

    const socialAccountId = accountType === 'organization'
      ? `org:${organizationId}`
      : (linkedinUserId || linkedinUsername || `${userId}_linkedin`);
    const socialUsername = accountType === 'organization'
      ? (organizationId ? `org-${organizationId}` : null)
      : linkedinUsername;
    const socialDisplayName = accountType === 'organization'
      ? accountName
      : (linkedinDisplayName || linkedinUsername || accountName);

    await upsertLinkedInSocialConnectedAccount({
      userId,
      teamId,
      accountId: socialAccountId,
      accountUsername: socialUsername,
      accountDisplayName: socialDisplayName,
      accessToken,
      refreshToken: null,
      tokenExpiresAt: null,
      profileImageUrl: profileUrl,
      metadata: {
        source_table: 'linkedin_team_accounts',
        account_type: accountType,
        organization_id: accountType === 'organization' ? organizationId : null,
        organization_name: accountType === 'organization' ? accountName : null,
        linkedin_user_id: linkedinUserId || null,
        legacy_team_account_id: teamInsertRows[0]?.id || null,
      },
      connectedBy: userId,
    });

    console.log(`[Team Account Selection] Successfully connected ${accountType} account to team:`, { teamId, accountType, accountName });

    res.json({
      success: true,
      message: `Successfully connected ${accountType === 'organization' ? accountName : 'personal'} account`,
      accountType,
      accountName
    });

  } catch (error) {
    console.error('[Team Account Selection] Error:', error);
    res.status(500).json({ error: 'Failed to complete account selection' });
  }
}

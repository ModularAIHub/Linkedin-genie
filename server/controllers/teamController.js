import { pool } from '../config/database.js';
import pg from 'pg';
import crypto from 'crypto';

// Create a separate pool for new-platform database (for teams table access)
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

const normalizeString = (value, maxLen = null) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  if (Number.isFinite(maxLen) && maxLen > 0) {
    return stringValue.slice(0, maxLen);
  }
  return stringValue;
};

const resolveTeamLinkedInSocialAccountId = (row = {}) => {
  const accountType = normalizeString(row.account_type, 50);
  const organizationId = normalizeString(row.organization_id, 255);
  if (accountType === 'organization' && organizationId) {
    return `org:${organizationId}`;
  }
  return normalizeString(row.linkedin_user_id, 255);
};

async function upsertTeamLinkedInSocialAccount({
  userId,
  teamId,
  accountId,
  accountUsername = null,
  accountDisplayName = null,
  accessToken = null,
  refreshToken = null,
  tokenExpiresAt = null,
  profileImageUrl = null,
  followersCount = 0,
  metadata = {},
}) {
  const normalizedUserId = normalizeString(userId, 128);
  const normalizedTeamId = normalizeString(teamId, 128);
  const normalizedAccountId = normalizeString(accountId, 255);
  if (!normalizedUserId || !normalizedTeamId || !normalizedAccountId) {
    return;
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT id
       FROM social_connected_accounts
       WHERE team_id::text = $1::text
         AND platform = 'linkedin'
         AND account_id = $2
       LIMIT 1`,
      [normalizedTeamId, normalizedAccountId]
    );

    if (existing[0]?.id) {
      await pool.query(
        `UPDATE social_connected_accounts
         SET user_id = $1,
             account_username = $2,
             account_display_name = $3,
             access_token = COALESCE($4, access_token),
             refresh_token = COALESCE($5, refresh_token),
             token_expires_at = COALESCE($6, token_expires_at),
             profile_image_url = $7,
             followers_count = $8,
             metadata = $9::jsonb,
             connected_by = $10,
             is_active = true,
             updated_at = NOW()
         WHERE id = $11`,
        [
          normalizedUserId,
          normalizeString(accountUsername, 255),
          normalizeString(accountDisplayName, 255),
          normalizeString(accessToken),
          normalizeString(refreshToken),
          tokenExpiresAt || null,
          normalizeString(profileImageUrl, 2048),
          Number.isFinite(Number(followersCount)) ? Number(followersCount) : 0,
          JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
          normalizedUserId,
          existing[0].id,
        ]
      );
      return;
    }

    await pool.query(
      `INSERT INTO social_connected_accounts (
        id, user_id, team_id, platform, account_id, account_username, account_display_name,
        access_token, refresh_token, token_expires_at, profile_image_url, followers_count,
        metadata, connected_by, is_active
      ) VALUES (
        $1, $2, $3, 'linkedin', $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12::jsonb, $13, true
      )`,
      [
        crypto.randomUUID(),
        normalizedUserId,
        normalizedTeamId,
        normalizedAccountId,
        normalizeString(accountUsername, 255),
        normalizeString(accountDisplayName, 255),
        normalizeString(accessToken),
        normalizeString(refreshToken),
        tokenExpiresAt || null,
        normalizeString(profileImageUrl, 2048),
        Number.isFinite(Number(followersCount)) ? Number(followersCount) : 0,
        JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
        normalizedUserId,
      ]
    );
  } catch (error) {
    console.warn('[teamController] Failed to mirror team LinkedIn account into social_connected_accounts:', error?.message || error);
  }
}

// Get all LinkedIn accounts for user (personal + team accounts they have access to)
export async function getAccounts(req, res) {
  try {
    // Support both authenticated requests (req.user) and inter-service requests (user_id param)
    const userId = req.user?.id || req.query.user_id || req.headers['x-user-id'];
    
    if (!userId) {
      console.error('[getAccounts] No userId available');
      return res.status(401).json({ error: 'User ID required', accounts: [] });
    }
    
    console.log('[getAccounts] Fetching accounts for user:', userId);

    // Check if user is in any active team
    const { rows: userTeams } = await newPlatformPool.query(
      `SELECT team_id, role, status FROM team_members WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    // If user is in a team, ONLY return team accounts (no personal account access)
    if (userTeams.length > 0) {
      console.log('[getAccounts] User is in team, returning ONLY team accounts');
      
      // Get all team LinkedIn accounts for teams the user belongs to
      const { rows: allTeamAccounts } = await pool.query(
        `SELECT 
          lta.id,
          lta.team_id,
          lta.user_id,
          lta.linkedin_user_id,
          lta.linkedin_username,
          lta.linkedin_display_name,
          lta.linkedin_profile_image_url,
          lta.connections_count,
          lta.headline,
          lta.active
         FROM linkedin_team_accounts lta
         WHERE lta.active = true
         ORDER BY lta.created_at DESC`
      );

      // Filter team accounts to only those in user's teams and enrich with team info
      const teamAccounts = await Promise.all(
        allTeamAccounts
          .filter(acc => userTeams.some(tm => tm.team_id === acc.team_id))
          .map(async (acc) => {
            const teamMember = userTeams.find(tm => tm.team_id === acc.team_id);
            // Try to get team name from new-platform database
            let teamName = 'Unknown Team';
            try {
              const { rows: teamRows } = await newPlatformPool.query(
                `SELECT name FROM teams WHERE id = $1`,
                [acc.team_id]
              );
              if (teamRows.length > 0) {
                teamName = teamRows[0].name;
              }
            } catch (err) {
              console.warn('[getAccounts] Could not fetch team name for:', acc.team_id);
            }
            
            return {
              account_type: 'team',
              account_id: acc.id,
              team_id: acc.team_id,
              team_name: teamName,
              id: acc.id,
              linkedin_user_id: acc.linkedin_user_id,
              linkedin_username: acc.linkedin_username,
              linkedin_display_name: acc.linkedin_display_name,
              linkedin_profile_image_url: acc.linkedin_profile_image_url,
              connections_count: acc.connections_count,
              headline: acc.headline,
              user_role: teamMember?.role,
              label: `${acc.linkedin_display_name || acc.linkedin_username} (Team: ${teamName})`,
              isTeamAccount: true
            };
          })
      );

      return res.json({ accounts: teamAccounts });
    }

    // User is NOT in a team - return personal account only
    console.log('[getAccounts] User is not in team, returning personal account');
    const { rows: personalAccounts } = await pool.query(
      `SELECT 
        COALESCE(account_type, 'personal') as account_type,
        organization_id,
        organization_name,
        organization_vanity_name,
        NULL as account_id,
        NULL as team_id,
        NULL as team_name,
        id,
        linkedin_user_id,
        linkedin_username,
        linkedin_display_name,
        linkedin_profile_image_url,
        connections_count,
        headline
       FROM linkedin_auth 
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );

    const accounts = personalAccounts.map(acc => {
      const isOrganization = acc.account_type === 'organization' && acc.organization_id;
      const effectiveAccountId = isOrganization ? `org:${acc.organization_id}` : null;
      const effectiveUsername = isOrganization ? `org-${acc.organization_id}` : acc.linkedin_username;
      const effectiveDisplayName = isOrganization
        ? (acc.organization_name || acc.linkedin_display_name || acc.linkedin_username)
        : (acc.linkedin_display_name || acc.linkedin_username);

      return {
        ...acc,
        account_id: effectiveAccountId,
        linkedin_username: effectiveUsername,
        linkedin_display_name: effectiveDisplayName,
        label: `${effectiveDisplayName || 'LinkedIn'} (${isOrganization ? 'Organization Page' : 'Personal'})`,
        isTeamAccount: false,
      };
    });

    res.json({ accounts });
  } catch (error) {
    console.error('[getAccounts] ❌ Error fetching LinkedIn accounts:', error);
    console.error('[getAccounts] Stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch LinkedIn accounts' });
  }
}

// Connect a LinkedIn account to a team
export async function connectTeamAccount(req, res) {
  try {
    const userId = req.user.id;
    const { teamId } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Verify user is owner or admin of this team
    const { rows: memberRows } = await newPlatformPool.query(
      `SELECT role
       FROM team_members
       WHERE team_id = $1
         AND user_id = $2
         AND status = 'active'`,
      [teamId, userId]
    );

    if (!memberRows.length) {
      return res.status(403).json({ error: 'You are not a member of this team' });
    }

    const userRole = memberRows[0].role;
    if (userRole !== 'owner' && userRole !== 'admin') {
      return res.status(403).json({ error: 'Only team owners and admins can connect LinkedIn accounts' });
    }

    // Get user's personal LinkedIn account
    const { rows: authRows } = await pool.query(
      `SELECT *
       FROM linkedin_auth
       WHERE user_id = $1
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [userId]
    );

    if (!authRows.length) {
      return res.status(400).json({ error: 'No LinkedIn account connected. Please connect your LinkedIn account first.' });
    }

    const linkedinAuth = authRows[0];

    // Upsert into linkedin_team_accounts so stale inactive rows do not block reconnect.
    const { rows: insertedRows } = await pool.query(
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
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        linkedin_profile_image_url = EXCLUDED.linkedin_profile_image_url,
        connections_count = EXCLUDED.connections_count,
        headline = EXCLUDED.headline,
        active = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        teamId,
        userId,
        linkedinAuth.linkedin_user_id,
        linkedinAuth.linkedin_username,
        linkedinAuth.linkedin_display_name,
        linkedinAuth.access_token,
        linkedinAuth.refresh_token,
        linkedinAuth.token_expires_at,
        linkedinAuth.linkedin_profile_image_url,
        linkedinAuth.connections_count,
        linkedinAuth.headline
      ]
    );

    await upsertTeamLinkedInSocialAccount({
      userId,
      teamId,
      accountId: linkedinAuth.linkedin_user_id,
      accountUsername: linkedinAuth.linkedin_username,
      accountDisplayName: linkedinAuth.linkedin_display_name || linkedinAuth.linkedin_username,
      accessToken: linkedinAuth.access_token,
      refreshToken: linkedinAuth.refresh_token,
      tokenExpiresAt: linkedinAuth.token_expires_at,
      profileImageUrl: linkedinAuth.linkedin_profile_image_url,
      followersCount: linkedinAuth.connections_count || 0,
      metadata: {
        source_table: 'linkedin_team_accounts',
        account_type: 'personal',
        legacy_team_account_id: insertedRows[0]?.id || null,
        linkedin_user_id: linkedinAuth.linkedin_user_id || null,
      },
    });

    res.json({ 
      success: true,
      message: 'LinkedIn account connected to team',
      account: insertedRows[0]
    });
  } catch (error) {
    console.error('Error connecting team LinkedIn account:', error);
    res.status(500).json({ error: 'Failed to connect team LinkedIn account' });
  }
}

// Disconnect a LinkedIn account from a team
export async function disconnectTeamAccount(req, res) {
  try {
    const userId = req.user.id;
    const { accountId } = req.params;

    // Verify user is owner or admin of the team this account belongs to
    const { rows: accountRows } = await pool.query(
      `SELECT *
       FROM linkedin_team_accounts
       WHERE id = $1`,
      [accountId]
    );

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Team LinkedIn account not found or access denied' });
    }

    const account = accountRows[0];
    const { rows: membershipRows } = await newPlatformPool.query(
      `SELECT role
       FROM team_members
       WHERE team_id = $1
         AND user_id = $2
         AND status = 'active'`,
      [account.team_id, userId]
    );

    if (!membershipRows.length) {
      return res.status(404).json({ error: 'Team LinkedIn account not found or access denied' });
    }

    const membershipRole = membershipRows[0].role;
    if (membershipRole !== 'owner' && membershipRole !== 'admin') {
      return res.status(403).json({ error: 'Only team owners and admins can disconnect LinkedIn accounts' });
    }

    // Delete the team account
    await pool.query(
      `DELETE FROM linkedin_team_accounts WHERE id = $1`,
      [accountId]
    );

    const socialAccountId = resolveTeamLinkedInSocialAccountId(account);
    if (socialAccountId) {
      await pool.query(
        `UPDATE social_connected_accounts
         SET is_active = false,
             updated_at = NOW()
         WHERE team_id::text = $1::text
           AND platform = 'linkedin'
           AND account_id = $2
           AND is_active = true`,
        [String(account.team_id), socialAccountId]
      );
    }

    res.json({ success: true, message: 'LinkedIn account disconnected from team' });
  } catch (error) {
    console.error('Error disconnecting team LinkedIn account:', error);
    res.status(500).json({ error: 'Failed to disconnect team LinkedIn account' });
  }
}

// Set the active/selected LinkedIn account for the user's session
export async function selectAccount(req, res) {
  try {
    const { accountId, teamId } = req.body;

    // Store in session (if using sessions) or just return success
    // The frontend will store this in context and send in headers
    res.json({ 
      success: true, 
      message: 'Account selected',
      accountId,
      teamId
    });
  } catch (error) {
    console.error('Error selecting account:', error);
    res.status(500).json({ error: 'Failed to select account' });
  }
}

// Get teams the user belongs to
export async function getTeams(req, res) {
  try {
    const userId = req.user.id;

    // Query teams from new-platform database
    const { rows: teams } = await newPlatformPool.query(
      `SELECT 
        t.id,
        t.name,
        t.owner_id,
        tm.role,
        tm.joined_at
       FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1
       ORDER BY t.name`,
      [userId]
    );

    res.json({ teams });
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
}

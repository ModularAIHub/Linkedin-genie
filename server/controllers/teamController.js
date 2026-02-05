import { pool } from '../config/database.js';
import pg from 'pg';

// Create a separate pool for new-platform database (for teams table access)
const { Pool } = pg;
const newPlatformPool = new Pool({
  connectionString: process.env.NEW_PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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
        'personal' as account_type,
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
       WHERE user_id = $1`,
      [userId]
    );

    const accounts = personalAccounts.map(acc => ({
      ...acc,
      label: `${acc.linkedin_display_name || acc.linkedin_username} (Personal)`,
      isTeamAccount: false
    }));

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
    const { rows: memberRows } = await pool.query(
      `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
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
      `SELECT * FROM linkedin_auth WHERE user_id = $1`,
      [userId]
    );

    if (!authRows.length) {
      return res.status(400).json({ error: 'No LinkedIn account connected. Please connect your LinkedIn account first.' });
    }

    const linkedinAuth = authRows[0];

    // Check if this LinkedIn account is already connected to this team
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM linkedin_team_accounts WHERE team_id = $1 AND linkedin_user_id = $2`,
      [teamId, linkedinAuth.linkedin_user_id]
    );

    if (existingRows.length > 0) {
      return res.status(400).json({ error: 'This LinkedIn account is already connected to this team' });
    }

    // Insert into linkedin_team_accounts
    const { rows: insertedRows } = await pool.query(
      `INSERT INTO linkedin_team_accounts (
        team_id, user_id, linkedin_user_id, linkedin_username, linkedin_display_name,
        access_token, refresh_token, token_expires_at, linkedin_profile_image_url,
        connections_count, headline, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
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
      `SELECT lta.*, tm.role 
       FROM linkedin_team_accounts lta
       JOIN team_members tm ON tm.team_id = lta.team_id AND tm.user_id = $1
       WHERE lta.id = $2`,
      [userId, accountId]
    );

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Team LinkedIn account not found or access denied' });
    }

    const account = accountRows[0];
    if (account.role !== 'owner' && account.role !== 'admin') {
      return res.status(403).json({ error: 'Only team owners and admins can disconnect LinkedIn accounts' });
    }

    // Delete the team account
    await pool.query(
      `DELETE FROM linkedin_team_accounts WHERE id = $1`,
      [accountId]
    );

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

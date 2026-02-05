import { pool } from '../config/database.js';
import axios from 'axios';

/**
 * Middleware to validate LinkedIn connection and handle team vs personal accounts
 * Similar to tweet-genie's validateTwitterConnection
 */
export const validateLinkedInConnection = async (req, res, next) => {
  try {
    let linkedinAuthData;
    let isTeamAccount = false;
    
    // Check for selected team account first (from header)
    const selectedAccountId = req.headers['x-selected-account-id'];
    const selectedTeamId = req.headers['x-selected-team-id'];
    const userId = req.user?.id || req.user?.userId;

    console.log('[validateLinkedInConnection]', {
      selectedAccountId,
      selectedTeamId,
      userId,
      hasUser: !!req.user
    });
    
    // Only try team account lookup if user has selected a team account ID
    if (selectedAccountId && selectedTeamId) {
      try {
        // Try to get team account credentials
        const { rows } = await pool.query(
          `SELECT lta.* 
           FROM linkedin_team_accounts lta
           JOIN team_members tm ON tm.team_id = lta.team_id
           WHERE lta.id = $1 
             AND lta.team_id = $2 
             AND lta.active = true
             AND tm.user_id = $3`,
          [selectedAccountId, selectedTeamId, userId]
        );
        
        if (rows.length > 0) {
          linkedinAuthData = rows[0];
          isTeamAccount = true;
          console.log('[validateLinkedInConnection] Using team LinkedIn account:', {
            accountId: linkedinAuthData.id,
            teamId: linkedinAuthData.team_id,
            username: linkedinAuthData.linkedin_username
          });
        }
      } catch (teamQueryErr) {
        // If team account query fails, log and fall back to personal account
        console.error('[validateLinkedInConnection] Team account query failed:', teamQueryErr.message);
      }
    }
    
    // Fall back to personal linkedin_auth if no team account
    if (!linkedinAuthData) {
      const { rows } = await pool.query(
        'SELECT * FROM linkedin_auth WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'LinkedIn account not connected. Please connect your LinkedIn account first.' });
      }

      linkedinAuthData = rows[0];
      console.log('[validateLinkedInConnection] Using personal LinkedIn account:', {
        userId: linkedinAuthData.user_id,
        username: linkedinAuthData.linkedin_username
      });
    }
    
    // Check if token is expired or expiring soon (refresh 10 minutes before expiry)
    const now = new Date();
    const tokenExpiry = linkedinAuthData.token_expires_at ? new Date(linkedinAuthData.token_expires_at) : null;
    
    if (tokenExpiry) {
      const refreshThreshold = new Date(tokenExpiry.getTime() - (10 * 60 * 1000)); // 10 minutes before expiry
      const minutesUntilExpiry = Math.floor((tokenExpiry - now) / (60 * 1000));
      
      console.log('[LinkedIn Token Status]', {
        accountType: isTeamAccount ? 'team' : 'personal',
        expiresAt: tokenExpiry.toISOString(),
        minutesUntilExpiry,
        isExpired: tokenExpiry <= now,
        needsRefresh: now >= refreshThreshold
      });
      
      if (tokenExpiry <= now || now >= refreshThreshold) {
        const isExpired = tokenExpiry <= now;
        console.log(`[LinkedIn Token] ${isExpired ? '⚠️ Token EXPIRED' : '⏰ Token expiring soon, attempting refresh...'} (${minutesUntilExpiry} minutes until expiry)`);
        
        // Attempt to refresh the LinkedIn token
        try {
          const refreshResponse = await axios.post(
            'https://www.linkedin.com/oauth/v2/accessToken',
            new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: linkedinAuthData.refresh_token,
              client_id: process.env.LINKEDIN_CLIENT_ID,
              client_secret: process.env.LINKEDIN_CLIENT_SECRET
            }),
            {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
          );

          const { access_token, refresh_token, expires_in } = refreshResponse.data;
          const newTokenExpiry = new Date(Date.now() + expires_in * 1000);

          console.log('[LinkedIn Token] ✅ Refresh successful, new expiry:', newTokenExpiry.toISOString());

          // Update token in appropriate table
          const updateTable = isTeamAccount ? 'linkedin_team_accounts' : 'linkedin_auth';
          const updateCondition = isTeamAccount ? 'id = $1' : 'user_id = $1';
          const updateValue = isTeamAccount ? linkedinAuthData.id : userId;
          
          await pool.query(
            `UPDATE ${updateTable} 
             SET access_token = $2,
                 refresh_token = $3,
                 token_expires_at = $4,
                 updated_at = NOW()
             WHERE ${updateCondition}`,
            [updateValue, access_token, refresh_token || linkedinAuthData.refresh_token, newTokenExpiry]
          );

          // Update the auth data with new token
          linkedinAuthData.access_token = access_token;
          linkedinAuthData.token_expires_at = newTokenExpiry;
          
        } catch (refreshError) {
          console.error('[LinkedIn Token] ❌ Refresh failed:', refreshError.response?.data || refreshError.message);
          return res.status(401).json({ 
            error: 'LinkedIn token expired and refresh failed. Please reconnect your LinkedIn account.',
            code: 'LINKEDIN_TOKEN_REFRESH_FAILED'
          });
        }
      }
    } else {
      console.log('[LinkedIn Token] No expiry date found, assuming token is valid');
    }
    
    // Attach LinkedIn credentials to request
    req.linkedinAccount = {
      accessToken: linkedinAuthData.access_token,
      userUrn: `urn:li:person:${linkedinAuthData.linkedin_user_id}`,
      linkedinUserId: linkedinAuthData.linkedin_user_id,
      username: linkedinAuthData.linkedin_username,
      displayName: linkedinAuthData.linkedin_display_name,
      isTeamAccount,
      accountId: isTeamAccount ? linkedinAuthData.id : null,
      teamId: isTeamAccount ? linkedinAuthData.team_id : null
    };

    console.log('[validateLinkedInConnection] ✅ LinkedIn connection validated', {
      isTeamAccount,
      username: req.linkedinAccount.username,
      accountId: req.linkedinAccount.accountId
    });

    next();
  } catch (error) {
    console.error('[validateLinkedInConnection] Error:', error);
    return res.status(500).json({ error: 'Failed to validate LinkedIn connection' });
  }
};

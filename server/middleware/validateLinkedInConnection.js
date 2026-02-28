import { pool } from '../config/database.js';
import axios from 'axios';

/**
 * Middleware to validate LinkedIn connection and handle team vs personal accounts
 * Social-first with legacy fallback.
 */
export const validateLinkedInConnection = async (req, res, next) => {
  try {
    let linkedinAuthData;
    let isTeamAccount = false;

    // Check for selected team account first (from header)
    const selectedAccountId = req.headers['x-selected-account-id'];
    const selectedTeamId = req.headers['x-selected-team-id'];
    const userId = req.user?.id || req.user?.userId;

    const normalizeOptionalString = (value, maxLength = 255) => {
      if (value === null || value === undefined) return null;
      const normalized = String(value).trim();
      if (!normalized) return null;
      return normalized.slice(0, maxLength);
    };

    const parsePositiveInt = (value) => {
      const normalized = String(value ?? '').trim();
      if (!/^\d+$/.test(normalized)) return null;
      const parsed = Number.parseInt(normalized, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    };

    const getSocialMetadata = (row = {}) =>
      row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

    const getSocialLinkedinUserId = (row = {}) => {
      const metadata = getSocialMetadata(row);
      const fromMetadata = normalizeOptionalString(metadata?.linkedin_user_id, 255);
      if (fromMetadata) return fromMetadata;
      const accountId = normalizeOptionalString(row?.account_id, 255);
      if (!accountId || accountId.startsWith('org:')) return null;
      return accountId;
    };

    const toSocialAccountShape = (row = {}) => {
      const metadata = getSocialMetadata(row);
      return {
        source: 'social',
        id: String(row.id),
        user_id: normalizeOptionalString(row.user_id, 128),
        team_id: normalizeOptionalString(row.team_id, 128),
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        token_expires_at: row.token_expires_at,
        linkedin_user_id: getSocialLinkedinUserId(row),
        linkedin_username: normalizeOptionalString(row.account_username, 255),
        linkedin_display_name: normalizeOptionalString(row.account_display_name, 255),
        source_table: normalizeOptionalString(metadata?.source_table, 80),
        legacy_team_account_id:
          parsePositiveInt(metadata?.legacy_team_account_id) ||
          parsePositiveInt(metadata?.legacy_row_id) ||
          null,
        legacy_personal_row_id:
          normalizeOptionalString(metadata?.legacy_personal_row_id, 128) ||
          normalizeOptionalString(metadata?.legacy_row_id, 128),
      };
    };

    const updateTokensOnSource = async ({ account, accessToken, refreshToken, tokenExpiresAt }) => {
      if (account?.source === 'social') {
        await pool.query(
          `UPDATE social_connected_accounts
           SET access_token = $1,
               refresh_token = $2,
               token_expires_at = $3,
               updated_at = NOW()
           WHERE id::text = $4::text`,
          [accessToken, refreshToken, tokenExpiresAt, String(account.id)]
        );

        if (account.source_table === 'linkedin_team_accounts' && account.legacy_team_account_id) {
          await pool.query(
            `UPDATE linkedin_team_accounts
             SET access_token = $1,
                 refresh_token = $2,
                 token_expires_at = $3,
                 updated_at = NOW()
             WHERE id = $4`,
            [accessToken, refreshToken, tokenExpiresAt, account.legacy_team_account_id]
          );
        } else if (account.source_table === 'linkedin_auth' && account.legacy_personal_row_id) {
          await pool.query(
            `UPDATE linkedin_auth
             SET access_token = $1,
                 refresh_token = $2,
                 token_expires_at = $3,
                 updated_at = NOW()
             WHERE id::text = $4::text`,
            [accessToken, refreshToken, tokenExpiresAt, account.legacy_personal_row_id]
          );
        } else if (!account.team_id && userId) {
          await pool.query(
            `UPDATE linkedin_auth
             SET access_token = $1,
                 refresh_token = $2,
                 token_expires_at = $3,
                 updated_at = NOW()
             WHERE user_id = $4`,
            [accessToken, refreshToken, tokenExpiresAt, userId]
          );
        }
        return;
      }

      const updateTable = account?.source === 'legacy_team' ? 'linkedin_team_accounts' : 'linkedin_auth';
      const updateCondition = account?.source === 'legacy_team' ? 'id = $1' : 'user_id = $1';
      const updateValue = account?.source === 'legacy_team' ? account.id : userId;

      await pool.query(
        `UPDATE ${updateTable}
         SET access_token = $2,
             refresh_token = $3,
             token_expires_at = $4,
             updated_at = NOW()
         WHERE ${updateCondition}`,
        [updateValue, accessToken, refreshToken, tokenExpiresAt]
      );
    };

    console.log('[validateLinkedInConnection]', {
      selectedAccountId,
      selectedTeamId,
      userId,
      hasUser: !!req.user
    });

    // Only try team account lookup if user has selected a team account ID
    if (selectedAccountId && selectedTeamId) {
      try {
        const { rows: socialRows } = await pool.query(
          `SELECT sca.*
           FROM social_connected_accounts sca
           JOIN team_members tm
             ON tm.team_id::text = sca.team_id::text
            AND tm.user_id = $3
            AND tm.status = 'active'
           WHERE sca.platform = 'linkedin'
             AND sca.is_active = true
             AND sca.team_id::text = $2::text
             AND (
               sca.id::text = $1::text
               OR sca.team_id::text = $1::text
               OR COALESCE(sca.metadata->>'legacy_team_account_id', '') = $1::text
               OR COALESCE(sca.metadata->>'legacy_row_id', '') = $1::text
             )
           ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC
           LIMIT 1`,
          [selectedAccountId, selectedTeamId, userId]
        );

        if (socialRows.length > 0) {
          linkedinAuthData = toSocialAccountShape(socialRows[0]);
          isTeamAccount = true;
          console.log('[validateLinkedInConnection] Using team LinkedIn account:', {
            accountId: linkedinAuthData.id,
            teamId: linkedinAuthData.team_id,
            username: linkedinAuthData.linkedin_username
          });
        } else {
          const legacyAccountId = parsePositiveInt(selectedAccountId);
          if (legacyAccountId) {
            const { rows } = await pool.query(
              `SELECT lta.*
               FROM linkedin_team_accounts lta
               JOIN team_members tm ON tm.team_id = lta.team_id
               WHERE lta.id = $1
                 AND lta.team_id = $2
                 AND lta.active = true
                 AND tm.user_id = $3
                 AND tm.status = 'active'
               LIMIT 1`,
              [legacyAccountId, selectedTeamId, userId]
            );

            if (rows.length > 0) {
              linkedinAuthData = {
                ...rows[0],
                source: 'legacy_team',
              };
              isTeamAccount = true;
            }
          }
        }
      } catch (teamQueryErr) {
        // If team account query fails, log and fall back to personal account
        console.error('[validateLinkedInConnection] Team account query failed:', teamQueryErr.message);
      }
    }

    // Fall back to personal social account and then legacy linkedin_auth
    if (!linkedinAuthData) {
      const { rows: socialRows } = await pool.query(
        `SELECT *
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
        linkedinAuthData = toSocialAccountShape(socialRows[0]);
      }
    }

    if (!linkedinAuthData) {
      const { rows } = await pool.query(
        'SELECT * FROM linkedin_auth WHERE user_id = $1',
        [userId]
      );

      if (rows.length === 0) {
        return res.status(400).json({ error: 'LinkedIn account not connected. Please connect your LinkedIn account first.' });
      }

      linkedinAuthData = {
        ...rows[0],
        source: 'legacy_personal',
      };
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
        console.log(`[LinkedIn Token] ${isExpired ? 'Token expired' : 'Token expiring soon, attempting refresh'} (${minutesUntilExpiry} minutes until expiry)`);

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

          console.log('[LinkedIn Token] Refresh successful, new expiry:', newTokenExpiry.toISOString());

          await updateTokensOnSource({
            account: linkedinAuthData,
            accessToken: access_token,
            refreshToken: refresh_token || linkedinAuthData.refresh_token,
            tokenExpiresAt: newTokenExpiry,
          });

          // Update the auth data with new token
          linkedinAuthData.access_token = access_token;
          linkedinAuthData.token_expires_at = newTokenExpiry;

        } catch (refreshError) {
          console.error('[LinkedIn Token] Refresh failed:', refreshError.response?.data || refreshError.message);
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
      accountId: isTeamAccount ? (linkedinAuthData.legacy_team_account_id || linkedinAuthData.id) : null,
      teamId: isTeamAccount ? linkedinAuthData.team_id : null
    };

    console.log('[validateLinkedInConnection] LinkedIn connection validated', {
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

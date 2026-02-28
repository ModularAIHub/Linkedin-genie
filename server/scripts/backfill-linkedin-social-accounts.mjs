import crypto from 'crypto';
import { pool } from '../config/database.js';

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const runCleanupPersonalInTeam = args.has('--cleanup-personal-in-team');

const normalizeString = (value, maxLen = null) => {
  if (value === undefined || value === null) return null;
  const stringValue = String(value).trim();
  if (!stringValue) return null;
  if (Number.isFinite(maxLen) && maxLen > 0) {
    return stringValue.slice(0, maxLen);
  }
  return stringValue;
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const resolveTeamAccountSocialId = (row = {}) => {
  const accountType = normalizeString(row.account_type, 50);
  const organizationId = normalizeString(row.organization_id, 255);
  if (accountType === 'organization' && organizationId) {
    return `org:${organizationId}`;
  }
  return normalizeString(row.linkedin_user_id, 255);
};

const sourceMetadata = (sourceTable, row = {}) => ({
  source_table: sourceTable,
  legacy_row_id: row.id ?? null,
  account_type: row.account_type || (sourceTable === 'linkedin_auth' ? 'personal' : null),
  organization_id: row.organization_id || null,
  organization_name: row.organization_name || null,
  linkedin_user_id: row.linkedin_user_id || null,
});

async function ensureSocialTableExists() {
  const { rows } = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'social_connected_accounts'
     LIMIT 1`
  );
  if (!rows.length) {
    throw new Error('Table social_connected_accounts does not exist in this database.');
  }
}

async function findExistingSocialRow({ userId, teamId, accountId }) {
  if (teamId) {
    const { rows } = await pool.query(
      `SELECT id
       FROM social_connected_accounts
       WHERE team_id::text = $1::text
         AND platform = 'linkedin'
         AND account_id = $2
       LIMIT 1`,
      [teamId, accountId]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `SELECT id
     FROM social_connected_accounts
     WHERE user_id = $1
       AND team_id IS NULL
       AND platform = 'linkedin'
       AND account_id = $2
     LIMIT 1`,
    [userId, accountId]
  );
  return rows[0] || null;
}

async function upsertSocialConnectedAccount({
  userId,
  teamId = null,
  accountId,
  accountUsername = null,
  accountDisplayName = null,
  accessToken = null,
  refreshToken = null,
  tokenExpiresAt = null,
  profileImageUrl = null,
  followersCount = 0,
  metadata = {},
  connectedBy = null,
  isActive = true,
}) {
  const existing = await findExistingSocialRow({ userId, teamId, accountId });

  if (!applyChanges) {
    return existing ? 'would_update' : 'would_insert';
  }

  if (existing?.id) {
    await pool.query(
      `UPDATE social_connected_accounts
       SET user_id = $1,
           team_id = $2,
           account_username = $3,
           account_display_name = $4,
           access_token = $5,
           refresh_token = $6,
           token_expires_at = $7,
           profile_image_url = $8,
           followers_count = $9,
           metadata = $10::jsonb,
           connected_by = $11,
           is_active = $12,
           updated_at = NOW()
       WHERE id = $13`,
      [
        userId,
        teamId,
        accountUsername,
        accountDisplayName,
        accessToken,
        refreshToken,
        tokenExpiresAt,
        profileImageUrl,
        followersCount,
        JSON.stringify(metadata),
        connectedBy || userId,
        isActive,
        existing.id,
      ]
    );
    return 'updated';
  }

  await pool.query(
    `INSERT INTO social_connected_accounts (
      id, user_id, team_id, platform, account_id, account_username, account_display_name,
      access_token, refresh_token, token_expires_at, profile_image_url, followers_count,
      metadata, connected_by, is_active
    ) VALUES (
      $1, $2, $3, 'linkedin', $4, $5, $6,
      $7, $8, $9, $10, $11,
      $12::jsonb, $13, $14
    )`,
    [
      crypto.randomUUID(),
      userId,
      teamId,
      accountId,
      accountUsername,
      accountDisplayName,
      accessToken,
      refreshToken,
      tokenExpiresAt,
      profileImageUrl,
      followersCount,
      JSON.stringify(metadata),
      connectedBy || userId,
      isActive,
    ]
  );
  return 'inserted';
}

async function backfillPersonalAccounts(stats) {
  const { rows } = await pool.query('SELECT * FROM linkedin_auth ORDER BY updated_at DESC NULLS LAST, id DESC');
  stats.personalScanned = rows.length;

  for (const row of rows) {
    const userId = normalizeString(row.user_id, 128);
    const accountId = normalizeString(row.linkedin_user_id, 255)
      || normalizeString(row.linkedin_username, 255)
      || (userId ? `${userId}_linkedin` : null);

    if (!userId || !accountId) {
      stats.personalSkipped += 1;
      continue;
    }

    const result = await upsertSocialConnectedAccount({
      userId,
      teamId: null,
      accountId,
      accountUsername: normalizeString(row.linkedin_username, 255),
      accountDisplayName: normalizeString(row.linkedin_display_name, 255) || normalizeString(row.linkedin_username, 255),
      accessToken: normalizeString(row.access_token),
      refreshToken: normalizeString(row.refresh_token),
      tokenExpiresAt: toDateOrNull(row.token_expires_at),
      profileImageUrl: normalizeString(row.linkedin_profile_image_url, 2048),
      followersCount: Number.isFinite(Number(row.connections_count)) ? Number(row.connections_count) : 0,
      metadata: sourceMetadata('linkedin_auth', row),
      connectedBy: userId,
      isActive: true,
    });

    if (result === 'inserted') stats.personalInserted += 1;
    else if (result === 'updated') stats.personalUpdated += 1;
    else if (result === 'would_insert') stats.personalWouldInsert += 1;
    else if (result === 'would_update') stats.personalWouldUpdate += 1;
  }
}

async function backfillTeamAccounts(stats) {
  const { rows } = await pool.query('SELECT * FROM linkedin_team_accounts ORDER BY updated_at DESC NULLS LAST, id DESC');
  stats.teamScanned = rows.length;

  for (const row of rows) {
    const userId = normalizeString(row.user_id, 128);
    const teamId = normalizeString(row.team_id, 128);
    const accountId = resolveTeamAccountSocialId(row)
      || normalizeString(row.linkedin_username, 255)
      || (row.organization_id ? `org:${row.organization_id}` : null);

    if (!userId || !teamId || !accountId) {
      stats.teamSkipped += 1;
      continue;
    }

    const accountType = normalizeString(row.account_type, 50);
    const orgId = normalizeString(row.organization_id, 255);
    const isOrg = accountType === 'organization' || Boolean(orgId);

    const result = await upsertSocialConnectedAccount({
      userId,
      teamId,
      accountId,
      accountUsername: isOrg
        ? (orgId ? `org-${orgId}` : null)
        : normalizeString(row.linkedin_username, 255),
      accountDisplayName: isOrg
        ? normalizeString(row.organization_name, 255) || normalizeString(row.linkedin_display_name, 255)
        : normalizeString(row.linkedin_display_name, 255) || normalizeString(row.linkedin_username, 255),
      accessToken: normalizeString(row.access_token),
      refreshToken: normalizeString(row.refresh_token),
      tokenExpiresAt: toDateOrNull(row.token_expires_at),
      profileImageUrl: normalizeString(row.linkedin_profile_image_url, 2048),
      followersCount: Number.isFinite(Number(row.connections_count)) ? Number(row.connections_count) : 0,
      metadata: sourceMetadata('linkedin_team_accounts', row),
      connectedBy: userId,
      isActive: row.active !== false,
    });

    if (result === 'inserted') stats.teamInserted += 1;
    else if (result === 'updated') stats.teamUpdated += 1;
    else if (result === 'would_insert') stats.teamWouldInsert += 1;
    else if (result === 'would_update') stats.teamWouldUpdate += 1;
  }
}

async function cleanupPersonalAccountsForTeamMembers(stats) {
  const { rows } = await pool.query(
    `SELECT DISTINCT la.user_id
     FROM linkedin_auth la
     INNER JOIN team_members tm
       ON tm.user_id = la.user_id
      AND tm.status = 'active'`
  );

  stats.cleanupCandidates = rows.length;
  if (!rows.length) return;

  if (!applyChanges) {
    stats.cleanupWouldDeactivate = rows.length;
    return;
  }

  const userIds = rows
    .map((row) => normalizeString(row.user_id, 128))
    .filter(Boolean);
  if (!userIds.length) return;

  const result = await pool.query(
    `UPDATE social_connected_accounts
     SET is_active = false,
         updated_at = NOW()
     WHERE user_id = ANY($1::uuid[])
       AND team_id IS NULL
       AND platform = 'linkedin'
       AND is_active = true`,
    [userIds]
  );
  stats.cleanupDeactivated = Number(result.rowCount || 0);
}

async function main() {
  const startedAt = Date.now();
  const stats = {
    personalScanned: 0,
    personalSkipped: 0,
    personalInserted: 0,
    personalUpdated: 0,
    personalWouldInsert: 0,
    personalWouldUpdate: 0,
    teamScanned: 0,
    teamSkipped: 0,
    teamInserted: 0,
    teamUpdated: 0,
    teamWouldInsert: 0,
    teamWouldUpdate: 0,
    cleanupCandidates: 0,
    cleanupWouldDeactivate: 0,
    cleanupDeactivated: 0,
  };

  try {
    await ensureSocialTableExists();
    await backfillPersonalAccounts(stats);
    await backfillTeamAccounts(stats);

    if (runCleanupPersonalInTeam) {
      await cleanupPersonalAccountsForTeamMembers(stats);
    }

    const durationMs = Date.now() - startedAt;
    console.log('[linkedin-social-backfill] completed', {
      mode: applyChanges ? 'apply' : 'dry-run',
      cleanupPersonalInTeam: runCleanupPersonalInTeam,
      durationMs,
      stats,
    });
  } catch (error) {
    console.error('[linkedin-social-backfill] failed:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();

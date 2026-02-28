import { pool } from '../config/database.js';

export const isMeaningfulAccountId = (value) =>
  value !== undefined &&
  value !== null &&
  String(value) !== '' &&
  String(value) !== 'null' &&
  String(value) !== 'undefined';

const normalizeTeamHints = (hints = []) =>
  Array.from(
    new Set(
      hints
        .filter(isMeaningfulAccountId)
        .map((value) => String(value))
    )
  );

export function getUserTeamHints(user = {}) {
  return normalizeTeamHints([
    user?.team_id,
    user?.teamId,
    user?.current_team_id,
    user?.currentTeamId,
    user?.user?.team_id,
    user?.user?.teamId
  ]);
}

const roleAllowed = (role, allowedRoles) =>
  !Array.isArray(allowedRoles) || allowedRoles.length === 0 || allowedRoles.includes(role);

const parsePositiveInt = (value) => {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeOptionalString = (value, maxLength = 255) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const getSocialMetadata = (row = {}) =>
  row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

const getSocialLinkedInUserId = (row = {}) => {
  const metadata = getSocialMetadata(row);
  const fromMetadata = normalizeOptionalString(metadata?.linkedin_user_id, 255);
  if (fromMetadata) return fromMetadata;
  const accountId = normalizeOptionalString(row?.account_id, 255);
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

const getSocialLegacyTeamAccountId = (row = {}) => {
  const metadata = getSocialMetadata(row);
  return (
    parsePositiveInt(metadata?.legacy_team_account_id) ||
    parsePositiveInt(metadata?.legacy_row_id) ||
    null
  );
};

const mapSocialTeamAccountRow = (row = {}) => {
  const legacyTeamAccountId = getSocialLegacyTeamAccountId(row);
  return {
    id: legacyTeamAccountId || null,
    social_id: String(row.id),
    legacy_team_account_id: legacyTeamAccountId,
    team_id: row.team_id,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    token_expires_at: row.token_expires_at,
    linkedin_user_id: getSocialLinkedInUserId(row),
    linkedin_username: normalizeOptionalString(row.account_username, 255),
    linkedin_display_name: normalizeOptionalString(row.account_display_name, 255),
    linkedin_profile_image_url: normalizeOptionalString(row.profile_image_url, 2048),
    active: Boolean(row.is_active),
    member_role: row.member_role,
  };
};

async function resolveSocialTeamAccountForUser(userId, normalizedId, options = {}) {
  const { allowedRoles } = options;

  const { rows } = await pool.query(
    `SELECT sca.*, tm.role AS member_role
     FROM social_connected_accounts sca
     JOIN team_members tm
       ON tm.team_id::text = sca.team_id::text
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE sca.platform = 'linkedin'
       AND sca.team_id IS NOT NULL
       AND sca.is_active = true
       AND (
         sca.id::text = $2::text
         OR sca.team_id::text = $2::text
         OR COALESCE(sca.metadata->>'legacy_team_account_id', '') = $2::text
         OR COALESCE(sca.metadata->>'legacy_row_id', '') = $2::text
       )
     ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC
     LIMIT 1`,
    [userId, normalizedId]
  );

  const row = rows[0] || null;
  if (!row) return null;
  if (!roleAllowed(row.member_role, allowedRoles)) return null;
  return mapSocialTeamAccountRow(row);
}

async function resolveDefaultSocialTeamAccountForUser(userId, options = {}) {
  const { allowedRoles, preferredTeamIds = [] } = options;
  const normalizedTeamIds = normalizeTeamHints(preferredTeamIds);

  if (normalizedTeamIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT sca.*, tm.role AS member_role
       FROM social_connected_accounts sca
       JOIN team_members tm
         ON tm.team_id::text = sca.team_id::text
        AND tm.user_id = $1
        AND tm.status = 'active'
       WHERE sca.platform = 'linkedin'
         AND sca.team_id IS NOT NULL
         AND sca.is_active = true
         AND sca.team_id::text = ANY($2::text[])
       ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC
       LIMIT 1`,
      [userId, normalizedTeamIds]
    );
    const row = rows[0] || null;
    if (row && roleAllowed(row.member_role, allowedRoles)) {
      return mapSocialTeamAccountRow(row);
    }
  }

  const { rows } = await pool.query(
    `SELECT sca.*, tm.role AS member_role
     FROM social_connected_accounts sca
     JOIN team_members tm
       ON tm.team_id::text = sca.team_id::text
      AND tm.user_id = $1
      AND tm.status = 'active'
     WHERE sca.platform = 'linkedin'
       AND sca.team_id IS NOT NULL
       AND sca.is_active = true
     ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC
     LIMIT 1`,
    [userId]
  );
  const row = rows[0] || null;
  if (!row) return null;
  if (!roleAllowed(row.member_role, allowedRoles)) return null;
  return mapSocialTeamAccountRow(row);
}

export async function resolveTeamAccountForUser(userId, rawAccountId, options = {}) {
  if (!isMeaningfulAccountId(rawAccountId)) {
    return null;
  }

  const { allowedRoles } = options;
  const normalizedId = String(rawAccountId);
  const socialRow = await resolveSocialTeamAccountForUser(userId, normalizedId, options);
  if (socialRow) {
    return socialRow;
  }

  const isUUID = normalizedId.includes('-');

  if (isUUID) {
    const { rows } = await pool.query(
      `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id, tm.role AS member_role
       FROM linkedin_team_accounts lta
       JOIN team_members tm ON tm.team_id = lta.team_id
       WHERE lta.team_id::text = $1
         AND lta.active = true
         AND tm.user_id = $2
         AND tm.status = 'active'
       ORDER BY lta.updated_at DESC NULLS LAST, lta.id DESC
       LIMIT 1`,
      [normalizedId, userId]
    );
    const row = rows[0] || null;
    if (!row) return null;
    return roleAllowed(row.member_role, allowedRoles) ? row : null;
  }

  const { rows } = await pool.query(
    `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id, tm.role AS member_role
     FROM linkedin_team_accounts lta
     JOIN team_members tm ON tm.team_id = lta.team_id
     WHERE lta.id = $1::int
       AND lta.active = true
       AND tm.user_id = $2
       AND tm.status = 'active'
     LIMIT 1`,
    [normalizedId, userId]
  );
  const row = rows[0] || null;
  if (!row) return null;
  return roleAllowed(row.member_role, allowedRoles) ? row : null;
}

export async function resolveDefaultTeamAccountForUser(userId, options = {}) {
  const { allowedRoles, preferredTeamIds = [] } = options;
  const socialRow = await resolveDefaultSocialTeamAccountForUser(userId, options);
  if (socialRow) {
    return socialRow;
  }

  const normalizedTeamIds = normalizeTeamHints(preferredTeamIds);

  if (normalizedTeamIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id, tm.role AS member_role
       FROM linkedin_team_accounts lta
       JOIN team_members tm ON tm.team_id = lta.team_id
       WHERE lta.active = true
         AND tm.user_id = $1
         AND tm.status = 'active'
         AND lta.team_id::text = ANY($2::text[])
       ORDER BY lta.updated_at DESC NULLS LAST, lta.id DESC
       LIMIT 1`,
      [userId, normalizedTeamIds]
    );
    const row = rows[0] || null;
    if (row && roleAllowed(row.member_role, allowedRoles)) {
      return row;
    }
  }

  const { rows } = await pool.query(
    `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id, tm.role AS member_role
     FROM linkedin_team_accounts lta
     JOIN team_members tm ON tm.team_id = lta.team_id
     WHERE lta.active = true
       AND tm.user_id = $1
       AND tm.status = 'active'
     ORDER BY lta.updated_at DESC NULLS LAST, lta.id DESC
     LIMIT 1`,
    [userId]
  );
  const row = rows[0] || null;
  if (!row) return null;
  return roleAllowed(row.member_role, allowedRoles) ? row : null;
}

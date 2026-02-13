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

export async function resolveTeamAccountForUser(userId, rawAccountId, options = {}) {
  if (!isMeaningfulAccountId(rawAccountId)) {
    return null;
  }

  const { allowedRoles } = options;
  const normalizedId = String(rawAccountId);
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

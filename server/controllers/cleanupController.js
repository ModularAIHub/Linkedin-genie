// Handles cleanup of LinkedIn data when users/teams are deleted from the main platform.

import { pool } from '../config/database.js';

const tableExists = async (client, tableName) => {
  const { rows } = await client.query('SELECT to_regclass($1) AS table_name', [tableName]);
  return Boolean(rows[0]?.table_name);
};

const getExistingColumns = async (client, tableName, columnNames) => {
  if (!Array.isArray(columnNames) || columnNames.length === 0) {
    return new Set();
  }

  const { rows } = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = $1
       AND column_name = ANY($2::text[])`,
    [tableName, columnNames]
  );

  return new Set(rows.map((row) => row.column_name));
};

const deleteFromTable = async (client, tableName, whereSql, params, label, counts, countKey) => {
  if (!(await tableExists(client, tableName))) {
    counts[countKey] = 0;
    return 0;
  }

  const result = await client.query(`DELETE FROM ${tableName} ${whereSql}`, params);
  const deleted = result.rowCount || 0;
  counts[countKey] = deleted;
  console.log(`   Deleted ${deleted} ${label}`);
  return deleted;
};

const listLinkedInTeamAccountIds = async (client, whereSql, params) => {
  if (!(await tableExists(client, 'linkedin_team_accounts'))) {
    return [];
  }

  const result = await client.query(
    `SELECT id::text AS id
     FROM linkedin_team_accounts
     ${whereSql}`,
    params
  );

  return result.rows.map((row) => row.id).filter(Boolean);
};

const deleteLinkedInPostsForTeam = async (client, teamId, accountIds, counts, countKey) => {
  if (!(await tableExists(client, 'linkedin_posts'))) {
    counts[countKey] = 0;
    return 0;
  }

  const columns = await getExistingColumns(client, 'linkedin_posts', ['team_id', 'company_id', 'account_id']);
  const clauses = [];
  const params = [];

  if (columns.has('team_id')) {
    params.push(String(teamId));
    clauses.push(`team_id::text = $${params.length}::text`);
  }

  if (columns.has('company_id')) {
    params.push(String(teamId));
    clauses.push(`company_id::text = $${params.length}::text`);
  }

  if (columns.has('account_id') && Array.isArray(accountIds) && accountIds.length > 0) {
    params.push(accountIds);
    clauses.push(`account_id::text = ANY($${params.length}::text[])`);
  }

  if (clauses.length === 0) {
    counts[countKey] = 0;
    return 0;
  }

  return deleteFromTable(
    client,
    'linkedin_posts',
    `WHERE ${clauses.join(' OR ')}`,
    params,
    'LinkedIn posts',
    counts,
    countKey
  );
};

const deleteScheduledPostsForTeam = async (client, teamId, accountIds, counts, countKey) => {
  if (!(await tableExists(client, 'scheduled_linkedin_posts'))) {
    counts[countKey] = 0;
    return 0;
  }

  const columns = await getExistingColumns(client, 'scheduled_linkedin_posts', ['team_id', 'company_id', 'account_id']);
  const clauses = [];
  const params = [];

  if (columns.has('team_id')) {
    params.push(String(teamId));
    clauses.push(`team_id::text = $${params.length}::text`);
  }

  if (columns.has('company_id')) {
    params.push(String(teamId));
    clauses.push(`company_id::text = $${params.length}::text`);
  }

  if (columns.has('account_id') && Array.isArray(accountIds) && accountIds.length > 0) {
    params.push(accountIds);
    clauses.push(`account_id::text = ANY($${params.length}::text[])`);
  }

  if (clauses.length === 0) {
    counts[countKey] = 0;
    return 0;
  }

  return deleteFromTable(
    client,
    'scheduled_linkedin_posts',
    `WHERE ${clauses.join(' OR ')}`,
    params,
    'scheduled LinkedIn posts',
    counts,
    countKey
  );
};

const deleteLinkedInPostsForMember = async (client, teamId, userId, accountIds, counts, countKey) => {
  if (!(await tableExists(client, 'linkedin_posts'))) {
    counts[countKey] = 0;
    return 0;
  }

  const columns = await getExistingColumns(client, 'linkedin_posts', ['team_id', 'company_id', 'account_id']);
  const scopeClauses = [];
  const params = [userId];

  if (columns.has('team_id')) {
    params.push(String(teamId));
    scopeClauses.push(`team_id::text = $${params.length}::text`);
  }

  if (columns.has('company_id')) {
    params.push(String(teamId));
    scopeClauses.push(`company_id::text = $${params.length}::text`);
  }

  if (columns.has('account_id') && Array.isArray(accountIds) && accountIds.length > 0) {
    params.push(accountIds);
    scopeClauses.push(`account_id::text = ANY($${params.length}::text[])`);
  }

  const whereSql = scopeClauses.length > 0
    ? `WHERE user_id = $1 AND (${scopeClauses.join(' OR ')})`
    : 'WHERE user_id = $1';

  return deleteFromTable(
    client,
    'linkedin_posts',
    whereSql,
    params,
    'member LinkedIn posts',
    counts,
    countKey
  );
};

const deleteScheduledPostsForMember = async (client, teamId, userId, accountIds, counts, countKey) => {
  if (!(await tableExists(client, 'scheduled_linkedin_posts'))) {
    counts[countKey] = 0;
    return 0;
  }

  const columns = await getExistingColumns(client, 'scheduled_linkedin_posts', ['team_id', 'company_id', 'account_id']);
  const scopeClauses = [];
  const params = [userId];

  if (columns.has('team_id')) {
    params.push(String(teamId));
    scopeClauses.push(`team_id::text = $${params.length}::text`);
  }

  if (columns.has('company_id')) {
    params.push(String(teamId));
    scopeClauses.push(`company_id::text = $${params.length}::text`);
  }

  if (columns.has('account_id') && Array.isArray(accountIds) && accountIds.length > 0) {
    params.push(accountIds);
    scopeClauses.push(`account_id::text = ANY($${params.length}::text[])`);
  }

  const whereSql = scopeClauses.length > 0
    ? `WHERE user_id = $1 AND (${scopeClauses.join(' OR ')})`
    : 'WHERE user_id = $1';

  return deleteFromTable(
    client,
    'scheduled_linkedin_posts',
    whereSql,
    params,
    'member scheduled LinkedIn posts',
    counts,
    countKey
  );
};

export const cleanupController = {
  async cleanupUserData(req, res) {
    try {
      const { userId } = req.body;
      if (!userId) {
        return res.status(400).json({
          error: 'userId is required',
          code: 'MISSING_USER_ID',
        });
      }

      console.log(`[LinkedIn Cleanup] Starting full user cleanup for ${userId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};

        await deleteFromTable(
          client,
          'linkedin_posts',
          'WHERE user_id = $1',
          [userId],
          'LinkedIn posts',
          deletedCounts,
          'posts'
        );

        await deleteFromTable(
          client,
          'scheduled_linkedin_posts',
          'WHERE user_id = $1',
          [userId],
          'scheduled LinkedIn posts',
          deletedCounts,
          'scheduledPosts'
        );

        await deleteFromTable(
          client,
          'social_connected_accounts',
          `WHERE platform = 'linkedin'
             AND user_id::text = $1::text`,
          [userId],
          'mirrored LinkedIn social accounts',
          deletedCounts,
          'socialAccounts'
        );

        await deleteFromTable(
          client,
          'linkedin_team_accounts',
          'WHERE user_id = $1',
          [userId],
          'team LinkedIn accounts',
          deletedCounts,
          'teamAccounts'
        );

        await deleteFromTable(
          client,
          'linkedin_auth',
          'WHERE user_id = $1',
          [userId],
          'personal LinkedIn auth records',
          deletedCounts,
          'personalAccounts'
        );

        await client.query('COMMIT');
        console.log('[LinkedIn Cleanup] User cleanup completed');

        return res.json({
          success: true,
          message: 'LinkedIn user data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[LinkedIn Cleanup] User cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup LinkedIn data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },

  async cleanupTeamData(req, res) {
    try {
      const { teamId } = req.body;
      if (!teamId) {
        return res.status(400).json({
          error: 'teamId is required',
          code: 'MISSING_TEAM_ID',
        });
      }

      console.log(`[LinkedIn Cleanup] Starting full team cleanup for ${teamId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};
        const teamAccountIds = await listLinkedInTeamAccountIds(client, 'WHERE team_id::text = $1::text', [teamId]);

        await deleteLinkedInPostsForTeam(client, teamId, teamAccountIds, deletedCounts, 'posts');
        await deleteScheduledPostsForTeam(client, teamId, teamAccountIds, deletedCounts, 'scheduledPosts');

        await deleteFromTable(
          client,
          'social_connected_accounts',
          `WHERE platform = 'linkedin'
             AND team_id::text = $1::text`,
          [teamId],
          'team mirrored LinkedIn social accounts',
          deletedCounts,
          'socialAccounts'
        );

        await deleteFromTable(
          client,
          'linkedin_team_accounts',
          'WHERE team_id::text = $1::text',
          [teamId],
          'team LinkedIn accounts',
          deletedCounts,
          'teamAccounts'
        );

        await client.query('COMMIT');
        console.log('[LinkedIn Cleanup] Team cleanup completed');

        return res.json({
          success: true,
          message: 'LinkedIn team data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[LinkedIn Cleanup] Team cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup LinkedIn team data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },

  async cleanupMemberData(req, res) {
    try {
      const { teamId, userId } = req.body;
      if (!teamId || !userId) {
        return res.status(400).json({
          error: 'teamId and userId are required',
          code: 'MISSING_PARAMS',
        });
      }

      console.log(`[LinkedIn Cleanup] Starting member cleanup for user ${userId} in team ${teamId}`);
      const client = await pool.connect();

      try {
        await client.query('BEGIN');
        const deletedCounts = {};
        const memberAccountIds = await listLinkedInTeamAccountIds(
          client,
          'WHERE team_id::text = $1::text AND user_id::text = $2::text',
          [teamId, userId]
        );

        await deleteLinkedInPostsForMember(client, teamId, userId, memberAccountIds, deletedCounts, 'posts');
        await deleteScheduledPostsForMember(client, teamId, userId, memberAccountIds, deletedCounts, 'scheduledPosts');

        await deleteFromTable(
          client,
          'social_connected_accounts',
          `WHERE platform = 'linkedin'
             AND team_id::text = $1::text
             AND user_id::text = $2::text`,
          [teamId, userId],
          'member mirrored LinkedIn social accounts',
          deletedCounts,
          'socialAccounts'
        );

        await deleteFromTable(
          client,
          'linkedin_team_accounts',
          'WHERE team_id::text = $1::text AND user_id::text = $2::text',
          [teamId, userId],
          'member team LinkedIn accounts',
          deletedCounts,
          'teamAccounts'
        );

        await client.query('COMMIT');
        console.log('[LinkedIn Cleanup] Member cleanup completed');

        return res.json({
          success: true,
          message: 'LinkedIn member data wiped successfully',
          deletedCounts,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[LinkedIn Cleanup] Member cleanup error:', error);
      return res.status(500).json({
        error: 'Failed to cleanup LinkedIn member data',
        code: 'CLEANUP_ERROR',
        message: error.message,
      });
    }
  },
};

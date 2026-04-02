import express from 'express';
import { pool } from '../config/database.js';
import aiService from '../services/aiService.js';
import { createLinkedInPost, refreshLinkedInAccessToken, uploadImageToLinkedIn } from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';
import { resolveLinkedInAuthorIdentity } from '../utils/linkedinAuthorIdentity.js';
import { create as createScheduledLinkedInPost } from '../models/scheduledPostModel.js';
import linkedinAutomationService from '../services/linkedinAutomationService.js';
import competitorIntelService from '../services/competitorIntelService.js';

const router = express.Router();
const TEAM_ADMIN_ROLES = new Set(['owner', 'admin']);
const MAX_CROSSPOST_MEDIA_ITEMS = 9;
const MAX_CROSSPOST_REMOTE_MEDIA_BYTES = 8 * 1024 * 1024;

const parsePositiveInt = (value) => {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseNonEmptyString = (value, maxLength = 255) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const normalizeOptionalString = (value, maxLength = 255) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};
const isMissingRelation = (error) =>
  error?.code === '42P01' || String(error?.message || '').toLowerCase().includes('does not exist');
const INTERNAL_ANALYSIS_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'your', 'from', 'into', 'about', 'have', 'just',
  'they', 'them', 'their', 'there', 'what', 'when', 'where', 'which', 'would', 'could', 'should',
  'linkedin', 'post', 'posts', 'content', 'build', 'building', 'audience', 'strategy',
]);

const normalizeLinkedInActorId = (value) => {
  const normalized = normalizeOptionalString(value, 255);
  if (!normalized) return null;
  if (normalized.startsWith('org:')) return normalized.slice(4) || null;
  if (normalized.startsWith('urn:li:organization:')) return normalized.slice('urn:li:organization:'.length) || null;
  if (normalized.startsWith('urn:li:person:')) return normalized.slice('urn:li:person:'.length) || null;
  return normalized;
};

const normalizeAnalysisToken = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#@-]/g, '')
    .trim();

const extractTopAnalysisTopics = (values = [], limit = 8) => {
  const scores = new Map();
  const addToken = (rawToken, weight = 1) => {
    const token = normalizeAnalysisToken(rawToken).replace(/^#/, '');
    if (!token) return;
    if (INTERNAL_ANALYSIS_STOP_WORDS.has(token)) return;
    if (token.length < 4 && !['ai', 'ux', 'ui', 'api', 'seo', 'saas', 'b2b', 'b2c'].includes(token)) return;
    scores.set(token, (scores.get(token) || 0) + weight);
  };

  for (const rawValue of Array.isArray(values) ? values : []) {
    const text = String(rawValue || '').trim();
    if (!text) continue;
    for (const match of text.matchAll(/#[a-z0-9_]+/gi)) {
      addToken(match[0], 3);
    }
    text
      .replace(/https?:\/\/\S+/gi, ' ')
      .split(/[^a-zA-Z0-9+#@-]+/)
      .forEach((token) => addToken(token, 1));
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
};

const dedupeStringsSimple = (items = [], limit = 12) => {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const value = normalizeOptionalString(item, 240);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
};

const extractCompetitorTargetsFromLinkedInPosts = (posts = [], accountSnapshot = {}) => {
  const ownTokens = new Set(
    [
      accountSnapshot?.display_name,
      accountSnapshot?.username,
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const counts = new Map();
  const addCandidate = (rawValue, weight = 1) => {
    const value = String(rawValue || '').trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (ownTokens.has(key)) return;
    counts.set(value, (counts.get(value) || 0) + weight);
  };

  for (const post of Array.isArray(posts) ? posts : []) {
    const snippet = String(post?.snippet || post?.content || '');

    for (const match of snippet.matchAll(/(^|[\s(])@([a-z0-9_.-]{2,60})\b/gi)) {
      addCandidate(`@${String(match[2] || '').toLowerCase()}`, 2);
    }
    for (const match of snippet.matchAll(/linkedin\.com\/(?:company|in)\/([a-z0-9-]{2,80})/gi)) {
      addCandidate(`linkedin.com/${String(match[1] || '').toLowerCase()}`, 2);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([value]) => value);
};

const normalizeCrossPostMediaInputs = (value) => {
  if (!Array.isArray(value)) return [];

  const normalizeMediaItem = (item) => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';

    const urlLikeFields = ['url', 'mediaUrl', 'media_url', 'secure_url', 'src', 'href'];
    for (const field of urlLikeFields) {
      const candidate = typeof item[field] === 'string' ? item[field].trim() : '';
      if (candidate) return candidate;
    }

    return '';
  };

  return value
    .map((item) => normalizeMediaItem(item))
    .filter(Boolean)
    .slice(0, MAX_CROSSPOST_MEDIA_ITEMS);
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const parseDataUrlToFile = (value, index) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) return null;

  const mimetype = String(match[1] || '').toLowerCase();
  if (!mimetype.startsWith('image/')) {
    return null;
  }

  const buffer = Buffer.from(match[2], 'base64');
  const extensionMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  const ext = extensionMap[mimetype] || 'bin';

  return {
    buffer,
    mimetype,
    size: buffer.length,
    originalname: `crosspost_${Date.now()}_${index}.${ext}`,
  };
};

const fetchRemoteImageToFile = async (value, index) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(String(value).trim(), { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`Unsupported content-type: ${contentType || 'unknown'}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > MAX_CROSSPOST_REMOTE_MEDIA_BYTES) {
      throw new Error(`Remote image too large (${buffer.length} bytes)`);
    }

    const extensionMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
    };
    const ext = extensionMap[contentType] || 'bin';

    return {
      buffer,
      mimetype: contentType,
      size: buffer.length,
      originalname: `crosspost_${Date.now()}_${index}.${ext}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const resolveCrossPostMediaFile = async (mediaInput, index) => {
  const normalized = String(mediaInput || '').trim();
  if (!normalized) return null;

  if (normalized.startsWith('data:')) {
    return parseDataUrlToFile(normalized, index);
  }

  if (isHttpUrl(normalized)) {
    return fetchRemoteImageToFile(normalized, index);
  }

  return null;
};

const uploadCrossPostMediaAssets = async ({ accessToken, authorUrn, mediaInputs = [], userId }) => {
  const normalizedInputs = normalizeCrossPostMediaInputs(mediaInputs);
  if (!normalizedInputs.length) {
    return {
      assets: [],
      mediaStatus: 'none',
      mediaCount: 0,
      skippedCount: 0,
    };
  }

  // Resolve all media files in parallel — base64 decode + remote fetch run simultaneously
  const resolvedFiles = await Promise.allSettled(
    normalizedInputs.map((item, index) => resolveCrossPostMediaFile(item, index))
  );

  // Upload all successfully resolved files to LinkedIn in parallel
  const uploadTasks = resolvedFiles.map((settlement, index) => {
    if (settlement.status === 'rejected' || !settlement.value) {
      return Promise.resolve({ index, asset: null, skipped: true, error: settlement.reason });
    }
    const file = settlement.value;
    return uploadImageToLinkedIn(accessToken, authorUrn, file)
      .then((asset) => ({ index, asset, skipped: !asset }))
      .catch((err) => {
        logger.warn('[cross-post] Skipping one media item during LinkedIn cross-post upload', {
          user: userId,
          index,
          error: err?.message || String(err),
        });
        return { index, asset: null, skipped: true, error: err };
      });
  });

  const uploadResults = await Promise.allSettled(uploadTasks);

  const assets = [];
  let skippedCount = 0;
  let hadUploadError = false;

  for (const settlement of uploadResults) {
    if (settlement.status === 'rejected') {
      // Should never happen since each uploadTask catches internally
      skippedCount += 1;
      hadUploadError = true;
      continue;
    }
    const { asset, skipped, error } = settlement.value;
    if (skipped || !asset) {
      skippedCount += 1;
      if (error) hadUploadError = true;
    } else {
      assets.push(asset);
    }
  }

  let mediaStatus = 'none';
  if (assets.length > 0 && skippedCount > 0) mediaStatus = 'posted_partial';
  else if (assets.length > 0) mediaStatus = 'posted';
  else if (hadUploadError) mediaStatus = 'text_only_upload_failed';
  else mediaStatus = 'text_only_unsupported';

  return {
    assets,
    mediaStatus,
    mediaCount: assets.length,
    skippedCount,
  };
};

const buildTeamLinkedInLabel = (row = {}) => {
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const accountType = String(
    row?.account_type ||
    metadata?.account_type ||
    (String(row?.account_id || '').startsWith('org:') ? 'organization' : 'personal')
  ).toLowerCase();
  const baseName =
    normalizeOptionalString(row?.account_display_name) ||
    normalizeOptionalString(metadata?.organization_name) ||
    normalizeOptionalString(row?.organization_name) ||
    normalizeOptionalString(row?.linkedin_display_name) ||
    normalizeOptionalString(row?.organization_vanity_name) ||
    normalizeOptionalString(row?.account_username) ||
    normalizeOptionalString(row?.linkedin_username) ||
    normalizeOptionalString(metadata?.linkedin_user_id) ||
    (!String(row?.account_id || '').startsWith('org:') ? normalizeOptionalString(row?.account_id) : null) ||
    normalizeOptionalString(row?.linkedin_user_id) ||
    `LinkedIn account #${row?.id ?? 'unknown'}`;

  return `${baseName} (${accountType === 'organization' ? 'LinkedIn organization' : 'LinkedIn personal'})`;
};

const getSocialLinkedInMetadata = (row = {}) => {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
};

const getSocialAccountType = (row = {}) => {
  const metadata = getSocialLinkedInMetadata(row);
  const fromMetadata = normalizeOptionalString(metadata?.account_type, 40);
  if (fromMetadata) return fromMetadata.toLowerCase();
  return String(row?.account_id || '').startsWith('org:') ? 'organization' : 'personal';
};

const getSocialLinkedInUserId = (row = {}) => {
  const metadata = getSocialLinkedInMetadata(row);
  const fromMetadata = normalizeOptionalString(metadata?.linkedin_user_id, 255);
  if (fromMetadata) return fromMetadata;
  const accountId = normalizeOptionalString(row?.account_id, 255);
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

const getSocialLegacyTeamAccountId = (row = {}) => {
  const metadata = getSocialLinkedInMetadata(row);
  return (
    parsePositiveInt(metadata?.legacy_team_account_id) ||
    parsePositiveInt(metadata?.legacy_row_id) ||
    null
  );
};

const toPostingAccountFromSocialRow = (row = {}) => ({
  source: 'social',
  id: String(row.id),
  social_id: String(row.id),
  user_id: normalizeOptionalString(row.user_id, 128),
  team_id: normalizeOptionalString(row.team_id, 128),
  account_id: normalizeOptionalString(row.account_id, 255),
  account_username: normalizeOptionalString(row.account_username, 255),
  account_display_name: normalizeOptionalString(row.account_display_name, 255),
  profile_image_url: normalizeOptionalString(row.profile_image_url, 1024),
  access_token: normalizeOptionalString(row.access_token, 4096),
  refresh_token: normalizeOptionalString(row.refresh_token, 4096),
  token_expires_at: row.token_expires_at || null,
  metadata: getSocialLinkedInMetadata(row),
  account_type: getSocialAccountType(row),
  linkedin_user_id: getSocialLinkedInUserId(row),
  legacy_team_account_id: getSocialLegacyTeamAccountId(row),
});

const toPostingAccountFromLegacyTeamRow = (row = {}) => ({
  ...row,
  source: 'legacy_team',
  id: String(row.id),
  legacy_team_account_id: parsePositiveInt(row.id),
  account_type: normalizeOptionalString(row.account_type, 40) || 'personal',
});

const toPostingAccountFromLegacyPersonalRow = (row = {}) => ({
  ...row,
  source: 'legacy_personal',
  id: String(row.id),
  account_type: 'personal',
  legacy_team_account_id: null,
});

const isLinkedInUnauthorizedError = (error) => {
  const status = Number(error?.response?.status || error?.status || 0);
  const apiCode = String(error?.response?.data?.code || error?.code || '').toUpperCase();
  const serviceErrorCode = String(error?.response?.data?.serviceErrorCode || '');
  const message = String(error?.response?.data?.message || error?.message || '').toUpperCase();

  return (
    status === 401 ||
    apiCode === 'REVOKED_ACCESS_TOKEN' ||
    serviceErrorCode === '65601' ||
    message.includes('REVOKED') ||
    message.includes('UNAUTHORIZED')
  );
};

async function refreshLinkedInAuthForUser(userId, accountRow) {
  const refreshToken = String(accountRow?.refresh_token || '').trim();
  if (!refreshToken) {
    throw new Error('LinkedIn refresh token missing');
  }

  const refreshed = await refreshLinkedInAccessToken(refreshToken);
  const accessToken = String(refreshed?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('LinkedIn refresh did not return access token');
  }

  const nextRefreshToken = String(refreshed?.refresh_token || refreshToken).trim() || refreshToken;
  const expiresIn = Number(refreshed?.expires_in || 0);
  const tokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  const { rows } = await pool.query(
    `UPDATE linkedin_auth
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE user_id = $4
     RETURNING *`,
    [accessToken, nextRefreshToken, tokenExpiresAt, userId]
  );

  return rows[0] || { ...accountRow, access_token: accessToken, refresh_token: nextRefreshToken, token_expires_at: tokenExpiresAt };
}

async function refreshLinkedInAuthForTeamAccount(teamAccountId, accountRow) {
  const refreshToken = String(accountRow?.refresh_token || '').trim();
  if (!refreshToken) {
    throw new Error('LinkedIn refresh token missing');
  }

  const refreshed = await refreshLinkedInAccessToken(refreshToken);
  const accessToken = String(refreshed?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('LinkedIn refresh did not return access token');
  }

  const nextRefreshToken = String(refreshed?.refresh_token || refreshToken).trim() || refreshToken;
  const expiresIn = Number(refreshed?.expires_in || 0);
  const tokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  const { rows } = await pool.query(
    `UPDATE linkedin_team_accounts
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [accessToken, nextRefreshToken, tokenExpiresAt, teamAccountId]
  );

  return rows[0] || { ...accountRow, access_token: accessToken, refresh_token: nextRefreshToken, token_expires_at: tokenExpiresAt };
}

async function refreshLinkedInAuthForSocialAccount(socialAccountId, accountRow) {
  const refreshToken = String(accountRow?.refresh_token || '').trim();
  if (!refreshToken) {
    throw new Error('LinkedIn refresh token missing');
  }

  const refreshed = await refreshLinkedInAccessToken(refreshToken);
  const accessToken = String(refreshed?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('LinkedIn refresh did not return access token');
  }

  const nextRefreshToken = String(refreshed?.refresh_token || refreshToken).trim() || refreshToken;
  const expiresIn = Number(refreshed?.expires_in || 0);
  const tokenExpiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  const { rows } = await pool.query(
    `UPDATE social_connected_accounts
     SET access_token = $1,
         refresh_token = $2,
         token_expires_at = $3,
         updated_at = NOW()
     WHERE id::text = $4::text
     RETURNING *`,
    [accessToken, nextRefreshToken, tokenExpiresAt, String(socialAccountId)]
  );

  const refreshedRow = rows[0] ? toPostingAccountFromSocialRow(rows[0]) : {
    ...accountRow,
    access_token: accessToken,
    refresh_token: nextRefreshToken,
    token_expires_at: tokenExpiresAt,
  };

  const metadata = refreshedRow?.metadata && typeof refreshedRow.metadata === 'object' ? refreshedRow.metadata : {};
  const sourceTable = normalizeOptionalString(metadata?.source_table, 80);
  const legacyPersonalId =
    normalizeOptionalString(metadata?.legacy_personal_row_id, 128) ||
    normalizeOptionalString(metadata?.legacy_row_id, 128);
  const legacyTeamId = parsePositiveInt(metadata?.legacy_team_account_id) || parsePositiveInt(metadata?.legacy_row_id);

  try {
    if (sourceTable === 'linkedin_auth' && legacyPersonalId) {
      await pool.query(
        `UPDATE linkedin_auth
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = NOW()
         WHERE id::text = $4::text`,
        [accessToken, nextRefreshToken, tokenExpiresAt, legacyPersonalId]
      );
    } else if (sourceTable === 'linkedin_team_accounts' && legacyTeamId) {
      await pool.query(
        `UPDATE linkedin_team_accounts
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [accessToken, nextRefreshToken, tokenExpiresAt, legacyTeamId]
      );
    }
  } catch (legacySyncError) {
    logger.warn('[cross-post] Social token refresh succeeded but legacy sync failed', {
      socialAccountId: String(socialAccountId),
      sourceTable,
      error: legacySyncError?.message || String(legacySyncError),
    });
  }

  return refreshedRow;
}

async function getActiveTeamMembership(teamId, userId) {
  const { rows } = await pool.query(
    `SELECT team_id, user_id, role
     FROM team_members
     WHERE team_id = $1
       AND user_id = $2
       AND status = 'active'
     LIMIT 1`,
    [teamId, userId]
  );
  return rows[0] || null;
}

async function listEligibleTeamLinkedInTargets({ teamId, platformUserId }) {
  const membership = await getActiveTeamMembership(teamId, platformUserId);
  if (!membership) {
    return { membership: null, targets: [] };
  }

  const requesterRole = String(membership.role || '').toLowerCase();
  const allowAllTeamAccounts = TEAM_ADMIN_ROLES.has(requesterRole);

  const params = [teamId];
  let query = `
    SELECT sca.*
    FROM social_connected_accounts sca
    WHERE sca.team_id::text = $1::text
      AND sca.platform = 'linkedin'
      AND sca.is_active = true
  `;

  if (!allowAllTeamAccounts) {
    params.push(platformUserId);
    query += ' AND sca.user_id::text = $2::text';
  }

  query += ' ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC';

  const { rows } = await pool.query(query, params);
  const targets = rows.map((row) => ({
    id: String(row.id),
    teamId: String(row.team_id),
    label: buildTeamLinkedInLabel(row),
    accountType: getSocialAccountType(row),
    linkedinUserId: getSocialLinkedInUserId(row),
    connectedByUserId: normalizeOptionalString(row.user_id),
  }));

  return { membership, targets };
}

async function listPersonalLinkedInTargets({ userId }) {
  const { rows } = await pool.query(
    `SELECT id, account_id, account_username, account_display_name, profile_image_url, metadata
     FROM social_connected_accounts
     WHERE user_id = $1
       AND team_id IS NULL
       AND platform = 'linkedin'
       AND is_active = true
     ORDER BY updated_at DESC NULLS LAST, id DESC`,
    [userId]
  );

  return rows.map((row) => ({
    id: String(row.id),
    platform: 'linkedin',
    username: normalizeOptionalString(row.account_username, 255) || getSocialLinkedInUserId(row),
    displayName:
      normalizeOptionalString(row.account_display_name, 255) ||
      normalizeOptionalString(row.account_username, 255) ||
      `LinkedIn account #${row.id}`,
    avatar: normalizeOptionalString(row.profile_image_url, 1024),
  }));
}

async function resolveExplicitTeamLinkedInTarget({ teamId, platformUserId, targetLinkedinTeamAccountId }) {
  const membership = await getActiveTeamMembership(teamId, platformUserId);
  if (!membership) {
    return { error: { status: 403, code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN', message: 'Requester is not an active team member.' } };
  }

  const normalizedTargetId = parseNonEmptyString(targetLinkedinTeamAccountId, 128);
  if (!normalizedTargetId) {
    return { error: { status: 400, code: 'CROSSPOST_TARGET_ACCOUNT_INVALID', message: 'Invalid target LinkedIn team account id.' } };
  }

  const { rows } = await pool.query(
    `SELECT sca.*
     FROM social_connected_accounts sca
     WHERE sca.id::text = $1::text
       AND sca.team_id::text = $2::text
       AND sca.platform = 'linkedin'
       AND sca.is_active = true
     LIMIT 1`,
    [normalizedTargetId, teamId]
  );

  let targetRow = rows[0] ? toPostingAccountFromSocialRow(rows[0]) : null;
  if (!targetRow) {
    // Compatibility path for older scheduled payloads using legacy integer team account ids.
    const legacyTargetId = parsePositiveInt(normalizedTargetId);
    if (legacyTargetId) {
      const legacyResult = await pool.query(
        `SELECT lta.*
         FROM linkedin_team_accounts lta
         WHERE lta.id = $1
           AND lta.team_id::text = $2::text
           AND lta.active = true
         LIMIT 1`,
        [legacyTargetId, teamId]
      );
      if (legacyResult.rows[0]) {
        targetRow = toPostingAccountFromLegacyTeamRow(legacyResult.rows[0]);
      }
    }
  }

  if (!targetRow) {
    return { error: { status: 404, code: 'CROSSPOST_TARGET_ACCOUNT_NOT_FOUND', message: 'Target LinkedIn team account not found.' } };
  }

  const requesterRole = String(membership.role || '').toLowerCase();
  if (!TEAM_ADMIN_ROLES.has(requesterRole) && String(targetRow.user_id) !== String(platformUserId)) {
    return { error: { status: 403, code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN', message: 'You do not have permission to use this target LinkedIn team account.' } };
  }

  return { membership, targetRow };
}

async function resolveExplicitPersonalLinkedInTarget({ platformUserId, targetAccountId }) {
  const normalizedTargetId = parseNonEmptyString(targetAccountId, 128);
  if (!normalizedTargetId) {
    return { error: { status: 400, code: 'CROSSPOST_TARGET_ACCOUNT_INVALID', message: 'Invalid target LinkedIn account id.' } };
  }

  const socialResult = await pool.query(
    `SELECT sca.*
     FROM social_connected_accounts sca
     WHERE sca.id::text = $1::text
       AND sca.user_id::text = $2::text
       AND sca.team_id IS NULL
       AND sca.platform = 'linkedin'
       AND sca.is_active = true
     LIMIT 1`,
    [normalizedTargetId, platformUserId]
  );

  if (socialResult.rows[0]) {
    return { account: toPostingAccountFromSocialRow(socialResult.rows[0]) };
  }

  const legacyResult = await pool.query(
    `SELECT *
     FROM linkedin_auth
     WHERE id::text = $1::text
       AND user_id::text = $2::text
     LIMIT 1`,
    [normalizedTargetId, platformUserId]
  );

  if (legacyResult.rows[0]) {
    return { account: toPostingAccountFromLegacyPersonalRow(legacyResult.rows[0]) };
  }

  return { error: { status: 404, code: 'CROSSPOST_TARGET_ACCOUNT_NOT_FOUND', message: 'Target LinkedIn account not found.' } };
}

async function resolveDefaultPersonalLinkedInTarget({ platformUserId }) {
  const socialResult = await pool.query(
    `SELECT sca.*
     FROM social_connected_accounts sca
     WHERE sca.user_id::text = $1::text
       AND sca.team_id IS NULL
       AND sca.platform = 'linkedin'
       AND sca.is_active = true
     ORDER BY sca.updated_at DESC NULLS LAST, sca.id DESC
     LIMIT 1`,
    [platformUserId]
  );
  if (socialResult.rows[0]) {
    return { account: toPostingAccountFromSocialRow(socialResult.rows[0]) };
  }

  const legacyResult = await pool.query(
    `SELECT *
     FROM linkedin_auth
     WHERE user_id::text = $1::text
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [platformUserId]
  );
  if (legacyResult.rows[0]) {
    return { account: toPostingAccountFromLegacyPersonalRow(legacyResult.rows[0]) };
  }

  return { error: { status: 404, code: 'LINKEDIN_NOT_CONNECTED', message: 'LinkedIn account not connected.' } };
}

/**
 * GET /api/internal/team-accounts/eligible-crosspost-targets
 * Lists eligible LinkedIn team accounts for explicit cross-post routing in team mode.
 */
router.get('/team-accounts/eligible-crosspost-targets', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim();

  if (!platformUserId || !platformTeamId) {
    return res.status(400).json({
      error: 'x-platform-user-id and x-platform-team-id are required',
      code: 'CROSSPOST_TARGET_ACCOUNT_INVALID',
    });
  }

  try {
    const { membership, targets } = await listEligibleTeamLinkedInTargets({
      teamId: platformTeamId,
      platformUserId,
    });

    if (!membership) {
      return res.status(403).json({
        error: 'Requester is not an active team member.',
        code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN',
      });
    }

    return res.json({
      success: true,
      requesterRole: membership.role,
      targets,
    });
  } catch (error) {
    logger.error('[cross-post] Failed to list eligible team LinkedIn targets', {
      user: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch LinkedIn team targets' });
  }
});

router.get('/accounts/targets', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim() || null;
  const excludeAccountId = normalizeOptionalString(req.query?.excludeAccountId, 128);

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    if (platformTeamId) {
      const { membership, targets } = await listEligibleTeamLinkedInTargets({
        teamId: platformTeamId,
        platformUserId,
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Requester is not an active team member.',
          code: 'CROSSPOST_TARGET_ACCOUNT_FORBIDDEN',
        });
      }

      const accounts = targets
        .map((target) => ({
          id: String(target.id),
          platform: 'linkedin',
          username: target.linkedinUserId || null,
          displayName: target.label || `LinkedIn account #${target.id}`,
          avatar: null,
        }))
        .filter((target) => !excludeAccountId || String(target.id) !== String(excludeAccountId));

      return res.json({ success: true, scope: 'team', accounts });
    }

    const accounts = (await listPersonalLinkedInTargets({ userId: platformUserId }))
      .filter((target) => !excludeAccountId || String(target.id) !== String(excludeAccountId));
    return res.json({ success: true, scope: 'personal', accounts });
  } catch (error) {
    logger.error('[cross-post] Failed to list LinkedIn targets', {
      user: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({ error: 'Failed to fetch LinkedIn targets' });
  }
});

router.post('/workspace/snapshot', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim() || null;
  const targetAccountIds = Array.isArray(req.body?.targetAccountIds)
    ? [...new Set(req.body.targetAccountIds.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  const limit = Math.max(1, Math.min(100, Number(req.body?.limit || 50) || 50));
  const queueLimit = Math.max(1, Math.min(100, Number(req.body?.queueLimit || 50) || 50));

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    let queueRows = [];
    try {
      const queueResult = await pool.query(
        `SELECT id, run_id, title, content, status, metadata, created_at, updated_at
         FROM linkedin_automation_queue
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [platformUserId, queueLimit]
      );
      queueRows = queueResult.rows || [];
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
    }

    const scheduleParams = [];
    const scheduleFilters = [];

    if (platformTeamId) {
      scheduleParams.push(platformTeamId);
      scheduleFilters.push(`slp.company_id::text = $${scheduleParams.length}::text`);
    } else {
      scheduleParams.push(platformUserId);
      scheduleFilters.push(`slp.user_id = $${scheduleParams.length}`);
      scheduleFilters.push(`(slp.company_id IS NULL OR slp.company_id::text = '')`);
    }

    scheduleParams.push(limit);
    let scheduleRows = [];
    try {
      const scheduleResult = await pool.query(
        `SELECT
           slp.id,
           slp.user_id,
           slp.post_content,
           slp.media_urls,
           slp.post_type,
           slp.company_id,
           slp.metadata,
           slp.scheduled_time,
           slp.status,
           slp.error_message,
           slp.created_at,
           slp.updated_at,
           slp.posted_at
         FROM scheduled_linkedin_posts slp
         WHERE ${scheduleFilters.join(' AND ')}
         ORDER BY COALESCE(slp.scheduled_time, slp.created_at) ASC
         LIMIT $${scheduleParams.length}`,
        scheduleParams
      );
      scheduleRows = (scheduleResult.rows || []).filter((row) => {
        if (targetAccountIds.length === 0) return true;
        const companyId = row?.company_id !== undefined && row?.company_id !== null ? String(row.company_id).trim() : '';
        const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
        const metadataTargetId =
          metadata?.target_account_id !== undefined && metadata?.target_account_id !== null
            ? String(metadata.target_account_id).trim()
            : '';
        return targetAccountIds.includes(companyId) || (metadataTargetId && targetAccountIds.includes(metadataTargetId));
      });
    } catch (error) {
      if (!isMissingRelation(error)) throw error;
    }

    const queue = queueRows.map((row) => {
      const metadata =
        row?.metadata && typeof row.metadata === 'object'
          ? row.metadata
          : {};
      const suggestedDayOffset = Number(metadata?.suggested_day_offset || 0);
      const suggestedLocalTime = normalizeOptionalString(metadata?.suggested_local_time, 20);
      const scheduledForHint = suggestedLocalTime
        ? `${suggestedDayOffset >= 0 ? `+${suggestedDayOffset}` : suggestedDayOffset}d ${suggestedLocalTime}`
        : null;
      return {
        id: `liq-${row.id}`,
        sourceId: String(row.id),
        platform: 'linkedin',
        kind: 'queue',
        status: String(row.status || '').toLowerCase() || 'needs_approval',
        title: row.title || null,
        content: String(row.content || ''),
        runId: row.run_id || null,
        scheduledForHint,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        teamId: platformTeamId,
      };
    });

    const calendar = scheduleRows.map((row) => ({
      id: `lic-${row.id}`,
      sourceId: String(row.id),
      platform: 'linkedin',
      kind: 'calendar',
      status: String(row.status || '').toLowerCase() || 'scheduled',
      content: String(row.post_content || ''),
      postType: row.post_type || 'single_post',
      mediaUrls: row.media_urls || null,
      scheduledFor: row.scheduled_time || null,
      postedAt: row.posted_at || null,
      errorMessage: row.error_message || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      teamId: row.company_id ? String(row.company_id) : platformTeamId,
      accountId: row.company_id ? String(row.company_id) : null,
    }));

    return res.json({
      success: true,
      platform: 'linkedin',
      queue,
      calendar,
      summary: {
        queueCount: queue.length,
        calendarCount: calendar.length,
      },
    });
  } catch (error) {
    logger.error('[cross-post] Failed to build LinkedIn workspace snapshot', {
      user: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to fetch LinkedIn workspace snapshot',
      code: 'LINKEDIN_WORKSPACE_SNAPSHOT_FAILED',
    });
  }
});

router.post('/analytics/summary', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const targetAccountIds = Array.isArray(req.body?.targetAccountIds)
    ? [...new Set(req.body.targetAccountIds.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  const days = Math.max(1, Math.min(365, Number(req.body?.days || 30) || 30));

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const postParams = [platformUserId, startDate];
    const postFilters = [
      'user_id = $1',
      'COALESCE(posted_at, created_at) >= $2',
      "status = 'posted'",
    ];

    if (targetAccountIds.length > 0) {
      postParams.push(targetAccountIds);
      const index = postParams.length;
      postFilters.push(`(
        COALESCE(account_id::text, '') = ANY($${index}::text[])
        OR COALESCE(company_id::text, '') = ANY($${index}::text[])
        OR COALESCE(linkedin_user_id::text, '') = ANY($${index}::text[])
      )`);
    }

    const postsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_posts,
         COALESCE(SUM(views), 0)::bigint AS total_views,
         COALESCE(SUM(likes), 0)::bigint AS total_likes,
         COALESCE(SUM(comments), 0)::bigint AS total_comments,
         COALESCE(SUM(shares), 0)::bigint AS total_shares,
         COALESCE(SUM(likes + comments + shares), 0)::bigint AS total_engagement
       FROM linkedin_posts
       WHERE ${postFilters.join(' AND ')}`,
      postParams
    );

    const queueResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'needs_approval')::int AS pending_approvals,
         COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_queue,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_queue,
         COUNT(*) FILTER (WHERE status = 'posted')::int AS posted_queue
       FROM linkedin_automation_queue
       WHERE user_id = $1`,
      [platformUserId]
    ).catch((error) => (isMissingRelation(error) ? { rows: [{}] } : Promise.reject(error)));

    return res.json({
      success: true,
      platform: 'linkedin',
      totalPosts: Number(postsResult.rows[0]?.total_posts || 0),
      totalViews: Number(postsResult.rows[0]?.total_views || 0),
      totalLikes: Number(postsResult.rows[0]?.total_likes || 0),
      totalComments: Number(postsResult.rows[0]?.total_comments || 0),
      totalShares: Number(postsResult.rows[0]?.total_shares || 0),
      totalEngagement: Number(postsResult.rows[0]?.total_engagement || 0),
      pendingApprovals: Number(queueResult.rows[0]?.pending_approvals || 0),
      draftQueue: Number(queueResult.rows[0]?.draft_queue || 0),
      approvedQueue: Number(queueResult.rows[0]?.approved_queue || 0),
      postedQueue: Number(queueResult.rows[0]?.posted_queue || 0),
    });
  } catch (error) {
    logger.error('[cross-post] Failed to build LinkedIn analytics summary', {
      user: platformUserId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to fetch LinkedIn analytics summary',
      code: 'LINKEDIN_ANALYTICS_SUMMARY_FAILED',
    });
  }
});

router.post('/engagement/summary', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const days = Math.max(1, Math.min(365, Number(req.body?.days || 30) || 30));

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const assistResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'ready')::int AS ready_reply_drafts,
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_replies
       FROM linkedin_comment_reply_assist
       WHERE user_id = $1
         AND created_at >= $2`,
      [platformUserId, startDate]
    ).catch((error) => (isMissingRelation(error) ? { rows: [{}] } : Promise.reject(error)));

    const postsWithCommentsResult = await pool.query(
      `SELECT COUNT(*)::int AS posts_with_comments
       FROM linkedin_posts
       WHERE user_id = $1
         AND COALESCE(posted_at, created_at) >= $2
         AND COALESCE(comments, 0) > 0`,
      [platformUserId, startDate]
    ).catch((error) => (isMissingRelation(error) ? { rows: [{}] } : Promise.reject(error)));

    return res.json({
      success: true,
      platform: 'linkedin',
      readyReplyDrafts: Number(assistResult.rows[0]?.ready_reply_drafts || 0),
      sentReplies: Number(assistResult.rows[0]?.sent_replies || 0),
      postsWithComments: Number(postsWithCommentsResult.rows[0]?.posts_with_comments || 0),
    });
  } catch (error) {
    logger.error('[cross-post] Failed to build LinkedIn engagement summary', {
      user: platformUserId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to fetch LinkedIn engagement summary',
      code: 'LINKEDIN_ENGAGEMENT_SUMMARY_FAILED',
    });
  }
});

router.post('/analysis-context', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim() || null;
  const targetAccountId = parseNonEmptyString(req.body?.targetAccountId, 128);

  if (!platformUserId) {
    return res.status(400).json({
      error: 'x-platform-user-id is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  try {
    const resolvedAccountType = platformTeamId ? 'team' : null;
    const [profileRow, competitorRow, accountSnapshot, postSummary] = await Promise.all([
      linkedinAutomationService.getProfileContextRow(platformUserId),
      linkedinAutomationService.getCompetitorRow(platformUserId),
      linkedinAutomationService.getLinkedinAccountSnapshot(platformUserId, {
        accountId: targetAccountId,
        accountType: resolvedAccountType,
      }),
      linkedinAutomationService.getPostSummary(platformUserId, {
        limit: 20,
        accountId: targetAccountId,
        accountType: resolvedAccountType,
      }),
    ]);

    const profileContext = linkedinAutomationService.mapProfileContext(profileRow);
    const savedCompetitorConfig = linkedinAutomationService.mapCompetitors(competitorRow);
    const postTexts = [
      ...(Array.isArray(postSummary?.recentPosts) ? postSummary.recentPosts.map((item) => item?.snippet || item?.content || '') : []),
      ...(Array.isArray(postSummary?.topPosts) ? postSummary.topPosts.map((item) => item?.snippet || item?.content || '') : []),
      accountSnapshot?.headline || '',
      accountSnapshot?.about || '',
    ].filter(Boolean);
    const autoCompetitorTargets = extractCompetitorTargetsFromLinkedInPosts([
      ...(Array.isArray(postSummary?.recentPosts) ? postSummary.recentPosts : []),
      ...(Array.isArray(postSummary?.topPosts) ? postSummary.topPosts : []),
    ], accountSnapshot || {});

    let autoCompetitorIntel = {
      referenceAccounts: [],
      competitorProfiles: autoCompetitorTargets,
      competitorExamples: [],
      scrapeReport: { warnings: [] },
    };
    if (autoCompetitorTargets.length > 0) {
      autoCompetitorIntel = await competitorIntelService.analyzeTargets({
        competitorTargets: autoCompetitorTargets,
        manualExamples: [],
        winAngle: savedCompetitorConfig?.win_angle || 'authority',
        consentScrape: false,
      });
    }

    const mergedCompetitorConfig = {
      ...savedCompetitorConfig,
      competitor_profiles: dedupeStringsSimple([
        ...(Array.isArray(savedCompetitorConfig?.competitor_profiles) ? savedCompetitorConfig.competitor_profiles : []),
        ...(Array.isArray(autoCompetitorIntel?.competitorProfiles) ? autoCompetitorIntel.competitorProfiles : []),
      ], 5),
    };
    const heuristicAnalysis = linkedinAutomationService.buildHeuristicAnalysis({
      profileContext,
      competitorConfig: mergedCompetitorConfig,
      postSummary,
      accountSnapshot,
    });
    const topTopics = dedupeStringsSimple([
      ...(Array.isArray(postSummary?.themes) ? postSummary.themes : []),
      ...extractTopAnalysisTopics(postTexts, 8),
    ], 8);
    const niche = normalizeOptionalString(
      profileContext?.role_niche ||
      (topTopics.length > 0 ? topTopics.slice(0, Math.min(3, topTopics.length)).join(' / ') : null) ||
      accountSnapshot?.headline,
      180
    );
    const audience = normalizeOptionalString(
      profileContext?.target_audience ||
      (topTopics.length > 0 ? `LinkedIn peers interested in ${topTopics.slice(0, 2).join(' and ')}` : null),
      180
    );

    return res.json({
      success: true,
      platform: 'linkedin',
      scope: platformTeamId ? 'team' : 'personal',
      profile: accountSnapshot,
      analysis: {
        niche,
        audience,
        tone: profileContext?.tone_style || 'Professional and insight-led',
        top_topics: topTopics,
        confidence: postSummary?.postCount >= 8 ? 'high' : postSummary?.postCount >= 3 ? 'medium' : 'low',
        confidence_reason: postSummary?.postCount > 0
          ? `Based on ${postSummary.postCount} recent LinkedIn post(s) and connected profile context`
          : 'Based on connected LinkedIn profile context',
      },
      discoveries: {
        postCount: Number(postSummary?.postCount || 0),
        themes: Array.isArray(postSummary?.themes) ? postSummary.themes.slice(0, 8) : [],
        strengths: Array.isArray(heuristicAnalysis?.strengths) ? heuristicAnalysis.strengths : [],
        gaps: Array.isArray(heuristicAnalysis?.gaps) ? heuristicAnalysis.gaps : [],
        opportunities: Array.isArray(heuristicAnalysis?.opportunities) ? heuristicAnalysis.opportunities : [],
        nextAngles: Array.isArray(heuristicAnalysis?.nextAngles) ? heuristicAnalysis.nextAngles : [],
        competitorCandidates: autoCompetitorTargets,
        competitorReferences: Array.isArray(autoCompetitorIntel?.referenceAccounts)
          ? autoCompetitorIntel.referenceAccounts.slice(0, 5)
          : [],
      },
      warnings: Array.isArray(autoCompetitorIntel?.scrapeReport?.warnings)
        ? autoCompetitorIntel.scrapeReport.warnings.slice(0, 5)
        : [],
    });
  } catch (error) {
    logger.error('[cross-post] Failed to build LinkedIn analysis context', {
      user: platformUserId,
      teamId: platformTeamId,
      targetAccountId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to build LinkedIn analysis context',
      code: 'LINKEDIN_ANALYSIS_CONTEXT_FAILED',
    });
  }
});

router.post('/generate', async (req, res) => {
  const platformUserId = parseNonEmptyString(req.headers['x-platform-user-id'], 128);
  const { prompt, style = 'professional', workspaceName = '', brandName = '' } = req.body || {};

  if (!platformUserId) {
    return res.status(400).json({
      error: 'Platform user ID is required',
      code: 'PLATFORM_USER_ID_REQUIRED',
    });
  }

  const normalizedPrompt = parseNonEmptyString(prompt, 4000);
  if (!normalizedPrompt || normalizedPrompt.length < 5) {
    return res.status(400).json({
      error: 'Prompt must be at least 5 characters long',
      code: 'LINKEDIN_GENERATE_PROMPT_REQUIRED',
    });
  }

  try {
    const fullPrompt = [
      brandName ? `Brand: ${brandName}` : null,
      workspaceName ? `Workspace: ${workspaceName}` : null,
      normalizedPrompt,
    ].filter(Boolean).join('\n');

    const result = await aiService.generateContent(
      fullPrompt,
      parseNonEmptyString(style, 40) || 'professional',
      2,
      null,
      platformUserId,
      null
    );

    return res.json({
      success: true,
      content: result?.content || '',
      provider: result?.provider || null,
      keyType: result?.keyType || null,
      mode: 'single',
    });
  } catch (error) {
    logger.error('[cross-post/generate] Failed to generate LinkedIn workspace draft', {
      user: platformUserId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: 'Failed to generate LinkedIn draft',
      code: 'LINKEDIN_GENERATE_FAILED',
    });
  }
});

router.post('/schedule', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const platformUserId = parseNonEmptyString(req.headers['x-platform-user-id'], 128);
  const platformTeamId = parseNonEmptyString(req.headers['x-platform-team-id'], 128);
  const {
    content = '',
    media = [],
    mediaUrls = [],
    scheduledFor = null,
    timezone = 'UTC',
    targetLinkedinTeamAccountId = null,
    targetAccountId = null,
    metadata = {},
  } = req.body || {};

  if (!platformUserId || !parseNonEmptyString(content, 5000) || !scheduledFor) {
    return res.status(400).json({
      error: 'content, scheduledFor, and x-platform-user-id are required',
      code: 'LINKEDIN_SCHEDULE_REQUIRED_FIELDS',
    });
  }

  let scheduledTimeUtc;
  try {
    scheduledTimeUtc = parseNonEmptyString(timezone, 100)
      ? new Date(new Date(scheduledFor).toLocaleString('en-US', { timeZone: String(timezone) }))
      : new Date(scheduledFor);
  } catch {
    scheduledTimeUtc = new Date(scheduledFor);
  }

  if (Number.isNaN(new Date(scheduledFor).getTime())) {
    return res.status(400).json({
      error: 'Invalid scheduledFor value',
      code: 'LINKEDIN_SCHEDULE_INVALID_TIME',
    });
  }

  if (new Date(scheduledFor).getTime() <= Date.now()) {
    return res.status(400).json({
      error: 'scheduledFor must be in the future',
      code: 'LINKEDIN_SCHEDULE_INVALID_TIME',
    });
  }

  try {
    let isTeamTarget = false;
    let resolvedCompanyId = null;
    let resolvedPersonalTargetId = null;

    if (targetLinkedinTeamAccountId) {
      if (!platformTeamId) {
        return res.status(400).json({
          error: 'x-platform-team-id is required when targetLinkedinTeamAccountId is provided',
          code: 'LINKEDIN_TEAM_CONTEXT_REQUIRED',
        });
      }

      const targetResolution = await resolveExplicitTeamLinkedInTarget({
        teamId: platformTeamId,
        platformUserId,
        targetLinkedinTeamAccountId,
      });

      if (targetResolution.error) {
        return res.status(targetResolution.error.status).json({
          error: targetResolution.error.message,
          code: targetResolution.error.code,
        });
      }

      isTeamTarget = true;
      resolvedCompanyId = String(targetResolution.targetRow?.social_id || targetResolution.targetRow?.id || platformTeamId);
    } else if (platformTeamId) {
      const { targets } = await listEligibleTeamLinkedInTargets({
        teamId: platformTeamId,
        platformUserId,
      });

      if (Array.isArray(targets) && targets.length > 0) {
        isTeamTarget = true;
        resolvedCompanyId = String(targets[0].id);
      } else {
        resolvedCompanyId = String(platformTeamId);
      }
    } else if (targetAccountId) {
      const targetResolution = await resolveExplicitPersonalLinkedInTarget({
        platformUserId,
        targetAccountId,
      });

      if (targetResolution.error) {
        return res.status(targetResolution.error.status).json({
          error: targetResolution.error.message,
          code: targetResolution.error.code,
        });
      }

      resolvedPersonalTargetId = String(targetAccountId).trim();
    }

    const normalizedMedia = normalizeCrossPostMediaInputs(
      Array.isArray(media) && media.length > 0 ? media : mediaUrls
    );
    const scheduledPost = await createScheduledLinkedInPost({
      user_id: platformUserId,
      post_content: parseNonEmptyString(content, 5000),
      media_urls: normalizedMedia,
      post_type: 'single_post',
      company_id: isTeamTarget ? resolvedCompanyId : null,
      scheduled_time: new Date(scheduledFor).toISOString(),
      timezone: parseNonEmptyString(timezone, 100),
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        agency_workspace: {
          source: 'agency_workspace',
          scheduledAt: new Date().toISOString(),
        },
        ...(resolvedPersonalTargetId ? { target_account_id: resolvedPersonalTargetId } : {}),
      },
      status: 'scheduled',
    });

    return res.json({
      success: true,
      status: 'scheduled',
      scheduledPostId: scheduledPost?.id || null,
      scheduledTime: scheduledPost?.scheduled_time || new Date(scheduledFor).toISOString(),
      companyId: isTeamTarget ? resolvedCompanyId : null,
      targetAccountId: resolvedPersonalTargetId,
    });
  } catch (error) {
    logger.error('[cross-post/schedule] Failed to schedule LinkedIn workspace post', {
      user: platformUserId,
      teamId: platformTeamId,
      error: error?.message || String(error),
    });
    return res.status(500).json({
      error: error?.message || 'Failed to schedule LinkedIn post',
      code: 'LINKEDIN_SCHEDULE_FAILED',
    });
  }
});

/**
 * POST /api/internal/cross-post
 * Called internally by Tweet Genie to cross-post a tweet to LinkedIn.
 * Protected by internalAuth middleware (x-internal-api-key header).
 */
router.post('/cross-post', async (req, res) => {
  if (!req.isInternal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const {
    content,
    tweetUrl,
    targetLinkedinTeamAccountId = null,
    targetAccountId = null,
  } = req.body || {};
  const platformUserId = String(req.headers['x-platform-user-id'] || '').trim();
  const platformTeamId = String(req.headers['x-platform-team-id'] || '').trim() || null;

  if (!content || !platformUserId) {
    return res.status(400).json({ error: 'content and x-platform-user-id are required' });
  }

  try {
    const linkedinContent = content;
    const preferredMediaInput =
      Array.isArray(req.body?.media) && req.body.media.length > 0 ? req.body.media : req.body?.mediaUrls;
    const normalizedCrossPostMedia = normalizeCrossPostMediaInputs(preferredMediaInput);
    const explicitTeamTargetRequested =
      targetLinkedinTeamAccountId !== null &&
      targetLinkedinTeamAccountId !== undefined &&
      String(targetLinkedinTeamAccountId).trim() !== '';
    const explicitPersonalTargetRequested =
      targetAccountId !== null &&
      targetAccountId !== undefined &&
      String(targetAccountId).trim() !== '';

    let postingAccount;
    let authorUrn;
    let isTeamTarget = false;
    let targetTeamAccount = null;

    if (explicitTeamTargetRequested) {
      if (!platformTeamId) {
        return res.status(400).json({
          error: 'x-platform-team-id is required when targetLinkedinTeamAccountId is provided',
          code: 'CROSSPOST_TARGET_ACCOUNT_INVALID',
        });
      }

      const targetResolution = await resolveExplicitTeamLinkedInTarget({
        teamId: platformTeamId,
        platformUserId,
        targetLinkedinTeamAccountId,
      });

      if (targetResolution.error) {
        return res.status(targetResolution.error.status).json({
          error: targetResolution.error.message,
          code: targetResolution.error.code,
        });
      }

      targetTeamAccount = targetResolution.targetRow;
      postingAccount = targetTeamAccount;
      authorUrn = resolveLinkedInAuthorIdentity(postingAccount).authorUrn;
      isTeamTarget = true;
    } else {
      // Team mode fallback: if requester is in team context and no explicit target was sent,
      // use the first eligible active LinkedIn team account.
      if (platformTeamId && !explicitPersonalTargetRequested) {
        const { membership, targets } = await listEligibleTeamLinkedInTargets({
          teamId: platformTeamId,
          platformUserId,
        });

        if (membership && Array.isArray(targets) && targets.length > 0) {
          const defaultTeamTargetId = targets[0]?.id;
          const targetResolution = await resolveExplicitTeamLinkedInTarget({
            teamId: platformTeamId,
            platformUserId,
            targetLinkedinTeamAccountId: defaultTeamTargetId,
          });

          if (!targetResolution.error) {
            targetTeamAccount = targetResolution.targetRow;
            postingAccount = targetTeamAccount;
            authorUrn = resolveLinkedInAuthorIdentity(postingAccount).authorUrn;
            isTeamTarget = true;
          }
        }
      }

      if (!postingAccount) {
        if (explicitPersonalTargetRequested) {
          const targetResolution = await resolveExplicitPersonalLinkedInTarget({
            platformUserId,
            targetAccountId,
          });

          if (targetResolution.error) {
            return res.status(targetResolution.error.status).json({
              error: targetResolution.error.message,
              code: targetResolution.error.code,
            });
          }

          postingAccount = targetResolution.account;
        } else {
          const defaultResolution = await resolveDefaultPersonalLinkedInTarget({ platformUserId });
          if (defaultResolution.error) {
            return res.status(defaultResolution.error.status).json({
              error: defaultResolution.error.message,
              code: defaultResolution.error.code,
            });
          }
          postingAccount = defaultResolution.account;
        }
      }
    }

    const authorIdentity = resolveLinkedInAuthorIdentity(postingAccount || {});
    const resolvedLinkedInUserId = normalizeLinkedInActorId(
      authorIdentity.linkedinUserId ||
      authorIdentity.organizationId ||
      postingAccount?.linkedin_user_id ||
      postingAccount?.organization_id ||
      postingAccount?.account_id
    );
    if (!authorIdentity.authorUrn) {
      return res.status(400).json({
        error: 'LinkedIn account is missing a usable posting identity.',
        code: 'LINKEDIN_ACCOUNT_INVALID',
      });
    }

    authorUrn = authorIdentity.authorUrn;

    let linkedinResult;
    let uploadedMediaAssets = [];
    let mediaStatus = normalizedCrossPostMedia.length > 0 ? 'text_only_unsupported' : 'none';
    let mediaCount = 0;

    const publishToLinkedIn = async ({ currentAccount, currentAuthorUrn }) => {
      const mediaUpload = await uploadCrossPostMediaAssets({
        accessToken: currentAccount.access_token,
        authorUrn: currentAuthorUrn,
        mediaInputs: normalizedCrossPostMedia,
        userId: platformUserId,
      });

      const result = await createLinkedInPost(
        currentAccount.access_token,
        currentAuthorUrn,
        linkedinContent,
        mediaUpload.assets,
        'single_post'
      );

      return {
        linkedinResult: result,
        mediaUpload,
      };
    };

    try {
      const publishResult = await publishToLinkedIn({
        currentAccount: postingAccount,
        currentAuthorUrn: authorUrn,
      });
      linkedinResult = publishResult.linkedinResult;
      uploadedMediaAssets = publishResult.mediaUpload.assets;
      mediaStatus = publishResult.mediaUpload.mediaStatus;
      mediaCount = publishResult.mediaUpload.mediaCount;
    } catch (postErr) {
      const canRefresh = isLinkedInUnauthorizedError(postErr) && Boolean(String(postingAccount?.refresh_token || '').trim());
      if (!canRefresh) {
        throw postErr;
      }

      logger.warn('[cross-post] LinkedIn access token invalid for internal cross-post. Attempting refresh + retry', {
        user: platformUserId,
      });

      try {
        if (postingAccount?.source === 'social' && postingAccount?.social_id) {
          postingAccount = await refreshLinkedInAuthForSocialAccount(postingAccount.social_id, postingAccount);
        } else if (isTeamTarget) {
          postingAccount = await refreshLinkedInAuthForTeamAccount(targetTeamAccount.id, postingAccount);
        } else {
          postingAccount = await refreshLinkedInAuthForUser(platformUserId, postingAccount);
        }

        const publishResult = await publishToLinkedIn({
          currentAccount: postingAccount,
          currentAuthorUrn: authorUrn,
        });
        linkedinResult = publishResult.linkedinResult;
        uploadedMediaAssets = publishResult.mediaUpload.assets;
        mediaStatus = publishResult.mediaUpload.mediaStatus;
        mediaCount = publishResult.mediaUpload.mediaCount;
      } catch (retryErr) {
        if (isLinkedInUnauthorizedError(retryErr)) {
          return res.status(401).json({
            error: 'LinkedIn token revoked/expired. Reconnect required.',
            code: 'LINKEDIN_TOKEN_EXPIRED',
          });
        }
        throw retryErr;
      }
    }

    try {
      const linkedinPostId = linkedinResult?.id || linkedinResult?.urn || null;
      const historyAccountId = isTeamTarget
        ? (postingAccount?.legacy_team_account_id || parsePositiveInt(targetTeamAccount?.id))
        : null;
      await pool.query(
        `INSERT INTO linkedin_posts (
          user_id,
          account_id,
          linkedin_post_id,
          post_content,
          media_urls,
          post_type,
          company_id,
          linkedin_user_id,
          status,
          views,
          likes,
          comments,
          shares,
          posted_at,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'single_post', $6, $7, 'posted', 0, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          platformUserId,
          historyAccountId,
          linkedinPostId,
          linkedinContent,
          JSON.stringify(uploadedMediaAssets),
          isTeamTarget ? platformTeamId : null,
          resolvedLinkedInUserId,
        ]
      );
    } catch (dbErr) {
      logger.warn('[cross-post] Posted to LinkedIn but failed to save history row', {
        user: platformUserId,
        error: dbErr?.message || String(dbErr),
      });
    }

    logger.info('[cross-post] Posted to LinkedIn for user', {
      user: platformUserId,
      teamId: isTeamTarget ? platformTeamId : null,
      targetLinkedinTeamAccountId: isTeamTarget ? targetTeamAccount?.id || null : null,
      mediaStatus,
      mediaCount,
    });
    res.json({
      success: true,
      linkedinPostId: linkedinResult?.id || linkedinResult?.urn || null,
      tweetUrl: typeof tweetUrl === 'string' ? tweetUrl : null,
      targetLinkedinTeamAccountId: isTeamTarget ? String(targetTeamAccount?.id) : null,
      targetAccountId: !isTeamTarget && explicitPersonalTargetRequested ? String(targetAccountId) : null,
      mediaStatus,
      mediaCount,
    });

  } catch (err) {
    if (isLinkedInUnauthorizedError(err)) {
      logger.warn('[cross-post] LinkedIn token invalid and could not refresh', {
        user: platformUserId,
        error: err?.response?.data || err?.message || String(err),
      });
      return res.status(401).json({
        error: 'LinkedIn token revoked/expired. Reconnect required.',
        code: 'LINKEDIN_TOKEN_EXPIRED',
      });
    }

    logger.error('[cross-post] Error posting to LinkedIn', { error: err?.response?.data || err.message });
    res.status(500).json({ error: 'Failed to post to LinkedIn' });
  }
});

export default router;

// import { pool } from '../config/database.js';
// import * as linkedinService from '../services/linkedinService.js';
// import { logger } from '../utils/logger.js';
// import { buildCrossPostPayloads, detectCrossPostMedia } from '../utils/crossPostOptimizer.js';
// import {
//   getUserTeamHints,
//   isMeaningfulAccountId,
//   resolveDefaultTeamAccountForUser,
//   resolveTeamAccountForUser
// } from '../utils/teamAccountScope.js';

// const X_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.X_CROSSPOST_TIMEOUT_MS || '10000', 10);
// const THREADS_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.THREADS_CROSSPOST_TIMEOUT_MS || '10000', 10);
// const INTERNAL_CALLER = 'linkedin-genie';

// const isLinkedInUnauthorizedError = (error) => {
//   const status = Number(error?.response?.status || error?.status || 0);
//   const apiCode = String(error?.response?.data?.code || error?.code || '').toUpperCase();
//   const serviceErrorCode = String(error?.response?.data?.serviceErrorCode || '');
//   const message = String(error?.response?.data?.message || error?.message || '').toUpperCase();

//   return (
//     status === 401 ||
//     apiCode === 'REVOKED_ACCESS_TOKEN' ||
//     serviceErrorCode === '65601' ||
//     message.includes('REVOKED') ||
//     message.includes('UNAUTHORIZED')
//   );
// };

// async function refreshLinkedInTokenForSource(tokenSource, userId) {
//   if (!tokenSource?.refreshToken) {
//     throw new Error('No refresh token available for LinkedIn account');
//   }

//   const refreshed = await linkedinService.refreshLinkedInAccessToken(tokenSource.refreshToken);
//   const newAccessToken = String(refreshed?.access_token || '').trim();
//   if (!newAccessToken) {
//     throw new Error('LinkedIn refresh did not return an access token');
//   }

//   const newRefreshToken = String(refreshed?.refresh_token || tokenSource.refreshToken || '').trim() || tokenSource.refreshToken;
//   const expiresIn = Number(refreshed?.expires_in || 0);
//   const newExpiry = Number.isFinite(expiresIn) && expiresIn > 0
//     ? new Date(Date.now() + expiresIn * 1000)
//     : null;

//   if (tokenSource.kind === 'team' && tokenSource.id) {
//     await pool.query(
//       `UPDATE linkedin_team_accounts
//        SET access_token = $1,
//            refresh_token = $2,
//            token_expires_at = $3,
//            updated_at = NOW()
//        WHERE id = $4`,
//       [newAccessToken, newRefreshToken, newExpiry, tokenSource.id]
//     );
//   } else {
//     await pool.query(
//       `UPDATE linkedin_auth
//        SET access_token = $1,
//            refresh_token = $2,
//            token_expires_at = $3,
//            updated_at = NOW()
//        WHERE user_id = $4`,
//       [newAccessToken, newRefreshToken, newExpiry, userId]
//     );
//   }

//   return {
//     ...tokenSource,
//     accessToken: newAccessToken,
//     refreshToken: newRefreshToken,
//     tokenExpiresAt: newExpiry,
//   };
// }

// const normalizeCrossPostTargets = ({ crossPostTargets = null, postToTwitter = false, postToX = false } = {}) => {
//   const raw =
//     crossPostTargets && typeof crossPostTargets === 'object' && !Array.isArray(crossPostTargets)
//       ? crossPostTargets
//       : {};

//   return {
//     x:
//       typeof raw.x === 'boolean'
//         ? raw.x
//         : (typeof raw.twitter === 'boolean' ? raw.twitter : Boolean(postToTwitter || postToX)),
//     threads: typeof raw.threads === 'boolean' ? raw.threads : false,
//   };
// };

// const normalizeCrossPostMedia = (value) => {
//   if (!Array.isArray(value)) return [];
//   return value
//     .map((item) => (typeof item === 'string' ? item.trim() : ''))
//     .filter(Boolean)
//     .slice(0, 4);
// };

// const buildCrossPostResultShape = ({ xEnabled = false, threadsEnabled = false, mediaDetected = false } = {}) => ({
//   x: {
//     enabled: Boolean(xEnabled),
//     status: xEnabled ? null : 'disabled',
//     mediaDetected: Boolean(mediaDetected),
//     mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
//   },
//   threads: {
//     enabled: Boolean(threadsEnabled),
//     status: threadsEnabled ? null : 'disabled',
//     mediaDetected: Boolean(mediaDetected),
//     mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
//   },
// });

// const buildInternalServiceHeaders = ({ userId, internalApiKey }) => ({
//   'Content-Type': 'application/json',
//   'x-internal-api-key': internalApiKey,
//   'x-internal-caller': INTERNAL_CALLER,
//   'x-platform-user-id': String(userId),
// });

// const buildInternalServiceEndpoint = (baseUrl, path) =>
//   `${String(baseUrl || '').trim().replace(/\/$/, '')}${path}`;

// async function postInternalJson({ endpoint, userId, internalApiKey, payload, timeoutMs = 0 }) {
//   const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : null;
//   let timeoutId = null;

//   try {
//     if (controller) {
//       timeoutId = setTimeout(() => controller.abort(), timeoutMs);
//     }

//     const response = await fetch(endpoint, {
//       method: 'POST',
//       headers: buildInternalServiceHeaders({ userId, internalApiKey }),
//       body: JSON.stringify(payload),
//       signal: controller?.signal,
//     });

//     const body = await response.json().catch(() => ({}));
//     return { response, body };
//   } finally {
//     if (timeoutId) clearTimeout(timeoutId);
//   }
// }

// const buildPersonalTokenSourceFromRow = (row, userId) => ({
//   kind: 'personal',
//   userId,
//   accessToken: row?.access_token || null,
//   refreshToken: row?.refresh_token || null,
//   tokenExpiresAt: row?.token_expires_at || null,
// });

// const buildTeamTokenSourceFromRow = (row) => ({
//   kind: 'team',
//   id: row?.id || null,
//   accessToken: row?.access_token || null,
//   refreshToken: row?.refresh_token || null,
//   tokenExpiresAt: row?.token_expires_at || null,
// });

// async function resolvePersonalLinkedInTokenSource(userId, user) {
//   const personalTokenResult = await pool.query(
//     `SELECT access_token, refresh_token, token_expires_at
//      FROM linkedin_auth
//      WHERE user_id = $1
//      LIMIT 1`,
//     [userId]
//   );

//   if (personalTokenResult.rows.length > 0) {
//     return buildPersonalTokenSourceFromRow(personalTokenResult.rows[0], userId);
//   }

//   return {
//     kind: 'session',
//     userId,
//     accessToken: user?.linkedinAccessToken || null,
//     refreshToken: null,
//     tokenExpiresAt: null,
//   };
// }

// async function resolveDeleteLinkedInTokenSource({ post, userId, user }) {
//   if (post?.linkedin_user_id) {
//     const teamTokenResult = await pool.query(
//       `SELECT id, access_token, refresh_token, token_expires_at
//        FROM linkedin_team_accounts
//        WHERE linkedin_user_id = $1 AND active = true
//        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
//        LIMIT 1`,
//       [post.linkedin_user_id]
//     );

//     if (teamTokenResult.rows.length > 0) {
//       console.log('[DELETE POST] Using access token for linkedin_user_id:', post.linkedin_user_id);
//       return buildTeamTokenSourceFromRow(teamTokenResult.rows[0]);
//     }

//     console.log('[DELETE POST] Fallback to personal account for user:', userId);
//     return resolvePersonalLinkedInTokenSource(userId, user);
//   }

//   console.log('[DELETE POST] Using personal account for user:', userId);
//   return resolvePersonalLinkedInTokenSource(userId, user);
// }

// async function crossPostToX({ userId, content, mediaDetected = false, media = [] }) {
//   const tweetGenieUrl = String(process.env.TWEET_GENIE_URL || '').trim();
//   const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

//   if (!tweetGenieUrl || !internalApiKey) {
//     logger.warn('[X Cross-post] Skipped: missing TWEET_GENIE_URL or INTERNAL_API_KEY');
//     return { status: 'skipped_not_configured' };
//   }

//   const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/cross-post');

//   try {
//     const { response, body } = await postInternalJson({
//       endpoint,
//       userId,
//       internalApiKey,
//       timeoutMs: X_CROSSPOST_TIMEOUT_MS,
//       payload: {
//         postMode: 'single',
//         content,
//         mediaDetected: Boolean(mediaDetected),
//         sourcePlatform: 'linkedin',
//         media: Array.isArray(media) ? media : [],
//       },
//     });

//     if (!response.ok) {
//       logger.warn('[X Cross-post] Failed', { status: response.status, code: body?.code });
//       if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
//         return { status: 'not_connected' };
//       }
//       if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
//         return { status: 'not_connected' };
//       }
//       if (response.status === 400 && String(body?.code || '').toUpperCase() === 'X_POST_TOO_LONG') {
//         return { status: 'failed_too_long' };
//       }
//       return {
//         status: 'failed',
//         mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
//         mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
//       };
//     }

//     return {
//       status: 'posted',
//       tweetId: body?.tweetId || null,
//       tweetUrl: body?.tweetUrl || null,
//       mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
//       mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
//     };
//   } catch (error) {
//     if (error?.name === 'AbortError') {
//       logger.warn('[X Cross-post] Timeout reached', { timeoutMs: X_CROSSPOST_TIMEOUT_MS, userId });
//       return { status: 'timeout' };
//     }
//     logger.error('[X Cross-post] Request error', { userId, error: error?.message || String(error) });
//     return { status: 'failed' };
//   }
// }

// async function saveToTweetHistory({ userId, content, tweetId = null, sourcePlatform = 'platform', mediaDetected = false }) {
//   const tweetGenieUrl = String(process.env.TWEET_GENIE_URL || '').trim();
//   const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

//   if (!tweetGenieUrl || !internalApiKey) {
//     return;
//   }

//   const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/save-to-history');

//   try {
//     await postInternalJson({
//       endpoint,
//       userId,
//       internalApiKey,
//       payload: {
//         content,
//         tweetId,
//         mediaDetected: Boolean(mediaDetected),
//         sourcePlatform,
//       },
//     });
//   } catch (error) {
//     logger.warn('[save-to-history] Failed silently', {
//       userId,
//       error: error?.message || String(error),
//     });
//   }
// }

// async function crossPostToThreads({ userId, content, mediaDetected = false, optimizeCrossPost = true, media = [] }) {
//   const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
//   const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

//   if (!socialGenieUrl || !internalApiKey) {
//     logger.warn('[Threads Cross-post] Skipped: missing SOCIAL_GENIE_URL or INTERNAL_API_KEY');
//     return { status: 'skipped_not_configured' };
//   }

//   const endpoint = buildInternalServiceEndpoint(socialGenieUrl, '/api/internal/threads/cross-post');

//   try {
//     const { response, body } = await postInternalJson({
//       endpoint,
//       userId,
//       internalApiKey,
//       timeoutMs: THREADS_CROSSPOST_TIMEOUT_MS,
//       payload: {
//         postMode: 'single',
//         content,
//         threadParts: [],
//         sourcePlatform: 'linkedin',
//         optimizeCrossPost: optimizeCrossPost !== false,
//         mediaDetected: Boolean(mediaDetected),
//         media: Array.isArray(media) ? media : [],
//       },
//     });

//     if (!response.ok) {
//       logger.warn('[Threads Cross-post] Failed', { status: response.status, code: body?.code });
//       if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
//         return { status: 'not_connected' };
//       }
//       if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
//         return { status: 'not_connected' };
//       }
//       return {
//         status: 'failed',
//         mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
//         mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
//       };
//     }

//     return {
//       status: 'posted',
//       mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
//       mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
//     };
//   } catch (error) {
//     if (error?.name === 'AbortError') {
//       logger.warn('[Threads Cross-post] Timeout reached', { timeoutMs: THREADS_CROSSPOST_TIMEOUT_MS, userId });
//       return { status: 'timeout' };
//     }
//     logger.error('[Threads Cross-post] Request error', { userId, error: error?.message || String(error) });
//     return { status: 'failed' };
//   }
// }

// // Create a LinkedIn post (with media, carousels, etc.)
// export async function createPost(req, res) {
//   console.log('[CREATE POST] Route called, req.body:', req.body, 'headers:', req.headers);
//   try {
//     const user = req.user;
//     if (!user) {
//       console.error('[CREATE POST ERROR] Not authenticated');
//       return res.status(401).json({ error: 'Not authenticated' });
//     }
    
//     // Get account_id from request (for team accounts)
//     const accountId = req.body.account_id || req.headers['x-selected-account-id'];
//     const preferredTeamIds = getUserTeamHints(req.user);
//     let selectedTeamAccount = await resolveTeamAccountForUser(user.id, accountId);

//     if (!selectedTeamAccount && !isMeaningfulAccountId(accountId)) {
//       selectedTeamAccount = await resolveDefaultTeamAccountForUser(user.id, { preferredTeamIds });
//     }
    
//     let accessToken, authorUrn, teamAccountResult;
    
//     if (isMeaningfulAccountId(accountId) && !selectedTeamAccount) {
//       return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
//     }
    
//     // If account_id is provided and valid, use the validated team credentials
//     if (selectedTeamAccount) {
//       teamAccountResult = { rows: [selectedTeamAccount] };
//       accessToken = selectedTeamAccount.access_token;
//       authorUrn = `urn:li:person:${selectedTeamAccount.linkedin_user_id}`;
//       console.log('[CREATE POST] Using team account credentials');
//     } else {
//       // Fallback to personal account
//       accessToken = user.linkedinAccessToken;
//       authorUrn = user.linkedinUrn;
//       console.log('[CREATE POST] Using personal account for user:', user.id);
//     }
    
//     if (!accessToken || !authorUrn) {
//       console.error('[CREATE POST ERROR] LinkedIn account not connected', { 
//         hasAccessToken: !!accessToken, 
//         hasAuthorUrn: !!authorUrn, 
//         accountId,
//         userId: user.id,
//         hasPersonalToken: !!user.linkedinAccessToken
//       });
//       return res.status(400).json({ error: 'LinkedIn account not connected' });
//     }
    
//     let {
//       post_content,
//       media_urls = [],
//       post_type = 'single_post',
//       company_id,
//       crossPostTargets = null,
//       optimizeCrossPost = true,
//       postToTwitter = false,
//       postToX = false,
//       crossPostMedia = [],
//     } = req.body;
//     const normalizedCrossPostTargets = normalizeCrossPostTargets({ crossPostTargets, postToTwitter, postToX });
//     const normalizedCrossPostMedia = normalizeCrossPostMedia(crossPostMedia);
//     // If posting to a team account, set company_id to selectedAccountId
//     if (selectedTeamAccount) {
//       company_id = selectedTeamAccount.team_id;
//     }
//     if (!post_content) return res.status(400).json({ error: 'Post content is required' });

//     // Call LinkedIn API to create post
//     const result = await linkedinService.createLinkedInPost(accessToken, authorUrn, post_content, media_urls, post_type, company_id);

//     // Determine linkedin_user_id (the LinkedIn user who created the post)
//     let linkedin_user_id = null;
//     if (selectedTeamAccount) {
//       // Team account: get from teamAccountResult
//       linkedin_user_id = teamAccountResult.rows[0].linkedin_user_id;
//     } else {
//       // Personal account
//       linkedin_user_id = user.linkedinUserId || user.linkedin_user_id;
//     }

//     console.log('[CREATE POST] LinkedIn API success, saving to DB:', {
//       userId: user.id,
//       accountId: accountId || 'personal',
//       linkedin_post_id: result.id || result.urn,
//       post_content,
//       media_urls,
//       post_type,
//       company_id,
//       linkedin_user_id
//     });

//     // Save to DB without initial metrics - will be populated by real analytics sync
//     const { rows } = await pool.query(
//       `INSERT INTO linkedin_posts (user_id, account_id, linkedin_post_id, post_content, media_urls, post_type, company_id, linkedin_user_id, status, views, likes, comments, shares, created_at, updated_at)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'posted', 0, 0, 0, 0, NOW(), NOW())
//        RETURNING *`,
//       [
//         req.user.id,
//         selectedTeamAccount?.id || null,
//         result.id || result.urn,
//         post_content,
//         JSON.stringify(media_urls),
//         post_type,
//         company_id,
//         linkedin_user_id
//       ]
//     );
//     console.log('[CREATE POST] Inserted into linkedin_posts:', rows[0]);

//     const mediaDetected = detectCrossPostMedia({ mediaUrls: media_urls });
//     const crossPostResult = buildCrossPostResultShape({
//       xEnabled: normalizedCrossPostTargets.x,
//       threadsEnabled: normalizedCrossPostTargets.threads,
//       mediaDetected,
//     });

//     if (normalizedCrossPostTargets.x || normalizedCrossPostTargets.threads) {
//       if (selectedTeamAccount) {
//         if (normalizedCrossPostTargets.x) crossPostResult.x.status = 'skipped_individual_only';
//         if (normalizedCrossPostTargets.threads) crossPostResult.threads.status = 'skipped_individual_only';
//       } else {
//         const formattedCrossPost = buildCrossPostPayloads({
//           content: post_content,
//           optimizeCrossPost,
//         });

//         if (normalizedCrossPostTargets.x) {
//           try {
//             const xCrossPost = await crossPostToX({
//               userId: req.user.id,
//               content: formattedCrossPost.x.content,
//               mediaDetected,
//               media: normalizedCrossPostMedia,
//             });
//             crossPostResult.x = {
//               ...crossPostResult.x,
//               ...xCrossPost,
//               status: xCrossPost?.status || 'failed',
//             };

//             if (crossPostResult.x.status === 'posted') {
//               await saveToTweetHistory({
//                 userId: req.user.id,
//                 content: formattedCrossPost.x.content,
//                 tweetId: xCrossPost?.tweetId || null,
//                 sourcePlatform: 'platform',
//                 mediaDetected,
//               });
//             }
//           } catch (crossErr) {
//             logger.error('[CREATE POST] X cross-post error', { userId: req.user.id, error: crossErr?.message || String(crossErr) });
//             crossPostResult.x.status = 'failed';
//           }
//         }

//         if (normalizedCrossPostTargets.threads) {
//           try {
//             const threadsCrossPost = await crossPostToThreads({
//               userId: req.user.id,
//               content: formattedCrossPost.threads.content,
//               mediaDetected,
//               optimizeCrossPost,
//               media: normalizedCrossPostMedia,
//             });
//             crossPostResult.threads = {
//               ...crossPostResult.threads,
//               ...threadsCrossPost,
//               status: threadsCrossPost?.status || 'failed',
//             };
//           } catch (crossErr) {
//             logger.error('[CREATE POST] Threads cross-post error', { userId: req.user.id, error: crossErr?.message || String(crossErr) });
//             crossPostResult.threads.status = 'failed';
//           }
//         }
//       }
//     }

//     logger.info('[CREATE POST] Cross-post completed', {
//       userId: req.user.id,
//       x: crossPostResult.x.status,
//       threads: crossPostResult.threads.status,
//       mediaDetected,
//       selectedTeamAccount: Boolean(selectedTeamAccount),
//     });

//     res.json({ success: true, post: rows[0], linkedin: result, crossPost: crossPostResult, twitter: crossPostResult.x.status });
//   } catch (error) {
//     console.error('[CREATE POST ERROR]', error && (error.stack || error.message || error.toString()));
//     res.status(500).json({ error: error.message || 'Failed to post to LinkedIn', details: error && (error.stack || error.toString()) });
//   }
// }

// // Fetch user's LinkedIn posts
// export async function getPosts(req, res) {
//   try {
//     const { page = 1, limit = 20, status } = req.query;
//     const offset = (page - 1) * limit;
//     const selectedAccountId = req.headers['x-selected-account-id'];
//     const preferredTeamIds = getUserTeamHints(req.user);
//     let selectedTeamAccount = await resolveTeamAccountForUser(req.user.id, selectedAccountId);
//     if (!selectedTeamAccount) {
//       selectedTeamAccount = await resolveDefaultTeamAccountForUser(req.user.id, { preferredTeamIds });
//     }
//     let whereClause;
//     let params = [];
//     if (selectedTeamAccount) {
//       // Team account mode: only show posts created for this team account scope.
//       whereClause = 'WHERE company_id::text = ANY($1::text[])';
//       params = [[String(selectedTeamAccount.team_id), String(selectedTeamAccount.id)]];
//     } else {
//       // Personal fallback: always show user's posts (prevents stale browser headers from hiding data).
//       whereClause = 'WHERE user_id = $1';
//       params = [req.user.id];
//     }
//     if (status && status !== 'all') {
//       whereClause += ` AND status = $${params.length + 1}`;
//       params.push(status);
//     }
//     const sql = `SELECT * FROM linkedin_posts ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
//     const sqlParams = [...params, limit, offset];
//     console.log('DEBUG getPosts SQL:', sql, sqlParams);
//     const { rows } = await pool.query(sql, sqlParams);
//     console.log('DEBUG getPosts returned rows:', rows);
//     // Get total count
//     const countResult = await pool.query(
//       `SELECT COUNT(*) FROM linkedin_posts ${whereClause}`,
//       params
//     );
//     res.json({
//       posts: rows,
//       pagination: {
//         page: parseInt(page),
//         limit: parseInt(limit),
//         total: parseInt(countResult.rows[0].count),
//         pages: Math.ceil(countResult.rows[0].count / limit)
//       }
//     });
//   } catch (error) {
//     console.error('Error in getPosts:', error);
//     res.status(500).json({ error: 'Failed to fetch LinkedIn posts', details: error.message });
//   }
// }

// // Delete a LinkedIn post
// export async function deletePost(req, res) {
//   try {
//     const { id } = req.params;
//     const user = req.user;
//     const userId = user?.id;
//     console.log(`[DELETE POST] Request received for post id: ${id}, user id: ${userId}`);
    
//     if (!userId) {
//       console.error('[DELETE POST] No userId found in request. Auth/session missing.');
//       return res.status(401).json({ error: 'Unauthorized: No userId' });
//     }
    
//     // Get account_id from headers only (DELETE requests don't have body)
//     const accountId = req.headers['x-selected-account-id'];
//     const preferredTeamIds = getUserTeamHints(req.user);
//     let selectedTeamAccount = await resolveTeamAccountForUser(userId, accountId, { allowedRoles: ['owner', 'admin'] });
//     if (!selectedTeamAccount && !isMeaningfulAccountId(accountId)) {
//       selectedTeamAccount = await resolveDefaultTeamAccountForUser(userId, {
//         allowedRoles: ['owner', 'admin'],
//         preferredTeamIds
//       });
//     }
    
//     // Try to find post by user first
//     let { rows } = await pool.query(
//       'SELECT * FROM linkedin_posts WHERE id = $1 AND user_id = $2',
//       [id, userId]
//     );
//     if (rows.length === 0) {
//       rows = (await pool.query(
//         'SELECT * FROM linkedin_posts WHERE linkedin_post_id = $1 AND user_id = $2',
//         [id, userId]
//       )).rows;
//     }

//     // If not found, try to find post by company_id and check team membership/role (only owner/admin can delete)
//     if (rows.length === 0) {
//       if (selectedTeamAccount) {
//         rows = (await pool.query(
//           `SELECT p.* FROM linkedin_posts p
//            WHERE (p.id::text = $1::text OR p.linkedin_post_id::text = $1::text)
//              AND p.company_id::text = ANY($2::text[])`,
//           [id, [String(selectedTeamAccount.team_id), String(selectedTeamAccount.id)]]
//         )).rows;
//       }
//     }

//     if (rows.length === 0) {
//       console.error(`[DELETE POST] Post not found for id/linkedin_post_id: ${id}, user id: ${userId}`);
//       // Extra debug: log all posts for this user/team
//       try {
//         const debugPosts = await pool.query('SELECT * FROM linkedin_posts WHERE user_id = $1 OR company_id = $2', [userId, accountId]);
//         console.error('[DELETE POST] All posts for user/team:', debugPosts.rows);
//       } catch (debugErr) {
//         console.error('[DELETE POST] Error fetching debug posts:', debugErr);
//       }
//       return res.status(404).json({ error: 'Post not found', debug: 'See server logs for all posts for this user/team.' });
//     }

//     const post = rows[0];
//     let postUrn = post.linkedin_post_id;
//     if (postUrn && !postUrn.startsWith('urn:li:share:')) {
//       postUrn = `urn:li:share:${postUrn}`;
//     }
    
//     console.log(`[DELETE POST] Attempting to delete LinkedIn post with URN: ${postUrn}`);
    
//     // Get access token for the LinkedIn user who created the post (with refresh context)
//     let tokenSource = await resolveDeleteLinkedInTokenSource({ post, userId, user });
//     let accessToken = tokenSource?.accessToken || null;

//     if (!accessToken) {
//       console.error('[DELETE POST ERROR] No access token available', { accountId, userId });
//       return res.status(400).json({ error: 'LinkedIn account not connected' });
//     }

//     console.log(`[DELETE POST] Access token: ${accessToken ? '[REDACTED]' : 'MISSING'}`);

//     try {
//       console.log(`[DELETE POST] Attempting LinkedIn API delete for postUrn: ${postUrn}, accessToken: ${accessToken ? '[REDACTED]' : 'MISSING'}`);
//       let apiResult;
//       try {
//         apiResult = await linkedinService.deleteLinkedInPost(accessToken, postUrn);
//       } catch (apiError) {
//         const canRetryWithRefresh = isLinkedInUnauthorizedError(apiError) && Boolean(tokenSource?.refreshToken);
//         if (!canRetryWithRefresh) {
//           throw apiError;
//         }

//         console.warn('[DELETE POST] LinkedIn delete failed with auth error. Attempting token refresh + retry...', {
//           userId,
//           postId: id,
//           tokenSource: tokenSource?.kind || 'unknown',
//           linkedinUserId: post.linkedin_user_id || null,
//         });

//         try {
//           tokenSource = await refreshLinkedInTokenForSource(tokenSource, userId);
//           accessToken = tokenSource.accessToken;
//           apiResult = await linkedinService.deleteLinkedInPost(accessToken, postUrn);
//         } catch (refreshRetryError) {
//           const refreshRetryPayload = refreshRetryError?.response?.data || null;
//           const refreshRetryStatus = Number(refreshRetryError?.response?.status || 0);
//           const reconnectRequired = isLinkedInUnauthorizedError(refreshRetryError) || isLinkedInUnauthorizedError(apiError);

//           if (reconnectRequired) {
//             return res.status(401).json({
//               error: 'LinkedIn token revoked/expired. Please reconnect your LinkedIn account and try again.',
//               code: 'LINKEDIN_TOKEN_RECONNECT_REQUIRED',
//               details: refreshRetryError?.message || apiError?.message || 'Unauthorized',
//               provider: refreshRetryPayload || apiError?.response?.data || null,
//             });
//           }

//           if (refreshRetryStatus) {
//             throw refreshRetryError;
//           }
//           throw apiError;
//         }
//       }
//       console.log(`[DELETE POST] LinkedIn API response:`, apiResult);
//       await pool.query(
//         'UPDATE linkedin_posts SET status = $1, updated_at = NOW() WHERE id = $2',
//         ['deleted', id]
//       );
//       console.log(`[DELETE POST] Post deleted successfully for id: ${id}`);
//       res.json({ success: true, message: 'Post deleted successfully', apiResult });
//     } catch (apiError) {
//       console.error(`[DELETE POST] Failed to delete post from LinkedIn:`);
//       console.error(`[DELETE POST] URN: ${postUrn}`);
//       console.error(`[DELETE POST] Access token: ${accessToken ? '[REDACTED]' : 'MISSING'}`);
//       if (apiError.response) {
//         console.error(`[DELETE POST] LinkedIn API error response:`, apiError.response.data);
//       }
//       console.error(`[DELETE POST] Error message:`, apiError.message);
//       console.error(`[DELETE POST] Stack:`, apiError.stack);
//       const status = isLinkedInUnauthorizedError(apiError) ? 401 : 400;
//       const code = isLinkedInUnauthorizedError(apiError) ? 'LINKEDIN_TOKEN_RECONNECT_REQUIRED' : undefined;
//       res.status(status).json({ error: 'Failed to delete post from LinkedIn', details: apiError.message, code, stack: apiError.stack, urn: postUrn });
//     }
//   } catch (error) {
//     console.error(`[DELETE POST] Internal error:`, error.message);
//     console.error(`[DELETE POST] Stack:`, error.stack);
//     res.status(500).json({ error: 'Failed to delete post', details: error.message, stack: error.stack });
//   }
//   }

// // AI content generation for LinkedIn posts
// export async function aiGenerate(req, res) {
//   try {
//     const { prompt, style, hashtags, mentions, max_posts } = req.body;
//     // TODO: Integrate with AI service for LinkedIn post generation
//     // Placeholder: return a mock post
//     const generated = [
//       {
//         post_content: `LinkedIn AI generated post for: ${prompt}`,
//         style,
//         hashtags,
//         mentions
//       }
//     ];
//     res.json({ success: true, posts: generated });
//   } catch (error) {
//     res.status(500).json({ error: 'Failed to generate AI content' });
//   }
// }


import { pool } from '../config/database.js';
import * as linkedinService from '../services/linkedinService.js';
import { logger } from '../utils/logger.js';
import { buildCrossPostPayloads, detectCrossPostMedia } from '../utils/crossPostOptimizer.js';
import {
  getUserTeamHints,
  isMeaningfulAccountId,
  resolveDefaultTeamAccountForUser,
  resolveTeamAccountForUser
} from '../utils/teamAccountScope.js';

const X_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.X_CROSSPOST_TIMEOUT_MS || '10000', 10);
const THREADS_CROSSPOST_TIMEOUT_MS = Number.parseInt(process.env.THREADS_CROSSPOST_TIMEOUT_MS || '10000', 10);
const INTERNAL_CALLER = 'linkedin-genie';

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

const getSocialLinkedInMetadata = (row = {}) =>
  row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

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

const buildSocialTokenSourceFromRow = (row = {}) => {
  const metadata = getSocialLinkedInMetadata(row);
  const teamId = normalizeOptionalString(row.team_id, 128);
  const sourceTable = normalizeOptionalString(metadata?.source_table, 80);
  const legacyPersonalRowId =
    normalizeOptionalString(metadata?.legacy_personal_row_id, 128) ||
    normalizeOptionalString(metadata?.legacy_row_id, 128);

  return {
    kind: teamId ? 'team_social' : 'personal_social',
    socialId: String(row.id),
    teamId,
    userId: normalizeOptionalString(row.user_id, 128),
    accessToken: row?.access_token || null,
    refreshToken: row?.refresh_token || null,
    tokenExpiresAt: row?.token_expires_at || null,
    linkedinUserId: getSocialLinkedInUserId(row),
    sourceTable,
    legacyTeamAccountId: getSocialLegacyTeamAccountId(row),
    legacyPersonalRowId,
  };
};

async function refreshLinkedInTokenForSource(tokenSource, userId) {
  if (!tokenSource?.refreshToken) {
    throw new Error('No refresh token available for LinkedIn account');
  }

  const refreshed = await linkedinService.refreshLinkedInAccessToken(tokenSource.refreshToken);
  const newAccessToken = String(refreshed?.access_token || '').trim();
  if (!newAccessToken) {
    throw new Error('LinkedIn refresh did not return an access token');
  }

  const newRefreshToken = String(refreshed?.refresh_token || tokenSource.refreshToken || '').trim() || tokenSource.refreshToken;
  const expiresIn = Number(refreshed?.expires_in || 0);
  const newExpiry = Number.isFinite(expiresIn) && expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000)
    : null;

  if ((tokenSource.kind === 'team_social' || tokenSource.kind === 'personal_social') && tokenSource.socialId) {
    await pool.query(
      `UPDATE social_connected_accounts
       SET access_token = $1,
           refresh_token = $2,
           token_expires_at = $3,
           updated_at = NOW()
       WHERE id::text = $4::text`,
      [newAccessToken, newRefreshToken, newExpiry, String(tokenSource.socialId)]
    );

    if (tokenSource.sourceTable === 'linkedin_team_accounts' && tokenSource.legacyTeamAccountId) {
      await pool.query(
        `UPDATE linkedin_team_accounts
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [newAccessToken, newRefreshToken, newExpiry, tokenSource.legacyTeamAccountId]
      );
    } else if (tokenSource.sourceTable === 'linkedin_auth' && tokenSource.legacyPersonalRowId) {
      await pool.query(
        `UPDATE linkedin_auth
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = NOW()
         WHERE id::text = $4::text`,
        [newAccessToken, newRefreshToken, newExpiry, tokenSource.legacyPersonalRowId]
      );
    } else if (tokenSource.kind === 'personal_social' && userId) {
      await pool.query(
        `UPDATE linkedin_auth
         SET access_token = $1,
             refresh_token = $2,
             token_expires_at = $3,
             updated_at = NOW()
         WHERE user_id = $4`,
        [newAccessToken, newRefreshToken, newExpiry, userId]
      );
    }
  } else if (tokenSource.kind === 'team' && tokenSource.id) {
    await pool.query(
      `UPDATE linkedin_team_accounts
       SET access_token = $1,
           refresh_token = $2,
           token_expires_at = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [newAccessToken, newRefreshToken, newExpiry, tokenSource.id]
    );
  } else {
    await pool.query(
      `UPDATE linkedin_auth
       SET access_token = $1,
           refresh_token = $2,
           token_expires_at = $3,
           updated_at = NOW()
       WHERE user_id = $4`,
      [newAccessToken, newRefreshToken, newExpiry, userId]
    );
  }

  return {
    ...tokenSource,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    tokenExpiresAt: newExpiry,
  };
}

const normalizeCrossPostTargets = ({ crossPostTargets = null, postToTwitter = false, postToX = false } = {}) => {
  const raw =
    crossPostTargets && typeof crossPostTargets === 'object' && !Array.isArray(crossPostTargets)
      ? crossPostTargets
      : {};

  return {
    x:
      typeof raw.x === 'boolean'
        ? raw.x
        : (typeof raw.twitter === 'boolean' ? raw.twitter : Boolean(postToTwitter || postToX)),
    threads: typeof raw.threads === 'boolean' ? raw.threads : false,
  };
};

const normalizeCrossPostTargetAccountIds = ({ crossPostTargetAccountIds = null } = {}) => {
  const raw =
    crossPostTargetAccountIds && typeof crossPostTargetAccountIds === 'object' && !Array.isArray(crossPostTargetAccountIds)
      ? crossPostTargetAccountIds
      : {};

  const normalize = (value) => {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  };

  return {
    x: normalize(raw.x ?? raw.twitter),
    threads: normalize(raw.threads),
  };
};

const normalizeCrossPostMedia = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 4);
};

const buildCrossPostResultShape = ({ xEnabled = false, threadsEnabled = false, mediaDetected = false } = {}) => ({
  x: {
    enabled: Boolean(xEnabled),
    status: xEnabled ? null : 'disabled',
    mediaDetected: Boolean(mediaDetected),
    mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
  },
  threads: {
    enabled: Boolean(threadsEnabled),
    status: threadsEnabled ? null : 'disabled',
    mediaDetected: Boolean(mediaDetected),
    mediaStatus: mediaDetected ? 'text_only_phase1' : 'none',
  },
});

const buildInternalServiceHeaders = ({ userId, internalApiKey, teamId = null }) => ({
  'Content-Type': 'application/json',
  'x-internal-api-key': internalApiKey,
  'x-internal-caller': INTERNAL_CALLER,
  'x-platform-user-id': String(userId),
  ...(teamId ? { 'x-platform-team-id': String(teamId) } : {}),
});

const buildInternalServiceEndpoint = (baseUrl, path) =>
  `${String(baseUrl || '').trim().replace(/\/$/, '')}${path}`;

async function postInternalJson({ endpoint, userId, teamId = null, internalApiKey, payload, timeoutMs = 0 }) {
  const controller = Number.isFinite(timeoutMs) && timeoutMs > 0 ? new AbortController() : null;
  let timeoutId = null;

  try {
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: buildInternalServiceHeaders({ userId, internalApiKey, teamId }),
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });

    const body = await response.json().catch(() => ({}));
    return { response, body };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const buildPersonalTokenSourceFromRow = (row, userId) => ({
  kind: 'personal',
  userId,
  accessToken: row?.access_token || null,
  refreshToken: row?.refresh_token || null,
  tokenExpiresAt: row?.token_expires_at || null,
});

const buildTeamTokenSourceFromRow = (row) => ({
  kind: 'team',
  id: row?.id || null,
  accessToken: row?.access_token || null,
  refreshToken: row?.refresh_token || null,
  tokenExpiresAt: row?.token_expires_at || null,
});

async function resolvePersonalLinkedInTokenSource(userId, user) {
  const socialTokenResult = await pool.query(
    `SELECT id, user_id, team_id, account_id, metadata, access_token, refresh_token, token_expires_at
     FROM social_connected_accounts
     WHERE user_id::text = $1::text
       AND team_id IS NULL
       AND platform = 'linkedin'
       AND is_active = true
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [userId]
  );

  if (socialTokenResult.rows.length > 0) {
    return buildSocialTokenSourceFromRow(socialTokenResult.rows[0]);
  }

  const personalTokenResult = await pool.query(
    `SELECT access_token, refresh_token, token_expires_at
     FROM linkedin_auth
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (personalTokenResult.rows.length > 0) {
    return buildPersonalTokenSourceFromRow(personalTokenResult.rows[0], userId);
  }

  return {
    kind: 'session',
    userId,
    accessToken: user?.linkedinAccessToken || null,
    refreshToken: null,
    tokenExpiresAt: null,
  };
}

async function resolveDeleteLinkedInTokenSource({ post, userId, user }) {
  if (post?.linkedin_user_id) {
    const socialTeamTokenResult = await pool.query(
      `SELECT id, user_id, team_id, account_id, metadata, access_token, refresh_token, token_expires_at
       FROM social_connected_accounts
       WHERE platform = 'linkedin'
         AND team_id IS NOT NULL
         AND is_active = true
         AND COALESCE(
               NULLIF(metadata->>'linkedin_user_id', ''),
               CASE
                 WHEN account_id LIKE 'org:%' THEN NULL
                 ELSE account_id
               END
             ) = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [post.linkedin_user_id]
    );

    if (socialTeamTokenResult.rows.length > 0) {
      console.log('[DELETE POST] Using team social account token for linkedin_user_id:', post.linkedin_user_id);
      return buildSocialTokenSourceFromRow(socialTeamTokenResult.rows[0]);
    }

    const teamTokenResult = await pool.query(
      `SELECT id, access_token, refresh_token, token_expires_at
       FROM linkedin_team_accounts
       WHERE linkedin_user_id = $1 AND active = true
       ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [post.linkedin_user_id]
    );

    if (teamTokenResult.rows.length > 0) {
      console.log('[DELETE POST] Using access token for linkedin_user_id:', post.linkedin_user_id);
      return buildTeamTokenSourceFromRow(teamTokenResult.rows[0]);
    }

    console.log('[DELETE POST] Fallback to personal account for user:', userId);
    return resolvePersonalLinkedInTokenSource(userId, user);
  }

  console.log('[DELETE POST] Using personal account for user:', userId);
  return resolvePersonalLinkedInTokenSource(userId, user);
}

async function markLinkedInTokenSourceDisconnected(tokenSource) {
  if (!tokenSource) return;

  if ((tokenSource.kind === 'team_social' || tokenSource.kind === 'personal_social') && tokenSource.socialId) {
    await pool.query(
      `UPDATE social_connected_accounts
       SET is_active = false,
           access_token = NULL,
           refresh_token = NULL,
           token_expires_at = NULL,
           updated_at = NOW()
       WHERE id::text = $1::text`,
      [String(tokenSource.socialId)]
    );

    if (tokenSource.sourceTable === 'linkedin_team_accounts' && tokenSource.legacyTeamAccountId) {
      await pool.query(
        `UPDATE linkedin_team_accounts
         SET active = false,
             access_token = NULL,
             refresh_token = NULL,
             token_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [tokenSource.legacyTeamAccountId]
      );
    } else if (tokenSource.sourceTable === 'linkedin_auth' && tokenSource.legacyPersonalRowId) {
      await pool.query(
        `UPDATE linkedin_auth
         SET access_token = NULL,
             refresh_token = NULL,
             token_expires_at = NULL,
             updated_at = NOW()
         WHERE id::text = $1::text`,
        [tokenSource.legacyPersonalRowId]
      );
    } else if (tokenSource.userId) {
      await pool.query(
        `UPDATE linkedin_auth
         SET access_token = NULL,
             refresh_token = NULL,
             token_expires_at = NULL,
             updated_at = NOW()
         WHERE user_id = $1`,
        [tokenSource.userId]
      );
    }

    return;
  }

  if (tokenSource.kind === 'team' && tokenSource.id) {
    await pool.query(
      `UPDATE linkedin_team_accounts
       SET active = false,
           access_token = NULL,
           refresh_token = NULL,
           token_expires_at = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [tokenSource.id]
    );
    return;
  }

  if (tokenSource.kind === 'personal' && tokenSource.userId) {
    await pool.query(
      `UPDATE linkedin_auth
       SET access_token = NULL,
           refresh_token = NULL,
           token_expires_at = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [tokenSource.userId]
    );
  }
}

// CHANGE 1: Added postMode and threadParts parameters for X thread support
function resolveTweetGenieInternalBaseUrl() {
  const configuredUrl = String(process.env.TWEET_GENIE_URL || '').trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    return 'http://localhost:3002';
  }

  return '';
}

async function crossPostToX({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  postMode = 'single',
  threadParts = [],
  mediaDetected = false,
  media = [],
}) {
  const tweetGenieUrl = resolveTweetGenieInternalBaseUrl();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    logger.warn('[X Cross-post] Skipped: missing TWEET_GENIE_URL or INTERNAL_API_KEY');
    return { status: 'skipped_not_configured' };
  }

  const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/cross-post');

  try {
    const { response, body } = await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      timeoutMs: X_CROSSPOST_TIMEOUT_MS,
      // CHANGE 2: Pass postMode and threadParts through to Tweet Genie
      payload: {
        postMode,
        content,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        mediaDetected: Boolean(mediaDetected),
        sourcePlatform: 'linkedin',
        media: Array.isArray(media) ? media : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });

    if (!response.ok) {
      logger.warn('[X Cross-post] Failed', { status: response.status, code: body?.code });
      if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
        return { status: 'not_connected' };
      }
      if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
        return { status: 'not_connected' };
      }
      if (
        (response.status === 404 && String(body?.code || '').toUpperCase().includes('TARGET_ACCOUNT_NOT_FOUND')) ||
        (response.status === 403 && String(body?.code || '').toUpperCase().includes('TARGET_ACCOUNT_FORBIDDEN'))
      ) {
        return { status: 'target_not_found' };
      }
      if (response.status === 400 && String(body?.code || '').toUpperCase() === 'X_POST_TOO_LONG') {
        return { status: 'failed_too_long' };
      }
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }

    return {
      status: 'posted',
      tweetId: body?.tweetId || null,
      tweetUrl: body?.tweetUrl || null,
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      logger.warn('[X Cross-post] Timeout reached', { timeoutMs: X_CROSSPOST_TIMEOUT_MS, userId });
      return { status: 'timeout' };
    }
    logger.error('[X Cross-post] Request error', { userId, error: error?.message || String(error) });
    return { status: 'failed' };
  }
}

async function saveToTweetHistory({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  tweetId = null,
  sourcePlatform = 'platform',
  mediaDetected = false,
  media = [],
  postMode = 'single',
  threadParts = [],
}) {
  const tweetGenieUrl = resolveTweetGenieInternalBaseUrl();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!tweetGenieUrl || !internalApiKey) {
    return;
  }

  const endpoint = buildInternalServiceEndpoint(tweetGenieUrl, '/api/internal/twitter/save-to-history');

  try {
    await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      payload: {
        content,
        tweetId,
        mediaDetected: Boolean(mediaDetected),
        sourcePlatform,
        media: Array.isArray(media) ? media : [],
        postMode,
        threadParts: Array.isArray(threadParts) ? threadParts : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });
  } catch (error) {
    logger.warn('[save-to-history] Failed silently', {
      userId,
      error: error?.message || String(error),
    });
  }
}

async function crossPostToThreads({
  userId,
  teamId = null,
  targetAccountId = null,
  content,
  mediaDetected = false,
  optimizeCrossPost = true,
  media = [],
}) {
  const socialGenieUrl = String(process.env.SOCIAL_GENIE_URL || '').trim();
  const internalApiKey = String(process.env.INTERNAL_API_KEY || '').trim();

  if (!socialGenieUrl || !internalApiKey) {
    logger.warn('[Threads Cross-post] Skipped: missing SOCIAL_GENIE_URL or INTERNAL_API_KEY');
    return { status: 'skipped_not_configured' };
  }

  const endpoint = buildInternalServiceEndpoint(socialGenieUrl, '/api/internal/threads/cross-post');

  try {
    const { response, body } = await postInternalJson({
      endpoint,
      userId,
      teamId,
      internalApiKey,
      timeoutMs: THREADS_CROSSPOST_TIMEOUT_MS,
      payload: {
        postMode: 'single',
        content,
        threadParts: [],
        sourcePlatform: 'linkedin',
        optimizeCrossPost: optimizeCrossPost !== false,
        mediaDetected: Boolean(mediaDetected),
        media: Array.isArray(media) ? media : [],
        ...(targetAccountId ? { targetAccountId: String(targetAccountId) } : {}),
      },
    });

    if (!response.ok) {
      logger.warn('[Threads Cross-post] Failed', { status: response.status, code: body?.code });
      if (response.status === 404 && String(body?.code || '').toUpperCase().includes('NOT_CONNECTED')) {
        return { status: 'not_connected' };
      }
      if (response.status === 401 && String(body?.code || '').toUpperCase().includes('TOKEN_EXPIRED')) {
        return { status: 'not_connected' };
      }
      return {
        status: 'failed',
        mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : undefined,
        mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : undefined,
      };
    }

    return {
      status: 'posted',
      mediaStatus: typeof body?.mediaStatus === 'string' ? body.mediaStatus : (mediaDetected ? 'posted' : 'none'),
      mediaCount: Number.isFinite(Number(body?.mediaCount)) ? Number(body.mediaCount) : (mediaDetected ? undefined : 0),
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      logger.warn('[Threads Cross-post] Timeout reached', { timeoutMs: THREADS_CROSSPOST_TIMEOUT_MS, userId });
      return { status: 'timeout' };
    }
    logger.error('[Threads Cross-post] Request error', { userId, error: error?.message || String(error) });
    return { status: 'failed' };
  }
}

// Create a LinkedIn post (with media, carousels, etc.)
export async function createPost(req, res) {
  console.log('[CREATE POST] Route called, req.body:', req.body, 'headers:', req.headers);
  try {
    const user = req.user;
    if (!user) {
      console.error('[CREATE POST ERROR] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get account_id from request (for team accounts)
    const accountId = req.body.account_id || req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    let selectedTeamAccount = await resolveTeamAccountForUser(user.id, accountId);

    if (!selectedTeamAccount && !isMeaningfulAccountId(accountId)) {
      selectedTeamAccount = await resolveDefaultTeamAccountForUser(user.id, { preferredTeamIds });
    }
    
    let accessToken, authorUrn, teamAccountResult;
    
    if (isMeaningfulAccountId(accountId) && !selectedTeamAccount) {
      return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
    }
    
    // If account_id is provided and valid, use the validated team credentials
    if (selectedTeamAccount) {
      teamAccountResult = { rows: [selectedTeamAccount] };
      accessToken = selectedTeamAccount.access_token;
      authorUrn = `urn:li:person:${selectedTeamAccount.linkedin_user_id}`;
      console.log('[CREATE POST] Using team account credentials');
    } else {
      // Fallback to personal account
      accessToken = user.linkedinAccessToken;
      authorUrn = user.linkedinUrn;
      console.log('[CREATE POST] Using personal account for user:', user.id);
    }
    
    if (!accessToken || !authorUrn) {
      console.error('[CREATE POST ERROR] LinkedIn account not connected', { 
        hasAccessToken: !!accessToken, 
        hasAuthorUrn: !!authorUrn, 
        accountId,
        userId: user.id,
        hasPersonalToken: !!user.linkedinAccessToken
      });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    let {
      post_content,
      media_urls = [],
      post_type = 'single_post',
      company_id,
      crossPostTargets = null,
      optimizeCrossPost = true,
      postToTwitter = false,
      postToX = false,
      crossPostTargetAccountIds = null,
      crossPostMedia = [],
    } = req.body;
    const normalizedCrossPostTargets = normalizeCrossPostTargets({ crossPostTargets, postToTwitter, postToX });
    const normalizedCrossPostTargetAccountIds = normalizeCrossPostTargetAccountIds({ crossPostTargetAccountIds });
    const normalizedCrossPostMedia = normalizeCrossPostMedia(crossPostMedia);
    const crossPostTeamId = selectedTeamAccount?.team_id ? String(selectedTeamAccount.team_id) : null;
    // If posting to a team account, set company_id to selectedAccountId
    if (selectedTeamAccount) {
      company_id = selectedTeamAccount.team_id;
    }
    if (!post_content) return res.status(400).json({ error: 'Post content is required' });

    // Call LinkedIn API to create post
    const result = await linkedinService.createLinkedInPost(accessToken, authorUrn, post_content, media_urls, post_type, company_id);

    // Determine linkedin_user_id (the LinkedIn user who created the post)
    let linkedin_user_id = null;
    if (selectedTeamAccount) {
      // Team account: get from teamAccountResult
      linkedin_user_id = teamAccountResult.rows[0].linkedin_user_id;
    } else {
      // Personal account
      linkedin_user_id = user.linkedinUserId || user.linkedin_user_id;
    }

    console.log('[CREATE POST] LinkedIn API success, saving to DB:', {
      userId: user.id,
      accountId: accountId || 'personal',
      linkedin_post_id: result.id || result.urn,
      post_content,
      media_urls,
      post_type,
      company_id,
      linkedin_user_id
    });

    // Save to DB without initial metrics - will be populated by real analytics sync
    const { rows } = await pool.query(
      `INSERT INTO linkedin_posts (user_id, account_id, linkedin_post_id, post_content, media_urls, post_type, company_id, linkedin_user_id, status, views, likes, comments, shares, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'posted', 0, 0, 0, 0, NOW(), NOW())
       RETURNING *`,
      [
        req.user.id,
        selectedTeamAccount?.id || null,
        result.id || result.urn,
        post_content,
        JSON.stringify(media_urls),
        post_type,
        company_id,
        linkedin_user_id
      ]
    );
    console.log('[CREATE POST] Inserted into linkedin_posts:', rows[0]);

    const mediaDetected = detectCrossPostMedia({ mediaUrls: media_urls });
    const crossPostResult = buildCrossPostResultShape({
      xEnabled: normalizedCrossPostTargets.x,
      threadsEnabled: normalizedCrossPostTargets.threads,
      mediaDetected,
    });

    if (normalizedCrossPostTargets.x || normalizedCrossPostTargets.threads) {
      const formattedCrossPost = buildCrossPostPayloads({
        content: post_content,
        optimizeCrossPost,
      });

      if (normalizedCrossPostTargets.x) {
        try {
          // CHANGE 3: Pass postMode and threadParts from optimizer output
          const xCrossPost = await crossPostToX({
            userId: req.user.id,
            teamId: crossPostTeamId,
            targetAccountId: normalizedCrossPostTargetAccountIds.x,
            content: formattedCrossPost.x.content,
            postMode: formattedCrossPost.x.postMode,
            threadParts: formattedCrossPost.x.threadParts || [],
            mediaDetected,
            media: normalizedCrossPostMedia,
          });
          crossPostResult.x = {
            ...crossPostResult.x,
            ...xCrossPost,
            status: xCrossPost?.status || 'failed',
          };

          if (crossPostResult.x.status === 'posted') {
            await saveToTweetHistory({
              userId: req.user.id,
              teamId: crossPostTeamId,
              targetAccountId: normalizedCrossPostTargetAccountIds.x,
              content: formattedCrossPost.x.content,
              tweetId: xCrossPost?.tweetId || null,
              sourcePlatform: 'linkedin',
              mediaDetected,
              media: normalizedCrossPostMedia,
              postMode: formattedCrossPost.x.postMode,
              threadParts: formattedCrossPost.x.threadParts || [],
            });
          }
        } catch (crossErr) {
          logger.error('[CREATE POST] X cross-post error', { userId: req.user.id, error: crossErr?.message || String(crossErr) });
          crossPostResult.x.status = 'failed';
        }
      }

      if (normalizedCrossPostTargets.threads) {
        try {
          const threadsCrossPost = await crossPostToThreads({
            userId: req.user.id,
            teamId: crossPostTeamId,
            targetAccountId: normalizedCrossPostTargetAccountIds.threads,
            content: formattedCrossPost.threads.content,
            mediaDetected,
            optimizeCrossPost,
            media: normalizedCrossPostMedia,
          });
          crossPostResult.threads = {
            ...crossPostResult.threads,
            ...threadsCrossPost,
            status: threadsCrossPost?.status || 'failed',
          };
        } catch (crossErr) {
          logger.error('[CREATE POST] Threads cross-post error', { userId: req.user.id, error: crossErr?.message || String(crossErr) });
          crossPostResult.threads.status = 'failed';
        }
      }
    }

    logger.info('[CREATE POST] Cross-post completed', {
      userId: req.user.id,
      x: crossPostResult.x.status,
      threads: crossPostResult.threads.status,
      mediaDetected,
      selectedTeamAccount: Boolean(selectedTeamAccount),
    });

    res.json({ success: true, post: rows[0], linkedin: result, crossPost: crossPostResult, twitter: crossPostResult.x.status });
  } catch (error) {
    console.error('[CREATE POST ERROR]', error && (error.stack || error.message || error.toString()));
    res.status(500).json({ error: error.message || 'Failed to post to LinkedIn', details: error && (error.stack || error.toString()) });
  }
}

// Fetch user's LinkedIn posts
export async function getPosts(req, res) {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    let selectedTeamAccount = await resolveTeamAccountForUser(req.user.id, selectedAccountId);
    if (!selectedTeamAccount) {
      selectedTeamAccount = await resolveDefaultTeamAccountForUser(req.user.id, { preferredTeamIds });
    }
    let whereClause;
    let params = [];
    if (selectedTeamAccount) {
      // Team account mode: only show posts created for this team account scope.
      whereClause = 'WHERE company_id::text = ANY($1::text[])';
      params = [[String(selectedTeamAccount.team_id), String(selectedTeamAccount.id)]];
    } else {
      // Personal fallback: only show personal-scope posts.
      whereClause = `WHERE user_id = $1 AND (company_id IS NULL OR company_id::text = '')`;
      params = [req.user.id];
    }
    if (status && status !== 'all') {
      whereClause += ` AND status = $${params.length + 1}`;
      params.push(status);
    }
    const sql = `SELECT * FROM linkedin_posts ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const sqlParams = [...params, limit, offset];
    console.log('DEBUG getPosts SQL:', sql, sqlParams);
    const { rows } = await pool.query(sql, sqlParams);
    console.log('DEBUG getPosts returned rows:', rows);
    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM linkedin_posts ${whereClause}`,
      params
    );
    res.json({
      posts: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error in getPosts:', error);
    res.status(500).json({ error: 'Failed to fetch LinkedIn posts', details: error.message });
  }
}

// Delete a LinkedIn post
export async function deletePost(req, res) {
  try {
    const { id } = req.params;
    const user = req.user;
    const userId = user?.id;
    console.log(`[DELETE POST] Request received for post id: ${id}, user id: ${userId}`);
    
    if (!userId) {
      console.error('[DELETE POST] No userId found in request. Auth/session missing.');
      return res.status(401).json({ error: 'Unauthorized: No userId' });
    }
    
    // Get account_id from headers only (DELETE requests don't have body)
    const accountId = req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    let selectedTeamAccount = await resolveTeamAccountForUser(userId, accountId, { allowedRoles: ['owner', 'admin'] });
    if (!selectedTeamAccount && !isMeaningfulAccountId(accountId)) {
      selectedTeamAccount = await resolveDefaultTeamAccountForUser(userId, {
        allowedRoles: ['owner', 'admin'],
        preferredTeamIds
      });
    }
    
    // Try to find post by user first
    let { rows } = await pool.query(
      'SELECT * FROM linkedin_posts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rows.length === 0) {
      rows = (await pool.query(
        'SELECT * FROM linkedin_posts WHERE linkedin_post_id = $1 AND user_id = $2',
        [id, userId]
      )).rows;
    }

    // If not found, try to find post by company_id and check team membership/role (only owner/admin can delete)
    if (rows.length === 0) {
      if (selectedTeamAccount) {
        rows = (await pool.query(
          `SELECT p.* FROM linkedin_posts p
           WHERE (p.id::text = $1::text OR p.linkedin_post_id::text = $1::text)
             AND p.company_id::text = ANY($2::text[])`,
          [id, [String(selectedTeamAccount.team_id), String(selectedTeamAccount.id)]]
        )).rows;
      }
    }

    if (rows.length === 0) {
      console.error(`[DELETE POST] Post not found for id/linkedin_post_id: ${id}, user id: ${userId}`);
      // Extra debug: log all posts for this user/team
      try {
        const debugPosts = await pool.query('SELECT * FROM linkedin_posts WHERE user_id = $1 OR company_id = $2', [userId, accountId]);
        console.error('[DELETE POST] All posts for user/team:', debugPosts.rows);
      } catch (debugErr) {
        console.error('[DELETE POST] Error fetching debug posts:', debugErr);
      }
      return res.status(404).json({ error: 'Post not found', debug: 'See server logs for all posts for this user/team.' });
    }

    const post = rows[0];
    let postUrn = post.linkedin_post_id;
    if (postUrn && !postUrn.startsWith('urn:li:share:')) {
      postUrn = `urn:li:share:${postUrn}`;
    }
    
    console.log(`[DELETE POST] Attempting to delete LinkedIn post with URN: ${postUrn}`);
    
    // Get access token for the LinkedIn user who created the post (with refresh context)
    let tokenSource = await resolveDeleteLinkedInTokenSource({ post, userId, user });
    let accessToken = tokenSource?.accessToken || null;

    if (!accessToken) {
      console.error('[DELETE POST ERROR] No access token available', { accountId, userId });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }

    console.log(`[DELETE POST] Access token: ${accessToken ? '[REDACTED]' : 'MISSING'}`);

    try {
      console.log(`[DELETE POST] Attempting LinkedIn API delete for postUrn: ${postUrn}, accessToken: ${accessToken ? '[REDACTED]' : 'MISSING'}`);
      let apiResult;
      try {
        apiResult = await linkedinService.deleteLinkedInPost(accessToken, postUrn);
      } catch (apiError) {
        const canRetryWithRefresh = isLinkedInUnauthorizedError(apiError) && Boolean(tokenSource?.refreshToken);
        if (!canRetryWithRefresh) {
          throw apiError;
        }

        console.warn('[DELETE POST] LinkedIn delete failed with auth error. Attempting token refresh + retry...', {
          userId,
          postId: id,
          tokenSource: tokenSource?.kind || 'unknown',
          linkedinUserId: post.linkedin_user_id || null,
        });

        try {
          tokenSource = await refreshLinkedInTokenForSource(tokenSource, userId);
          accessToken = tokenSource.accessToken;
          apiResult = await linkedinService.deleteLinkedInPost(accessToken, postUrn);
        } catch (refreshRetryError) {
          const refreshRetryPayload = refreshRetryError?.response?.data || null;
          const refreshRetryStatus = Number(refreshRetryError?.response?.status || 0);
          const reconnectRequired = isLinkedInUnauthorizedError(refreshRetryError) || isLinkedInUnauthorizedError(apiError);

          if (reconnectRequired) {
            // Mark the linked account as disconnected in DB to avoid future retries
            try {
              await markLinkedInTokenSourceDisconnected(tokenSource);
            } catch (dbErr) {
              console.error('[DELETE POST] Failed to mark LinkedIn account disconnected in DB', { error: dbErr?.message || String(dbErr) });
            }

            return res.status(401).json({
              error: 'LinkedIn token revoked/expired. Please reconnect your LinkedIn account and try again.',
              code: 'LINKEDIN_TOKEN_RECONNECT_REQUIRED',
              details: refreshRetryError?.message || apiError?.message || 'Unauthorized',
              provider: refreshRetryPayload || apiError?.response?.data || null,
            });
          }

          if (refreshRetryStatus) {
            throw refreshRetryError;
          }
          throw apiError;
        }
      }
      console.log(`[DELETE POST] LinkedIn API response:`, apiResult);
      await pool.query(
        'UPDATE linkedin_posts SET status = $1, updated_at = NOW() WHERE id = $2',
        ['deleted', id]
      );
      console.log(`[DELETE POST] Post deleted successfully for id: ${id}`);
      res.json({ success: true, message: 'Post deleted successfully', apiResult });
    } catch (apiError) {
      console.error(`[DELETE POST] Failed to delete post from LinkedIn:`);
      console.error(`[DELETE POST] URN: ${postUrn}`);
      console.error(`[DELETE POST] Access token: ${accessToken ? '[REDACTED]' : 'MISSING'}`);
      if (apiError.response) {
        console.error(`[DELETE POST] LinkedIn API error response:`, apiError.response.data);
      }
      console.error(`[DELETE POST] Error message:`, apiError.message);
      console.error(`[DELETE POST] Stack:`, apiError.stack);
      const status = isLinkedInUnauthorizedError(apiError) ? 401 : 400;
      const code = isLinkedInUnauthorizedError(apiError) ? 'LINKEDIN_TOKEN_RECONNECT_REQUIRED' : undefined;
      if (isLinkedInUnauthorizedError(apiError)) {
        // Attempt to mark the linked account disconnected in DB to avoid further failed calls
        try {
          await markLinkedInTokenSourceDisconnected(tokenSource);
        } catch (dbErr) {
          console.error('[DELETE POST] Failed to mark LinkedIn account disconnected in DB', { error: dbErr?.message || String(dbErr) });
        }
      }

      res.status(status).json({ error: 'Failed to delete post from LinkedIn', details: apiError.message, code, stack: apiError.stack, urn: postUrn });
    }
  } catch (error) {
    console.error(`[DELETE POST] Internal error:`, error.message);
    console.error(`[DELETE POST] Stack:`, error.stack);
    res.status(500).json({ error: 'Failed to delete post', details: error.message, stack: error.stack });
  }
  }

// AI content generation for LinkedIn posts
export async function aiGenerate(req, res) {
  try {
    const { prompt, style, hashtags, mentions, max_posts } = req.body;
    // TODO: Integrate with AI service for LinkedIn post generation
    // Placeholder: return a mock post
    const generated = [
      {
        post_content: `LinkedIn AI generated post for: ${prompt}`,
        style,
        hashtags,
        mentions
      }
    ];
    res.json({ success: true, posts: generated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate AI content' });
  }
}

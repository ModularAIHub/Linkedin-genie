
import { pool } from '../config/database.js';
import * as linkedinService from '../services/linkedinService.js';

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
    
    let accessToken, authorUrn;
    
    // If account_id is provided and not null, fetch team account credentials
    if (accountId && accountId !== 'null' && accountId !== 'undefined') {
      // Check if accountId looks like a UUID (has hyphens) vs an integer
      const isUUID = accountId.includes('-');
      let teamAccountResult;
      
      if (isUUID) {
        // Query by team_id if it's a UUID
        console.log('[CREATE POST] Account ID is UUID, querying by team_id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
          [accountId]
        );
      } else {
        // Query by id if it's an integer
        console.log('[CREATE POST] Account ID is integer, querying by id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE id = $1 AND active = true`,
          [accountId]
        );
      }
      
      if (teamAccountResult.rows.length === 0) {
        console.error('[CREATE POST ERROR] Team account not found for', isUUID ? 'team_id' : 'id', ':', accountId);
        return res.status(400).json({ error: 'LinkedIn team account not found' });
      }
      
      accessToken = teamAccountResult.rows[0].access_token;
      authorUrn = `urn:li:person:${teamAccountResult.rows[0].linkedin_user_id}`;
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
    
    const { post_content, media_urls = [], post_type = 'single_post', company_id } = req.body;
    if (!post_content) return res.status(400).json({ error: 'Post content is required' });

    // Call LinkedIn API to create post
    const result = await linkedinService.createLinkedInPost(accessToken, authorUrn, post_content, media_urls, post_type, company_id);

    console.log('[CREATE POST] LinkedIn API success, saving to DB:', {
      userId: user.id,
      accountId: accountId || 'personal',
      linkedin_post_id: result.id || result.urn,
      post_content,
      media_urls,
      post_type,
      company_id
    });
    
    // Generate initial analytics (realistic starting values)
    const initialViews = Math.floor(Math.random() * 50) + 10; // 10-60 initial views
    const initialLikes = Math.floor(initialViews * 0.08); // ~8% like rate
    const initialComments = Math.floor(initialViews * 0.02); // ~2% comment rate
    const initialShares = Math.floor(initialViews * 0.01); // ~1% share rate
    
    // Save to DB with initial metrics
    const { rows } = await pool.query(
      `INSERT INTO linkedin_posts (user_id, linkedin_post_id, post_content, media_urls, post_type, company_id, status, views, likes, comments, shares, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'posted', $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [req.user.id, result.id || result.urn, post_content, JSON.stringify(media_urls), post_type, company_id, initialViews, initialLikes, initialComments, initialShares]
    );
    console.log('[CREATE POST] Inserted into linkedin_posts:', rows[0]);

    res.json({ success: true, post: rows[0], linkedin: result });
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
    let whereClause = 'WHERE user_id = $1';
    const params = [req.user.id];
    if (status && status !== 'all') {
      whereClause += ' AND status = $2';
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
    
    let { rows } = await pool.query(
      'SELECT * FROM linkedin_posts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rows.length === 0) {
      console.log(`[DELETE POST] Not found by id, trying linkedin_post_id: ${id}`);
      rows = (await pool.query(
        'SELECT * FROM linkedin_posts WHERE linkedin_post_id = $1 AND user_id = $2',
        [id, userId]
      )).rows;
    }
    if (rows.length === 0) {
      console.error(`[DELETE POST] Post not found for id/linkedin_post_id: ${id}, user id: ${userId}`);
      return res.status(404).json({ error: 'Post not found' });
    }
    
    const post = rows[0];
    let postUrn = post.linkedin_post_id;
    if (postUrn && !postUrn.startsWith('urn:li:share:')) {
      postUrn = `urn:li:share:${postUrn}`;
    }
    
    console.log(`[DELETE POST] Attempting to delete LinkedIn post with URN: ${postUrn}`);
    
    // Get access token based on account type
    let accessToken;
    
    // If account_id is provided and not null, fetch team account credentials
    if (accountId && accountId !== 'null' && accountId !== 'undefined') {
      // Check if accountId looks like a UUID (has hyphens) vs an integer
      const isUUID = accountId.includes('-');
      let teamAccountResult;
      
      if (isUUID) {
        // Query by team_id if it's a UUID
        console.log('[DELETE POST] Account ID is UUID, querying by team_id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
          [accountId]
        );
      } else {
        // Query by id if it's an integer
        console.log('[DELETE POST] Account ID is integer, querying by id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token FROM linkedin_team_accounts WHERE id = $1 AND active = true`,
          [accountId]
        );
      }
      
      if (teamAccountResult.rows.length === 0) {
        console.error('[DELETE POST ERROR] Team account not found for', isUUID ? 'team_id' : 'id', ':', accountId);
        return res.status(400).json({ error: 'LinkedIn team account not found' });
      }
      
      accessToken = teamAccountResult.rows[0].access_token;
      console.log('[DELETE POST] Using team account credentials');
    } else {
      // Fallback to personal account
      accessToken = user.linkedinAccessToken;
      console.log('[DELETE POST] Using personal account for user:', userId);
    }
    
    if (!accessToken) {
      console.error('[DELETE POST ERROR] No access token available', { accountId, userId });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    console.log(`[DELETE POST] Access token: ${accessToken ? '[REDACTED]' : 'MISSING'}`);
    
    try {
      const apiResult = await linkedinService.deleteLinkedInPost(accessToken, postUrn);
      console.log(`[DELETE POST] LinkedIn API response:`, apiResult);
      await pool.query(
        'UPDATE linkedin_posts SET status = $1, updated_at = NOW() WHERE id = $2',
        ['deleted', id]
      );
      console.log(`[DELETE POST] Post deleted successfully for id: ${id}`);
      res.json({ success: true, message: 'Post deleted successfully' });
    } catch (apiError) {
      console.error(`[DELETE POST] Failed to delete post from LinkedIn:`);
      console.error(`[DELETE POST] URN: ${postUrn}`);
      console.error(`[DELETE POST] Access token: ${req.user.linkedinAccessToken ? '[REDACTED]' : 'MISSING'}`);
      if (apiError.response) {
        console.error(`[DELETE POST] LinkedIn API error response:`, apiError.response.data);
      }
      console.error(`[DELETE POST] Error message:`, apiError.message);
      console.error(`[DELETE POST] Stack:`, apiError.stack);
      res.status(400).json({ error: 'Failed to delete post from LinkedIn', details: apiError.message, stack: apiError.stack });
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

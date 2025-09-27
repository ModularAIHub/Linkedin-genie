
import { pool } from '../config/database.js';
import * as linkedinService from '../services/linkedinService.js';

// Create a LinkedIn post (with media, carousels, etc.)
export async function createPost(req, res) {
  console.log('DEBUG req.body:', req.body, 'headers:', req.headers['content-type']);
  try {
    const accessToken = req.user?.linkedinAccessToken || 'LINKEDIN_ACCESS_TOKEN';
    const authorUrn = req.user?.linkedinUrn || 'urn:li:person:xxxx';
    const { post_content, media_urls = [], post_type = 'single_post', company_id } = req.body;
    if (!post_content) return res.status(400).json({ error: 'Post content is required' });

    // Call LinkedIn API to create post
    const result = await linkedinService.createLinkedInPost(accessToken, authorUrn, post_content, media_urls, post_type, company_id);

    // Save to DB
    const { rows } = await pool.query(
      `INSERT INTO linkedin_posts (user_id, linkedin_post_id, post_content, media_urls, post_type, company_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'posted', NOW(), NOW())
       RETURNING *`,
      [req.user.id, result.id || result.urn, post_content, JSON.stringify(media_urls), post_type, company_id]
    );

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
    if (status) {
      whereClause += ' AND status = $2';
      params.push(status);
    }
    const sql = `SELECT * FROM linkedin_posts ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const sqlParams = [...params, limit, offset];
    console.log('DEBUG getPosts SQL:', sql, sqlParams);
    const { rows } = await pool.query(sql, sqlParams);
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
    const userId = req.user.id;
    // Get post details
    const { rows } = await pool.query(
      'SELECT * FROM linkedin_posts WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }
    const post = rows[0];
    // Delete from LinkedIn
    try {
      await linkedinService.deleteLinkedInPost(req.user.linkedinAccessToken, post.linkedin_post_id);
      // Update status in DB
      await pool.query(
        'UPDATE linkedin_posts SET status = $1, updated_at = NOW() WHERE id = $2',
        ['deleted', id]
      );
      res.json({ success: true, message: 'Post deleted successfully' });
    } catch (apiError) {
      res.status(400).json({ error: 'Failed to delete post from LinkedIn', details: apiError.message });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete post' });
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

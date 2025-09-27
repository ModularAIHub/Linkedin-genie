import { default as axios } from 'axios';
// (import already present at top)

// Helper: Get LinkedIn access token and URN for user
async function getLinkedInAuthForUser(userId) {
  const { rows } = await pool.query('SELECT * FROM linkedin_auth WHERE user_id = $1', [userId]);
  return rows[0];
}

// Helper: Update a post's analytics in DB
async function updatePostAnalytics(postId, { views, likes, comments, shares }) {
  console.log(`[Analytics Sync] DB update for postId ${postId}:`, { views, likes, comments, shares });
  await pool.query(
    `UPDATE linkedin_posts SET views = $1, likes = $2, comments = $3, shares = $4, updated_at = NOW() WHERE id = $5`,
    [views, likes, comments, shares, postId]
  );
}

// Helper: Fetch engagement for a LinkedIn post via API
async function fetchLinkedInPostAnalytics(accessToken, postUrn) {
  // LinkedIn API: https://api.linkedin.com/v2/ugcPosts/{postUrn}/socialMetadata
  // postUrn is the full URN, e.g. urn:li:share:123456789
  const url = `https://api.linkedin.com/v2/socialMetadata/${encodeURIComponent(postUrn)}`;
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    return {
      views: res.data.viewCount || 0,
      likes: res.data.likeCount || 0,
      comments: res.data.commentCount || 0,
      shares: res.data.shareCount || 0,
    };
  } catch (err) {
    console.error('[LinkedIn Analytics Sync] Error fetching analytics for', postUrn, err.response?.data || err.message);
    return null;
  }
}

// Sync analytics from LinkedIn API and update DB
export async function syncAnalytics(req, res) {
  try {
    const userId = req.user.id;
    console.log('[Analytics Sync] Starting sync for user', userId);
    // 1. Get LinkedIn auth info
    const auth = await getLinkedInAuthForUser(userId);
    if (!auth || !auth.access_token || !auth.linkedin_user_id) {
      return res.status(400).json({ error: 'No LinkedIn account connected' });
    }
    const accessToken = auth.access_token;
    // 2. Get all posted LinkedIn posts for this user
    const { rows: posts } = await pool.query(
      `SELECT id, linkedin_post_id FROM linkedin_posts WHERE user_id = $1 AND status = 'posted' AND linkedin_post_id IS NOT NULL`,
      [userId]
    );
    let updated = 0;
    for (const post of posts) {
      const postUrn = `urn:li:share:${post.linkedin_post_id}`;
      const analytics = await fetchLinkedInPostAnalytics(accessToken, postUrn);
      console.log(`[Analytics Sync] API analytics for post ${post.linkedin_post_id}:`, analytics);
      if (analytics) {
        await updatePostAnalytics(post.id, analytics);
        updated++;
        console.log(`[Analytics Sync] Updated post ${post.linkedin_post_id}:`, analytics);
      }
    }
    console.log(`[Analytics Sync] Completed sync for user ${userId}. Updated ${updated} posts.`);
    res.json({ success: true, updated });
  } catch (error) {
    console.error('[Analytics Sync] Error:', error);
    res.status(500).json({ error: 'Failed to sync analytics' });
  }
}

// LinkedIn Genie Analytics Controller
import { pool } from '../config/database.js';

export async function getAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    // Overview metrics
    const { rows: overview } = await pool.query(
      `SELECT 
        COUNT(*) as total_posts,
        COALESCE(SUM(views), 0) as total_views,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(comments), 0) as total_comments,
        COALESCE(SUM(shares), 0) as total_shares,
        COALESCE(AVG(views), 0) as avg_views,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(comments), 0) as avg_comments,
        COALESCE(AVG(shares), 0) as avg_shares
       FROM linkedin_posts 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'`,
      [userId, startDate]
    );
    console.log('[Analytics getAnalytics] Overview:', overview[0]);

    // Daily metrics for chart
    const { rows: daily } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as posts_count,
        COALESCE(SUM(views), 0) as views,
        COALESCE(SUM(likes), 0) as likes,
        COALESCE(SUM(comments), 0) as comments,
        COALESCE(SUM(shares), 0) as shares
       FROM linkedin_posts 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
      [userId, startDate]
    );

    // Top posts
    const { rows: topPosts } = await pool.query(
      `SELECT * FROM linkedin_posts 
       WHERE user_id = $1 AND created_at >= $2 AND status = 'posted'
       ORDER BY views DESC, likes DESC, comments DESC, shares DESC
       LIMIT 10`,
      [userId, startDate]
    );

    res.json({
      overview: overview[0] || {},
      daily,
      topPosts
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch LinkedIn analytics' });
  }
}

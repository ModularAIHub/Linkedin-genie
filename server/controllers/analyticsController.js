import { default as axios } from 'axios';
import { pool } from '../config/database.js';

// Helper: Get LinkedIn access token for user
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

// Helper: Mark a post as deleted so it stops appearing in analytics
async function markPostAsDeleted(postId, postUrn) {
  console.log(`[Analytics Sync] Marking post ${postId} as deleted (URN: ${postUrn})`);
  await pool.query(
    `UPDATE linkedin_posts SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
    [postId]
  );
}

// Helper: Detect URN type
function classifyPostId(postId) {
  if (!postId) return null;
  if (postId.startsWith('urn:li:share:')) return 'share';
  if (postId.startsWith('urn:li:ugcPost:')) return 'ugcPost';
  if (/^\d+$/.test(postId)) return 'numeric';
  return null;
}

// Helper: Fetch likes, comments, shares via socialActions endpoint
async function fetchSocialActions(accessToken, postUrn) {
  const encodedUrn = encodeURIComponent(postUrn);
  const url = `https://api.linkedin.com/v2/socialActions/${encodedUrn}`;
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': '202405'
      }
    });
    const data = res.data || {};
    return {
      likes: data.likesSummary?.totalLikes || 0,
      comments: data.commentsSummary?.totalFirstLevelComments || 0,
      shares: data.sharesSummary?.totalShares || 0
    };
  } catch (err) {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;

    // 404 = post was deleted from LinkedIn
    if (status === 404) {
      return { deleted: true };
    }

    console.error('[LinkedIn Analytics] socialActions error for', postUrn, { status, message });
    return null;
  }
}

// Helper: Fetch view count for UGC posts
// NOTE: LinkedIn API does not provide impression/view statistics for personal profiles
// Views are only available for organization pages with r_organization_social scope
async function fetchUgcPostViews(accessToken, ugcPostUrn, linkedinUserId) {
  // LinkedIn's API limitation: Personal profile posts don't have view statistics available
  // Only organization pages can access impression counts
  console.log('[LinkedIn Analytics] View statistics not available for personal profile posts');
  return 0;
}

// Helper: Fetch view count via Share Statistics API
// NOTE: LinkedIn API does not provide impression/view statistics for personal profiles
// Views are only available for organization pages with r_organization_social scope
async function fetchShareViews(accessToken, linkedinUserId, shareUrn) {
  // LinkedIn's API limitation: Personal profile posts don't have view statistics available
  // Only organization pages can access impression counts
  console.log('[LinkedIn Analytics] View statistics not available for personal profile posts');
  return 0;
}

// Main: Fetch all analytics for a post
async function fetchLinkedInPostAnalytics(accessToken, postId, linkedinUserId) {
  const type = classifyPostId(postId);
  if (!type) {
    console.warn('[LinkedIn Analytics] Unknown post ID format:', postId);
    return null;
  }

  // Normalize to full URN
  let postUrn = postId;
  if (type === 'numeric') {
    postUrn = `urn:li:ugcPost:${postId}`;
  }

  // Step 1: Get likes, comments, shares
  const social = await fetchSocialActions(accessToken, postUrn);

  // Post was deleted on LinkedIn
  if (social?.deleted) {
    return { deleted: true };
  }

  if (!social) return null;

  // Step 2: Get view count
  // Both ugcPost and share use organizationalEntityShareStatistics API
  let views = 0;
  if (linkedinUserId) {
    if (postUrn.startsWith('urn:li:ugcPost:')) {
      views = await fetchUgcPostViews(accessToken, postUrn, linkedinUserId);
    } else if (postUrn.startsWith('urn:li:share:')) {
      views = await fetchShareViews(accessToken, linkedinUserId, postUrn);
    }
  }

  return {
    views,
    likes: social.likes,
    comments: social.comments,
    shares: social.shares
  };
}

// Sync analytics from LinkedIn API and update DB
export async function syncAnalytics(req, res) {
  try {
    const userId = req.user.id;
    console.log('[Analytics Sync] Starting sync for user', userId);

    // Get LinkedIn auth
    const auth = await getLinkedInAuthForUser(userId);
    if (!auth || !auth.access_token || !auth.linkedin_user_id) {
      return res.status(400).json({ error: 'No LinkedIn account connected' });
    }
    const accessToken = auth.access_token;
    const linkedinUserId = auth.linkedin_user_id;

    // Get all posted LinkedIn posts for this user
    const { rows: posts } = await pool.query(
      `SELECT id, linkedin_post_id, post_content, views, likes, comments, shares, created_at
       FROM linkedin_posts 
       WHERE user_id = $1 AND status = 'posted'
       ORDER BY created_at DESC`,
      [userId]
    );

    console.log(`[Analytics Sync] Found ${posts.length} posts to sync`);

    let updated = 0;
    let deleted = 0;
    const updatedPostIds = [];
    const deletedPostIds = [];

    for (const post of posts) {
      // Skip demo/test posts
      if (!post.linkedin_post_id ||
          post.linkedin_post_id.includes('DEMO') ||
          post.linkedin_post_id.includes('test')) {
        console.log(`[Analytics Sync] Skipping demo/test post ${post.id}`);
        continue;
      }

      const result = await fetchLinkedInPostAnalytics(accessToken, post.linkedin_post_id, linkedinUserId);
      console.log(`[Analytics Sync] Result for post ${post.linkedin_post_id}:`, result);

      if (result?.deleted) {
        // Post no longer exists on LinkedIn — mark as deleted
        await markPostAsDeleted(post.id, post.linkedin_post_id);
        deleted++;
        deletedPostIds.push(post.id);
        console.log(`[Analytics Sync] Post ${post.id} marked as deleted`);
      } else if (result) {
        await updatePostAnalytics(post.id, result);
        updated++;
        updatedPostIds.push(post.id);
        console.log(`[Analytics Sync] Updated post ${post.id}`);
      } else {
        console.log(`[Analytics Sync] No analytics available for post ${post.id} - skipping`);
      }
    }

    console.log(`[Analytics Sync] Completed. Updated ${updated}, deleted ${deleted}, out of ${posts.length} posts.`);

    res.json({
      success: true,
      updated,
      deleted,
      total: posts.length,
      updatedPostIds,
      deletedPostIds,
      message: deleted > 0
        ? `${updated} posts updated, ${deleted} posts removed (deleted from LinkedIn)`
        : `${updated} posts updated`
    });

  } catch (error) {
    console.error('[Analytics Sync] Error:', error);
    res.status(500).json({ error: 'Failed to sync analytics', details: error.message });
  }
}

// Get analytics data for dashboard
export async function getAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const { days = 30, account_id, account_type } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    let filterField = 'user_id';
    let filterValue = userId;
    if (account_type === 'team' && account_id) {
      filterField = 'account_id';
      filterValue = account_id;
    }

    // Overview metrics — exclude deleted posts
    const { rows: overview } = await pool.query(
      `SELECT 
        COUNT(*) as total_posts,
        COALESCE(SUM(views), 0) as total_views,
        COALESCE(SUM(likes), 0) as total_likes,
        COALESCE(SUM(comments), 0) as total_comments,
        COALESCE(SUM(shares), 0) as total_shares,
        COALESCE(AVG(NULLIF(views, 0)), 0) as avg_views,
        COALESCE(AVG(NULLIF(likes, 0)), 0) as avg_likes,
        COALESCE(AVG(NULLIF(comments, 0)), 0) as avg_comments,
        COALESCE(AVG(NULLIF(shares, 0)), 0) as avg_shares
       FROM linkedin_posts 
       WHERE ${filterField} = $1 
         AND created_at >= $2 
         AND status = 'posted'`,
      [filterValue, startDate]
    );
    console.log('[Analytics] Overview:', overview[0]);

    // Daily metrics for chart — exclude deleted
    const { rows: daily } = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as posts_count,
        COALESCE(SUM(views), 0) as views,
        COALESCE(SUM(likes), 0) as likes,
        COALESCE(SUM(comments), 0) as comments,
        COALESCE(SUM(shares), 0) as shares
       FROM linkedin_posts 
       WHERE ${filterField} = $1 
         AND created_at >= $2 
         AND status = 'posted'
       GROUP BY DATE(created_at)
       ORDER BY date DESC
       LIMIT 30`,
      [filterValue, startDate]
    );

    // Top posts by engagement — exclude deleted
    const { rows: topPosts } = await pool.query(
      `SELECT 
        id, linkedin_post_id, post_content, views, likes, comments, shares, created_at,
        (COALESCE(likes, 0) + COALESCE(comments, 0) + COALESCE(shares, 0)) as total_engagement
       FROM linkedin_posts 
       WHERE ${filterField} = $1 
         AND created_at >= $2 
         AND status = 'posted'
       ORDER BY total_engagement DESC, views DESC
       LIMIT 10`,
      [filterValue, startDate]
    );

    // Timing analysis - day of week and hour of day performance
    const { rows: timingByDayOfWeek } = await pool.query(
      `SELECT 
        EXTRACT(DOW FROM created_at) as day_of_week,
        COUNT(*) as posts_count,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(comments), 0) as avg_comments,
        COALESCE(AVG(shares), 0) as avg_shares,
        COALESCE(AVG(likes + comments + shares), 0) as avg_engagement
       FROM linkedin_posts 
       WHERE ${filterField} = $1 
         AND created_at >= $2 
         AND status = 'posted'
       GROUP BY EXTRACT(DOW FROM created_at)
       ORDER BY day_of_week`,
      [filterValue, startDate]
    );

    const { rows: timingByHour } = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM created_at) as hour_of_day,
        COUNT(*) as posts_count,
        COALESCE(AVG(likes), 0) as avg_likes,
        COALESCE(AVG(comments), 0) as avg_comments,
        COALESCE(AVG(shares), 0) as avg_shares,
        COALESCE(AVG(likes + comments + shares), 0) as avg_engagement
       FROM linkedin_posts 
       WHERE ${filterField} = $1 
         AND created_at >= $2 
         AND status = 'posted'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour_of_day`,
      [filterValue, startDate]
    );

    res.json({
      overview: overview[0] || {},
      daily,
      topPosts,
      timing: {
        byDayOfWeek: timingByDayOfWeek,
        byHour: timingByHour
      }
    });

  } catch (error) {
    console.error('[Analytics] Error:', error);
    res.status(500).json({ error: 'Failed to fetch LinkedIn analytics' });
  }
}
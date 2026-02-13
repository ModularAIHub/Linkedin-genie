
import { pool } from '../config/database.js';
import { create, findByUser, findById, updateStatus, deleteById } from '../models/scheduledPostModel.js';
import { DateTime } from 'luxon';
import { logger } from '../utils/logger.js';
import { getLinkedinSchedulerStatus } from '../workers/linkedinScheduler.js';
// LinkedIn Genie Schedule Controller

const isMeaningfulAccountId = (value) =>
  value !== undefined && value !== null && String(value) !== '' && String(value) !== 'null' && String(value) !== 'undefined';

async function resolveTeamAccountForUser(userId, rawAccountId) {
  if (!isMeaningfulAccountId(rawAccountId)) {
    return null;
  }

  const normalizedId = String(rawAccountId);
  const isUUID = normalizedId.includes('-');

  if (isUUID) {
    const { rows } = await pool.query(
      `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id
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
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `SELECT lta.id, lta.team_id, lta.access_token, lta.linkedin_user_id
     FROM linkedin_team_accounts lta
     JOIN team_members tm ON tm.team_id = lta.team_id
     WHERE lta.id = $1::int
       AND lta.active = true
       AND tm.user_id = $2
       AND tm.status = 'active'
     LIMIT 1`,
    [normalizedId, userId]
  );
  return rows[0] || null;
}


// Schedule a LinkedIn post
export async function schedulePost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { post_content, media_urls, post_type, company_id, account_id, scheduled_time, user_timezone } = req.body;
    if (!post_content || !scheduled_time) return res.status(400).json({ error: 'Missing post content or scheduled time' });

    const selectedAccountId = account_id || req.headers['x-selected-account-id'] || company_id;
    const teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);

    if (isMeaningfulAccountId(selectedAccountId) && !teamAccount) {
      return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
    }

    // Convert local time + timezone to UTC
    let scheduledTimeUtc;
    if (user_timezone) {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time, { zone: user_timezone }).toUTC().toISO();
    } else {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time).toUTC().toISO();
    }

    let linkedinAccessToken = req.user?.linkedinAccessToken;
    let authorUrn = req.user?.linkedinUrn;
    const fixedCompanyId = teamAccount ? teamAccount.team_id : null;

    if (teamAccount) {
      linkedinAccessToken = teamAccount.access_token;
      authorUrn = `urn:li:person:${teamAccount.linkedin_user_id}`;
    }

    if (!linkedinAccessToken || !authorUrn) {
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }

    // Save to DB
    const scheduledPost = await create({
      user_id: userId,
      post_content,
      media_urls,
      post_type,
      company_id: fixedCompanyId,
      scheduled_time: scheduledTimeUtc,
      status: 'scheduled'
    });

    logger.info('[ScheduleController] Scheduled post created', {
      scheduledPostId: scheduledPost.id,
      scheduledTimeUtc
    });
    res.json({ success: true, scheduledPost });
  } catch (error) {
    logger.error('[schedulePost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// List scheduled LinkedIn posts for user
export async function getScheduledPosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { status, limit, offset } = req.query;
    const selectedAccountId = req.headers['x-selected-account-id'];
    const teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);
    const companyIds = teamAccount
      ? [String(teamAccount.team_id), String(teamAccount.id)]
      : undefined;

    const posts = await findByUser(userId, {
      status,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0,
      companyIds
    });
    res.json({ posts });
  } catch (error) {
    logger.error('[getScheduledPosts] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Cancel a scheduled LinkedIn post
export async function cancelScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id || req.body?.id;
    const post = await findById(id);
    if (!post || post.user_id !== userId) return res.status(404).json({ error: 'Scheduled post not found' });
    await updateStatus(id, 'cancelled');
    res.json({ success: true });
  } catch (error) {
    logger.error('[cancelScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Delete a scheduled LinkedIn post
export async function deleteScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    const post = await findById(id);
    if (!post || post.user_id !== userId) return res.status(404).json({ error: 'Scheduled post not found' });
    await deleteById(id, userId);
    res.json({ success: true });
  } catch (error) {
    logger.error('[deleteScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Retry a failed scheduled LinkedIn post
export async function retryFailedScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const id = req.params.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });

    const post = await findById(id);
    if (!post || post.user_id !== userId) return res.status(404).json({ error: 'Scheduled post not found' });

    if (post.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed scheduled posts can be retried' });
    }

    let updatedRow = null;
    try {
      const { rows } = await pool.query(
        `UPDATE scheduled_linkedin_posts
         SET status = 'scheduled',
             error_message = NULL,
             retry_count = 0,
             next_retry_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId]
      );
      updatedRow = rows[0] || null;
    } catch (error) {
      if (error?.code !== '42703') {
        throw error;
      }

      // Backward compatibility before retry columns migration.
      const { rows } = await pool.query(
        `UPDATE scheduled_linkedin_posts
         SET status = 'scheduled',
             error_message = NULL,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId]
      );
      updatedRow = rows[0] || null;
    }

    res.json({ success: true, post: updatedRow });
  } catch (error) {
    logger.error('[retryFailedScheduledPost] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Scheduler runtime status for debugging
export async function getSchedulerStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const scheduler = getLinkedinSchedulerStatus();

    let countsByStatus = {};
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM scheduled_linkedin_posts
       WHERE user_id = $1
       GROUP BY status`,
      [userId]
    );
    countsByStatus = statusRows.reduce((acc, row) => {
      acc[row.status] = row.count;
      return acc;
    }, {});

    let dueNowCount = 0;
    try {
      const { rows: dueRows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM scheduled_linkedin_posts
         WHERE user_id = $1
           AND status = 'scheduled'
           AND COALESCE(next_retry_at, scheduled_time) <= NOW()`,
        [userId]
      );
      dueNowCount = dueRows[0]?.count || 0;
    } catch (error) {
      if (error?.code !== '42703') throw error;
      const { rows: fallbackRows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM scheduled_linkedin_posts
         WHERE user_id = $1
           AND status = 'scheduled'
           AND scheduled_time <= NOW()`,
        [userId]
      );
      dueNowCount = fallbackRows[0]?.count || 0;
    }

    res.json({
      scheduler,
      userQueue: {
        countsByStatus,
        dueNowCount
      }
    });
  } catch (error) {
    logger.error('[getSchedulerStatus] Error', error);
    res.status(500).json({ error: error.message });
  }
}

// Bulk schedule LinkedIn posts
export async function bulkSchedulePosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { items, frequency, startDate, postsPerDay = 1, dailyTimes = ['09:00'], daysOfWeek, images, timezone = 'UTC', account_id } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
    }

    const selectedAccountId = account_id || req.headers['x-selected-account-id'];
    const teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);

    if (isMeaningfulAccountId(selectedAccountId) && !teamAccount) {
      return res.status(403).json({ error: 'Selected LinkedIn team account not found or access denied' });
    }

    const linkedinAccessToken = teamAccount?.access_token || req.user?.linkedinAccessToken;
    const authorUrn = teamAccount
      ? `urn:li:person:${teamAccount.linkedin_user_id}`
      : req.user?.linkedinUrn;
    const companyId = teamAccount ? teamAccount.team_id : null;

    if (!linkedinAccessToken || !authorUrn) {
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    const scheduled = [];
    let scheduledCount = 0;
    let current = DateTime.fromISO(startDate, { zone: timezone });
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let content = item.text;
      let media = images?.[i] || [];
      
      let scheduledForLocal;
      
      if (frequency === 'daily') {
        const dayOffset = Math.floor(scheduledCount / postsPerDay);
        const timeIndex = scheduledCount % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        scheduledForLocal = current.plus({ days: dayOffset }).set({ hour, minute, second: 0, millisecond: 0 });
      } else if (frequency === 'thrice_weekly' || frequency === 'four_times_weekly') {
        const days = frequency === 'thrice_weekly' ? [1, 3, 5] : [0, 2, 4, 6];
        const postsPerCycle = days.length * postsPerDay;
        const cycleNum = Math.floor(scheduledCount / postsPerCycle);
        const positionInCycle = scheduledCount % postsPerCycle;
        const dayIndex = Math.floor(positionInCycle / postsPerDay);
        const timeIndex = positionInCycle % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        scheduledForLocal = current.plus({ weeks: cycleNum }).set({ weekday: days[dayIndex], hour, minute, second: 0, millisecond: 0 });
      } else if (frequency === 'custom' && Array.isArray(daysOfWeek) && daysOfWeek.length > 0) {
        const postsPerCycle = daysOfWeek.length * postsPerDay;
        const cycleNum = Math.floor(scheduledCount / postsPerCycle);
        const positionInCycle = scheduledCount % postsPerCycle;
        const dayIndex = Math.floor(positionInCycle / postsPerDay);
        const timeIndex = positionInCycle % postsPerDay;
        const timeStr = dailyTimes[timeIndex] || dailyTimes[0] || '09:00';
        const [hour, minute] = timeStr.split(':').map(Number);
        
        // daysOfWeek uses Sunday=0, Monday=1, etc.
        // luxon uses Monday=1, Sunday=7, so we need to convert
        const luxonWeekday = daysOfWeek[dayIndex] === 0 ? 7 : daysOfWeek[dayIndex];
        scheduledForLocal = current.plus({ weeks: cycleNum }).set({ weekday: luxonWeekday, hour, minute, second: 0, millisecond: 0 });
      } else {
        // Fallback: daily with first time
        const [hour, minute] = (dailyTimes[0] || '09:00').split(':').map(Number);
        scheduledForLocal = current.plus({ days: scheduledCount }).set({ hour, minute, second: 0, millisecond: 0 });
      }
      
      const scheduledForUTC = scheduledForLocal.toUTC().toISO();
      
      // Save to DB
      const scheduledPost = await create({
        user_id: userId,
        post_content: content,
        media_urls: media,
        post_type: 'text',
        company_id: companyId,
        scheduled_time: scheduledForUTC,
        status: 'scheduled'
      });
      
      scheduled.push({
        id: scheduledPost.id,
        content: content.substring(0, 50) + '...',
        scheduledFor: scheduledForLocal.toISO()
      });
      
      scheduledCount++;
    }
    
    res.json({ success: true, scheduled, count: scheduled.length });
  } catch (error) {
    logger.error('[bulkSchedulePosts] Error', error);
    res.status(500).json({ error: error.message });
  }
}

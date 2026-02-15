
import { pool } from '../config/database.js';
import { create, findByUser, findById, updateStatus, deleteById } from '../models/scheduledPostModel.js';
import { DateTime } from 'luxon';
import { logger } from '../utils/logger.js';
import { getLinkedinSchedulerStatus } from '../workers/linkedinScheduler.js';
import {
  getUserTeamHints,
  isMeaningfulAccountId,
  resolveDefaultTeamAccountForUser,
  resolveTeamAccountForUser
} from '../utils/teamAccountScope.js';
// LinkedIn Genie Schedule Controller

const MAX_BULK_SCHEDULE_ITEMS = 30;
const MAX_SCHEDULING_WINDOW_DAYS = 15;

async function resolveTeamAdminAccount(req, userId) {
  const selectedAccountId =
    req.headers['x-selected-account-id'] || req.body?.account_id || req.body?.company_id;
  const preferredTeamIds = getUserTeamHints(req.user);
  let teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId, {
    allowedRoles: ['owner', 'admin']
  });

  if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
    teamAccount = await resolveDefaultTeamAccountForUser(userId, {
      allowedRoles: ['owner', 'admin'],
      preferredTeamIds
    });
  }

  return teamAccount;
}

function getScopedCompanyIds(teamAccount) {
  if (!teamAccount) return [];
  return [String(teamAccount.team_id), String(teamAccount.id)];
}

function canManageScheduledPost(post, userId, teamAccount) {
  if (!post) return false;
  if (post.user_id === userId) return true;
  if (!teamAccount || !post.company_id) return false;
  const scopedCompanyIds = getScopedCompanyIds(teamAccount);
  return scopedCompanyIds.includes(String(post.company_id));
}


// Schedule a LinkedIn post
export async function schedulePost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { post_content, media_urls, post_type, company_id, account_id, scheduled_time, user_timezone } = req.body;
    if (!post_content || !scheduled_time) return res.status(400).json({ error: 'Missing post content or scheduled time' });

    const selectedAccountId = account_id || req.headers['x-selected-account-id'] || company_id;
    const preferredTeamIds = getUserTeamHints(req.user);
    let teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }

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
    const scheduledDateTimeUtc = DateTime.fromISO(scheduledTimeUtc, { zone: 'utc' });
    if (!scheduledDateTimeUtc.isValid) {
      return res.status(400).json({ error: 'Invalid scheduled time' });
    }
    const maxSchedulingUtc = DateTime.utc().plus({ days: MAX_SCHEDULING_WINDOW_DAYS });
    if (scheduledDateTimeUtc > maxSchedulingUtc) {
      return res.status(400).json({
        error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
      });
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
    const preferredTeamIds = getUserTeamHints(req.user);
    let teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);
    if (!teamAccount) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }
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
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });
    const post = await findById(id);
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

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
    if (!id) return res.status(400).json({ error: 'Scheduled post id is required' });
    const post = await findById(id);
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

    if (post.user_id === userId) {
      await deleteById(id, userId);
    } else {
      const scopedCompanyIds = getScopedCompanyIds(teamAccount);
      await pool.query(
        `DELETE FROM scheduled_linkedin_posts
         WHERE id = $1
           AND company_id::text = ANY($2::text[])`,
        [id, scopedCompanyIds]
      );
    }
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
    if (!post) return res.status(404).json({ error: 'Scheduled post not found' });

    const teamAccount = await resolveTeamAdminAccount(req, userId);
    if (!canManageScheduledPost(post, userId, teamAccount)) {
      return res.status(403).json({ error: 'Access denied for this scheduled post' });
    }

    if (post.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed scheduled posts can be retried' });
    }

    const scopedCompanyIds = getScopedCompanyIds(teamAccount);
    const canUseTeamScope = post.user_id !== userId && scopedCompanyIds.length > 0;

    let updatedRow = null;
    try {
      const { rows } = canUseTeamScope
        ? await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 retry_count = 0,
                 next_retry_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1
               AND company_id::text = ANY($2::text[])
             RETURNING *`,
            [id, scopedCompanyIds]
          )
        : await pool.query(
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
      const { rows } = canUseTeamScope
        ? await pool.query(
            `UPDATE scheduled_linkedin_posts
             SET status = 'scheduled',
                 error_message = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND company_id::text = ANY($2::text[])
             RETURNING *`,
            [id, scopedCompanyIds]
          )
        : await pool.query(
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
    const selectedAccountId = req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    let teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);
    if (!teamAccount) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }
    const companyIds = teamAccount
      ? [String(teamAccount.team_id), String(teamAccount.id)]
      : undefined;

    let countsByStatus = {};
    const { rows: statusRows } = companyIds
      ? await pool.query(
          `SELECT status, COUNT(*)::int AS count
           FROM scheduled_linkedin_posts
           WHERE company_id::text = ANY($1::text[])
           GROUP BY status`,
          [companyIds]
        )
      : await pool.query(
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
      const { rows: dueRows } = companyIds
        ? await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE company_id::text = ANY($1::text[])
               AND status = 'scheduled'
               AND COALESCE(next_retry_at, scheduled_time) <= NOW()`,
            [companyIds]
          )
        : await pool.query(
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
      const { rows: fallbackRows } = companyIds
        ? await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM scheduled_linkedin_posts
             WHERE company_id::text = ANY($1::text[])
               AND status = 'scheduled'
               AND scheduled_time <= NOW()`,
            [companyIds]
          )
        : await pool.query(
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
    if (items.length > MAX_BULK_SCHEDULE_ITEMS) {
      return res.status(400).json({
        error: `Bulk scheduling is limited to ${MAX_BULK_SCHEDULE_ITEMS} prompts at a time.`,
      });
    }

    const selectedAccountId = account_id || req.headers['x-selected-account-id'];
    const preferredTeamIds = getUserTeamHints(req.user);
    let teamAccount = await resolveTeamAccountForUser(userId, selectedAccountId);
    if (!teamAccount && !isMeaningfulAccountId(selectedAccountId)) {
      teamAccount = await resolveDefaultTeamAccountForUser(userId, { preferredTeamIds });
    }

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
    if (!current.isValid) {
      return res.status(400).json({ error: 'Invalid start date or timezone' });
    }
    const maxSchedulingUtc = DateTime.utc().plus({ days: MAX_SCHEDULING_WINDOW_DAYS });
    
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
      
      const scheduledForUtcDateTime = scheduledForLocal.toUTC();
      if (!scheduledForUtcDateTime.isValid) {
        return res.status(400).json({ error: 'Invalid scheduling parameters' });
      }
      if (scheduledForUtcDateTime > maxSchedulingUtc) {
        return res.status(400).json({
          error: `Scheduling is limited to ${MAX_SCHEDULING_WINDOW_DAYS} days ahead.`,
        });
      }

      const scheduledForUTC = scheduledForUtcDateTime.toISO();
      
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

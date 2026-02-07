
import { pool } from '../config/database.js';
import { Queue } from 'bullmq';
import { create, findByUser, findById, updateStatus, deleteById } from '../models/scheduledPostModel.js';
import dotenv from 'dotenv';
dotenv.config();
import { DateTime } from 'luxon';

const scheduleQueue = new Queue('linkedin-schedule', {
  connection: {
    url: process.env.REDIS_URL,
  },
});
// LinkedIn Genie Schedule Controller


// Schedule a LinkedIn post
export async function schedulePost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { post_content, media_urls, post_type, company_id, scheduled_time, user_timezone } = req.body;
    if (!post_content || !scheduled_time) return res.status(400).json({ error: 'Missing post content or scheduled time' });
    // Convert local time + timezone to UTC
    let scheduledTimeUtc;
    if (user_timezone) {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time, { zone: user_timezone }).toUTC().toISO();
    } else {
      scheduledTimeUtc = DateTime.fromISO(scheduled_time).toUTC().toISO();
    }
    // Save to DB
    let fixedCompanyId = company_id;
    // If company_id is present and not a valid UUID, try to fetch the UUID from the team table
    if (company_id && !/^[0-9a-fA-F-]{36}$/.test(company_id)) {
      // Try to find the team with this integer id
      const { rows: teamRows } = await pool.query('SELECT team_id FROM team_members WHERE team_id = $1::text OR id = $1::int LIMIT 1', [company_id]);
      if (teamRows.length > 0) {
        fixedCompanyId = teamRows[0].team_id;
      }
    }
    const scheduledPost = await create({
      user_id: userId,
      post_content,
      media_urls,
      post_type,
      company_id: fixedCompanyId,
      scheduled_time: scheduledTimeUtc,
      status: 'scheduled'
    });
    // Determine LinkedIn credentials for team/company posts
    let linkedinAccessToken = req.user?.linkedinAccessToken;
    let authorUrn = req.user?.linkedinUrn;
    if (fixedCompanyId && fixedCompanyId !== 'null' && fixedCompanyId !== 'undefined') {
      // Fetch team account credentials
      const { rows: teamAccountRows } = await pool.query(
        `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
        [fixedCompanyId]
      );
      if (teamAccountRows.length > 0) {
        linkedinAccessToken = teamAccountRows[0].access_token;
        authorUrn = `urn:li:person:${teamAccountRows[0].linkedin_user_id}`;
      }
    }
    // Enqueue job with correct credentials
    const job = await scheduleQueue.add('publish', {
      scheduledPostId: scheduledPost.id,
      linkedinAccessToken,
      authorUrn,
      postContent: post_content,
      mediaUrls: media_urls,
      postType: post_type,
      companyId: fixedCompanyId
    }, {
      delay: Math.max(0, DateTime.fromISO(scheduledTimeUtc).toMillis() - Date.now()),
      attempts: 3
    });
    console.log('[ScheduleController] Scheduled job created:', {
      jobId: job.id,
      scheduledPostId: scheduledPost.id,
      scheduledTimeUtc,
      queue: 'linkedin-schedule'
    });
    res.json({ success: true, scheduledPost });
  } catch (error) {
    console.error('[schedulePost] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// List scheduled LinkedIn posts for user
export async function getScheduledPosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { status, limit, offset } = req.query;
    const posts = await findByUser(userId, {
      status,
      limit: limit ? parseInt(limit) : 20,
      offset: offset ? parseInt(offset) : 0
    });
    res.json({ posts });
  } catch (error) {
    console.error('[getScheduledPosts] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Cancel a scheduled LinkedIn post
export async function cancelScheduledPost(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;
    const post = await findById(id);
    if (!post || post.user_id !== userId) return res.status(404).json({ error: 'Scheduled post not found' });
    await updateStatus(id, 'cancelled');
    await deleteById(id, userId);
    res.json({ success: true });
  } catch (error) {
    console.error('[cancelScheduledPost] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

// Bulk schedule LinkedIn posts
export async function bulkSchedulePosts(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { items, frequency, startDate, postsPerDay = 1, dailyTimes = ['09:00'], daysOfWeek, images, timezone = 'UTC' } = req.body;
    
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items to schedule' });
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
        scheduled_time: scheduledForUTC,
        status: 'scheduled'
      });
      
      // Enqueue job
      const delay = Math.max(0, DateTime.fromISO(scheduledForUTC).toMillis() - Date.now());
      await scheduleQueue.add('publish', {
        scheduledPostId: scheduledPost.id,
        linkedinAccessToken: req.user?.linkedinAccessToken,
        authorUrn: req.user?.linkedinUrn,
        postContent: content,
        mediaUrls: media,
        postType: 'text'
      }, {
        delay,
        attempts: 3
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
    console.error('[bulkSchedulePosts] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

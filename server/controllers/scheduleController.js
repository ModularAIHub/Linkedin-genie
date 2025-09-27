
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
    const scheduledPost = await create({
      user_id: userId,
      post_content,
      media_urls,
      post_type,
      company_id,
      scheduled_time: scheduledTimeUtc,
      status: 'scheduled'
    });
    // Enqueue job
    await scheduleQueue.add('publish', {
      userId,
      postContent: post_content,
      mediaUrls: media_urls,
      postType: post_type,
      companyId: company_id,
      scheduledPostId: scheduledPost.id,
      linkedinAccessToken: req.user.linkedinAccessToken,
      authorUrn: req.user.linkedinUrn
    }, {
      delay: Math.max(0, DateTime.fromISO(scheduledTimeUtc).toMillis() - Date.now()),
      attempts: 3
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

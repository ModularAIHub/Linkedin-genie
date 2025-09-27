import { Worker } from 'bullmq';
import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../config/database.js';
import { createLinkedInPost } from '../services/linkedinService.js';

const connection = createClient({
  url: process.env.REDIS_URL,
});

const worker = new Worker('linkedin-schedule', async job => {
  const { userId, postContent, mediaUrls, postType, companyId, linkedinAccessToken, authorUrn } = job.data;
  try {
    // Publish post to LinkedIn
    await createLinkedInPost(linkedinAccessToken, authorUrn, postContent, mediaUrls, postType, companyId);
    // Update DB status
    await pool.query(
      `UPDATE scheduled_linkedin_posts SET status = 'completed', posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.data.scheduledPostId]
    );
    return { success: true };
  } catch (error) {
    await pool.query(
      `UPDATE scheduled_linkedin_posts SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [job.data.scheduledPostId, error.message]
    );
    throw error;
  }
}, {
  connection,
});

worker.on('completed', job => {
  console.log(`[LinkedIn Scheduler] Completed job ${job.id}`);
});
worker.on('failed', (job, err) => {
  console.error(`[LinkedIn Scheduler] Failed job ${job.id}:`, err);
});

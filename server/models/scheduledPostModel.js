

import { pool } from '../config/database.js';

// Create a scheduled LinkedIn post
export async function create({ user_id, post_content, media_urls, post_type, company_id, scheduled_time, status }) {
  const { rows } = await pool.query(
    `INSERT INTO scheduled_linkedin_posts (user_id, post_content, media_urls, post_type, company_id, scheduled_time, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
    [user_id, post_content, JSON.stringify(media_urls || []), post_type, company_id, scheduled_time, status || 'scheduled']
  );
  return rows[0];
}

// Find scheduled posts by user
export async function findByUser(user_id, { limit = 20, offset = 0, status, companyIds } = {}) {
  let where = 'WHERE user_id = $1';
  const params = [user_id];
  if (status) {
    where += ' AND status = $2';
    params.push(status);
  }
  if (Array.isArray(companyIds) && companyIds.length > 0) {
    params.push(companyIds.map(String));
    where += ` AND company_id::text = ANY($${params.length}::text[])`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_linkedin_posts ${where} ORDER BY scheduled_time DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

// Find scheduled post by ID
export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM scheduled_linkedin_posts WHERE id = $1',
    [id]
  );
  return rows[0];
}

// Update status of scheduled post
export async function updateStatus(id, status, error_message = null) {
  await pool.query(
    'UPDATE scheduled_linkedin_posts SET status = $2, error_message = $3, updated_at = NOW() WHERE id = $1',
    [id, status, error_message]
  );
}

// Delete scheduled post by ID
export async function deleteById(id, user_id) {
  await pool.query('DELETE FROM scheduled_linkedin_posts WHERE id = $1 AND user_id = $2', [id, user_id]);
}

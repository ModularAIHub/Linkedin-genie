

import { pool } from '../config/database.js';

let optionalColumnsCache = null;

async function resolveOptionalColumns({ ensureColumns = false } = {}) {
  if (optionalColumnsCache) {
    return optionalColumnsCache;
  }

  if (ensureColumns) {
    try {
      await pool.query(
        `ALTER TABLE scheduled_linkedin_posts
         ADD COLUMN IF NOT EXISTS timezone VARCHAR(100)`
      );
      await pool.query(
        `ALTER TABLE scheduled_linkedin_posts
         ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb`
      );
    } catch (error) {
      console.warn('[scheduledPostModel] Could not auto-add optional schedule columns:', error?.message || String(error));
    }
  }

  try {
    const { rows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'scheduled_linkedin_posts'
         AND column_name = ANY($1::text[])`,
      [['timezone', 'metadata']]
    );
    const available = new Set(rows.map((row) => row.column_name));
    optionalColumnsCache = {
      timezone: available.has('timezone'),
      metadata: available.has('metadata'),
    };
  } catch (error) {
    console.warn('[scheduledPostModel] Failed to inspect optional schedule columns:', error?.message || String(error));
    optionalColumnsCache = { timezone: false, metadata: false };
  }

  return optionalColumnsCache;
}

// Create a scheduled LinkedIn post
export async function create({
  user_id,
  post_content,
  media_urls,
  post_type,
  company_id,
  scheduled_time,
  timezone = null,
  metadata = null,
  status,
}) {
  const wantsOptionalColumns = timezone !== null || metadata !== null;
  const optionalColumns = wantsOptionalColumns
    ? await resolveOptionalColumns({ ensureColumns: true })
    : { timezone: false, metadata: false };

  const columns = [
    'user_id',
    'post_content',
    'media_urls',
    'post_type',
    'company_id',
    'scheduled_time',
  ];
  const values = [
    user_id,
    post_content,
    JSON.stringify(media_urls || []),
    post_type,
    company_id,
    scheduled_time,
  ];

  if (optionalColumns.timezone) {
    columns.push('timezone');
    values.push(timezone || null);
  }

  if (optionalColumns.metadata) {
    columns.push('metadata');
    values.push(JSON.stringify(metadata || {}));
  }

  columns.push('status', 'created_at', 'updated_at');
  values.push(status || 'scheduled');

  const placeholders = columns.map((column, index) => {
    if (column === 'created_at' || column === 'updated_at') return 'NOW()';
    if (column === 'status') return `$${values.length}`;
    const valueIndex = columns
      .filter((name) => !['created_at', 'updated_at'].includes(name))
      .indexOf(column) + 1;
    return `$${valueIndex}`;
  });

  const { rows } = await pool.query(
    `INSERT INTO scheduled_linkedin_posts (${columns.join(', ')})
     VALUES (${placeholders.join(', ')}) RETURNING *`,
    values
  );
  return rows[0];
}

// Find scheduled posts by user
export async function findByUser(user_id, { limit = 20, offset = 0, status, companyIds } = {}) {
  const params = [];
  const filters = [];

  if (Array.isArray(companyIds) && companyIds.length > 0) {
    const companyIdx = params.push(companyIds.map(String)); // e.g. $1
    const userIdx = params.push(user_id);                   // e.g. $2
    // Include rows that belong to one of the scoped company IDs, OR rows the
    // user created without a company_id (e.g. before team accounts were set up).
    filters.push(
      `(company_id::text = ANY($${companyIdx}::text[]) OR (company_id IS NULL AND user_id = $${userIdx}))`
    );
  } else {
    params.push(user_id);
    filters.push(`user_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    filters.push(`status = $${params.length}`);
  }

  const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

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

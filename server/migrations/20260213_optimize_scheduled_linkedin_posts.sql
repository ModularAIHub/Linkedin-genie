-- Scheduler resilience and performance optimization
-- Adds retry tracking columns and due-query indexes for DB-backed scheduler.

ALTER TABLE scheduled_linkedin_posts
ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scheduled_linkedin_posts
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE scheduled_linkedin_posts
ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN scheduled_linkedin_posts.retry_count IS 'Number of scheduler retry attempts';
COMMENT ON COLUMN scheduled_linkedin_posts.next_retry_at IS 'Next retry execution time for failed scheduled posts';
COMMENT ON COLUMN scheduled_linkedin_posts.last_attempt_at IS 'Most recent scheduler attempt timestamp';

-- Primary index for due scheduled posts ordered by scheduled time
CREATE INDEX IF NOT EXISTS idx_scheduled_linkedin_posts_due_time
  ON scheduled_linkedin_posts (status, scheduled_time);

-- Retry-aware due index for posts with next_retry_at
CREATE INDEX IF NOT EXISTS idx_scheduled_linkedin_posts_due_retry
  ON scheduled_linkedin_posts (status, next_retry_at)
  WHERE status = 'scheduled';

-- Common listing/filter pattern in API
CREATE INDEX IF NOT EXISTS idx_scheduled_linkedin_posts_user_status_time
  ON scheduled_linkedin_posts (user_id, status, scheduled_time DESC);


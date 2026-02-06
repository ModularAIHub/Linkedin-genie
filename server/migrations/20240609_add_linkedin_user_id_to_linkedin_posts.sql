-- Migration: Add linkedin_user_id to linkedin_posts for correct LinkedIn API permissions
ALTER TABLE linkedin_posts ADD COLUMN IF NOT EXISTS linkedin_user_id VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_linkedin_user_id ON linkedin_posts(linkedin_user_id);
COMMENT ON COLUMN linkedin_posts.linkedin_user_id IS 'LinkedIn user ID of the post creator (for correct API permissions)';

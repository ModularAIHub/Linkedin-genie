-- Migration: Add account_id and team_id to scheduled_linkedin_posts
-- Purpose: Track which account will be used for scheduled posts

ALTER TABLE scheduled_linkedin_posts 
ADD COLUMN IF NOT EXISTS account_id INTEGER;

ALTER TABLE scheduled_linkedin_posts 
ADD COLUMN IF NOT EXISTS team_id UUID;

-- Index for filtering scheduled posts by account and team
CREATE INDEX IF NOT EXISTS idx_scheduled_linkedin_posts_account_id ON scheduled_linkedin_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_linkedin_posts_team_id ON scheduled_linkedin_posts(team_id);

-- Comments
COMMENT ON COLUMN scheduled_linkedin_posts.account_id IS 'Links to linkedin_team_accounts.id for team posts. NULL for personal posts';
COMMENT ON COLUMN scheduled_linkedin_posts.team_id IS 'References teams table for team posts. NULL for personal posts';

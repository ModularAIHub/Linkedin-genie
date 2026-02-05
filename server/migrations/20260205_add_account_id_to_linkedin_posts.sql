-- Migration: Add account_id to linkedin_posts to track which account was used
-- Purpose: Link posts to either personal (linkedin_auth) or team (linkedin_team_accounts) accounts

ALTER TABLE linkedin_posts 
ADD COLUMN IF NOT EXISTS account_id INTEGER;

ALTER TABLE linkedin_posts 
ADD COLUMN IF NOT EXISTS team_id UUID;

-- Index for filtering posts by account
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_account_id ON linkedin_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_team_id ON linkedin_posts(team_id);

-- Comments
COMMENT ON COLUMN linkedin_posts.account_id IS 'Links to linkedin_team_accounts.id for team posts. NULL for personal posts';
COMMENT ON COLUMN linkedin_posts.team_id IS 'References teams table for team posts. NULL for personal posts';

-- Migration: Create linkedin_team_accounts table for team LinkedIn OAuth
-- Purpose: Allow teams to connect LinkedIn accounts that all team members can use

CREATE TABLE IF NOT EXISTS linkedin_team_accounts (
  id SERIAL PRIMARY KEY,
  team_id UUID NOT NULL,
  user_id UUID NOT NULL,
  linkedin_user_id VARCHAR(255) NOT NULL,
  linkedin_username VARCHAR(255),
  linkedin_display_name VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  linkedin_profile_image_url TEXT,
  connections_count INTEGER DEFAULT 0,
  headline TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, linkedin_user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_team_id ON linkedin_team_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_user_id ON linkedin_team_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_linkedin_user_id ON linkedin_team_accounts(linkedin_user_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_id ON linkedin_team_accounts(id);

-- Comments
COMMENT ON TABLE linkedin_team_accounts IS 'LinkedIn accounts connected to teams that all team members can use';
COMMENT ON COLUMN linkedin_team_accounts.id IS 'Auto-increment primary key for team LinkedIn accounts';
COMMENT ON COLUMN linkedin_team_accounts.team_id IS 'References teams table from new-platform database (shared)';
COMMENT ON COLUMN linkedin_team_accounts.user_id IS 'User who connected this LinkedIn account to the team';
COMMENT ON COLUMN linkedin_team_accounts.linkedin_user_id IS 'LinkedIn URN or user ID';

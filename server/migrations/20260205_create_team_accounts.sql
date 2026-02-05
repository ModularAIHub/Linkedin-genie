-- Migration: Create linkedin_team_accounts table for team LinkedIn OAuth

CREATE TABLE IF NOT EXISTS linkedin_team_accounts (
  id SERIAL PRIMARY KEY,
  team_id UUID NOT NULL,
  user_id UUID NOT NULL,
  linkedin_user_id VARCHAR(128) NOT NULL UNIQUE,
  linkedin_username VARCHAR(128),
  linkedin_display_name VARCHAR(256),
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  linkedin_profile_image_url TEXT,
  connections_count INTEGER,
  headline TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, linkedin_user_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_team_id ON linkedin_team_accounts(team_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_team_accounts_user_id ON linkedin_team_accounts(user_id);

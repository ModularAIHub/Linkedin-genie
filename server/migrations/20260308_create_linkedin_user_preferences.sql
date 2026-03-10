-- Stores the last selected LinkedIn account context per user.
-- Created: 2026-03-08

CREATE TABLE IF NOT EXISTS linkedin_user_preferences (
  user_id UUID PRIMARY KEY,
  selected_account_id VARCHAR(255),
  selected_account_key VARCHAR(255),
  selected_account_type VARCHAR(50),
  selected_team_id VARCHAR(255),
  is_team_account BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_user_preferences_selected_team
  ON linkedin_user_preferences(selected_team_id);

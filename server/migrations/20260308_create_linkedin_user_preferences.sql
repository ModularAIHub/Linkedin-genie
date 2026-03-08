-- Persist selected LinkedIn account preference per user across sessions/logout.
CREATE TABLE IF NOT EXISTS linkedin_user_preferences (
  user_id VARCHAR(255) PRIMARY KEY,
  selected_account_id VARCHAR(255),
  selected_account_key VARCHAR(255),
  selected_account_type VARCHAR(50),
  selected_team_id VARCHAR(255),
  is_team_account BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_user_preferences_selected_account_id
  ON linkedin_user_preferences(selected_account_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_user_preferences_selected_account_key
  ON linkedin_user_preferences(selected_account_key);

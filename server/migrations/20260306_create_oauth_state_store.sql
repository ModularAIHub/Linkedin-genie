-- Durable OAuth state storage for selection flows (personal/team account type selection)
CREATE TABLE IF NOT EXISTS oauth_state_store (
  state TEXT PRIMARY KEY,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_store_expires_at
  ON oauth_state_store(expires_at);

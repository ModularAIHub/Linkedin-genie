-- LinkedIn Context Vault (strategy-scoped memory layer)
-- Created: 2026-03-08

CREATE TABLE IF NOT EXISTS linkedin_context_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID NOT NULL REFERENCES user_strategies(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_context_vault_user
  ON linkedin_context_vault(user_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_context_vault_strategy
  ON linkedin_context_vault(strategy_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_linkedin_context_vault_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_context_vault_updated_at
    BEFORE UPDATE ON linkedin_context_vault
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

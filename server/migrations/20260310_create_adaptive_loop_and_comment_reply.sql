-- Phase 2: Adaptive vault loop + comment reply assist
-- Created: 2026-03-10

CREATE TABLE IF NOT EXISTS linkedin_adaptive_vault_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  reason VARCHAR(64) NOT NULL DEFAULT 'manual',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_adaptive_vault_runs_user_created
  ON linkedin_adaptive_vault_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS linkedin_comment_reply_assist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  post_id UUID,
  source_comment_id TEXT,
  comment_text TEXT NOT NULL,
  comment_author TEXT,
  tone VARCHAR(64) NOT NULL DEFAULT 'professional',
  objective VARCHAR(64) NOT NULL DEFAULT 'engage',
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_comment_reply_assist_user_created
  ON linkedin_comment_reply_assist(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_comment_reply_assist_strategy
  ON linkedin_comment_reply_assist(strategy_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_linkedin_adaptive_vault_runs_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_adaptive_vault_runs_updated_at
    BEFORE UPDATE ON linkedin_adaptive_vault_runs
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_linkedin_comment_reply_assist_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_comment_reply_assist_updated_at
    BEFORE UPDATE ON linkedin_comment_reply_assist
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

-- Persona Core tables (user-level memory + async enrichment jobs)
-- Created: 2026-03-10

CREATE TABLE IF NOT EXISTS linkedin_persona_vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_health JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_vault_user
  ON linkedin_persona_vault(user_id);

CREATE TABLE IF NOT EXISTS linkedin_persona_source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_key TEXT,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_source_snapshots_user
  ON linkedin_persona_source_snapshots(user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_source_snapshots_expiry
  ON linkedin_persona_source_snapshots(expires_at);

CREATE TABLE IF NOT EXISTS linkedin_persona_enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  run_id UUID,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  stage VARCHAR(64) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(64),
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_enrichment_jobs_user_created
  ON linkedin_persona_enrichment_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_enrichment_jobs_strategy
  ON linkedin_persona_enrichment_jobs(strategy_id);

CREATE INDEX IF NOT EXISTS idx_linkedin_persona_enrichment_jobs_status
  ON linkedin_persona_enrichment_jobs(status, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_linkedin_persona_vault_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_persona_vault_updated_at
    BEFORE UPDATE ON linkedin_persona_vault
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
    WHERE tgname = 'trg_linkedin_persona_enrichment_jobs_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_persona_enrichment_jobs_updated_at
    BEFORE UPDATE ON linkedin_persona_enrichment_jobs
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

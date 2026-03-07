-- LinkedIn Genie Automation v1 tables (individual account scope)

CREATE TABLE IF NOT EXISTS linkedin_automation_profile_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  role_niche TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  outcomes_30_90 TEXT DEFAULT '',
  proof_points TEXT DEFAULT '',
  tone_style VARCHAR(64) DEFAULT 'professional',
  consent_use_posts BOOLEAN NOT NULL DEFAULT false,
  consent_store_profile BOOLEAN NOT NULL DEFAULT false,
  consent_updated_at TIMESTAMPTZ,
  last_manual_fetch_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_automation_profile_context_user
  ON linkedin_automation_profile_context(user_id);

CREATE TABLE IF NOT EXISTS linkedin_automation_competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  competitor_profiles JSONB NOT NULL DEFAULT '[]'::jsonb,
  competitor_examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  win_angle VARCHAR(64) DEFAULT 'authority',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_automation_competitors_user
  ON linkedin_automation_competitors(user_id);

CREATE TABLE IF NOT EXISTS linkedin_automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'completed',
  queue_target INTEGER NOT NULL DEFAULT 7,
  analysis_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_automation_runs_user_created
  ON linkedin_automation_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS linkedin_automation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_id UUID,
  title TEXT,
  content TEXT NOT NULL,
  hashtags JSONB NOT NULL DEFAULT '[]'::jsonb,
  suggested_time TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL DEFAULT 'needs_approval',
  rejection_reason TEXT,
  analysis_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_automation_queue_user_status_created
  ON linkedin_automation_queue(user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_automation_queue_run
  ON linkedin_automation_queue(run_id);

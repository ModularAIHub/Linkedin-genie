-- Tracks sent engagement replies from Engagement Assistant.
-- Created: 2026-03-10

CREATE TABLE IF NOT EXISTS linkedin_comment_reply_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  strategy_id UUID REFERENCES user_strategies(id) ON DELETE SET NULL,
  assist_request_id UUID REFERENCES linkedin_comment_reply_assist(id) ON DELETE SET NULL,
  post_id UUID,
  linkedin_post_id TEXT,
  source_comment_id TEXT NOT NULL,
  comment_text TEXT,
  reply_text TEXT NOT NULL,
  reply_urn TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'sent',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_linkedin_comment_reply_events_user_created
  ON linkedin_comment_reply_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_comment_reply_events_source_comment
  ON linkedin_comment_reply_events(user_id, source_comment_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_linkedin_comment_reply_events_updated_at'
  ) THEN
    CREATE TRIGGER trg_linkedin_comment_reply_events_updated_at
    BEFORE UPDATE ON linkedin_comment_reply_events
    FOR EACH ROW
    EXECUTE FUNCTION set_strategy_builder_updated_at();
  END IF;
END;
$$;

-- Notification dedupe/event log for LinkedIn email reminders
-- Created: 2026-03-10

CREATE TABLE IF NOT EXISTS linkedin_notification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  notification_type VARCHAR(64) NOT NULL,
  dedupe_key VARCHAR(255) NOT NULL,
  email_to TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'sent',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, notification_type, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_notification_events_user_type_sent
  ON linkedin_notification_events(user_id, notification_type, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_linkedin_notification_events_sent_at
  ON linkedin_notification_events(sent_at DESC);

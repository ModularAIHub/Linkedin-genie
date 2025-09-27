CREATE TABLE IF NOT EXISTS scheduled_linkedin_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  post_content TEXT NOT NULL,
  media_urls JSONB DEFAULT '[]',
  post_type VARCHAR(32) DEFAULT 'single_post',
  company_id VARCHAR(64),
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(32) DEFAULT 'scheduled',
  error_message TEXT,
  posted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
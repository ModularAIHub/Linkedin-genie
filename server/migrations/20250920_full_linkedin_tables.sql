-- Migration: Create linkedin_auth table for LinkedIn Genie (parity with twitter_auth)
CREATE TABLE IF NOT EXISTS linkedin_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  linkedin_user_id VARCHAR(255) NOT NULL,
  linkedin_username VARCHAR(255),
  linkedin_display_name VARCHAR(255),
  linkedin_profile_image_url TEXT,
  connections_count INTEGER DEFAULT 0,
  headline TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id),
  UNIQUE(linkedin_user_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_auth_user_id ON linkedin_auth(user_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_auth_linkedin_user_id ON linkedin_auth(linkedin_user_id);

-- Migration: Create linkedin_posts table for LinkedIn Genie (parity with tweets)
CREATE TABLE IF NOT EXISTS linkedin_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  linkedin_post_id VARCHAR(64),
  post_content TEXT NOT NULL,
  media_urls JSONB DEFAULT '[]',
  post_type VARCHAR(32) DEFAULT 'single_post',
  company_id VARCHAR(64),
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  status VARCHAR(32) DEFAULT 'draft',
  posted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TIMESTAMP,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_linkedin_posts_user_id ON linkedin_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_status ON linkedin_posts(status);
CREATE INDEX IF NOT EXISTS idx_linkedin_posts_created_at ON linkedin_posts(created_at);

-- Migration: Create scheduled_linkedin_posts table (parity with scheduled_tweets)
CREATE TABLE IF NOT EXISTS scheduled_linkedin_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  linkedin_post_id UUID,
  scheduled_for TIMESTAMP NOT NULL,
  timezone VARCHAR(50) DEFAULT 'UTC',
  status VARCHAR(20) DEFAULT 'pending',
  error_message TEXT,
  posted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



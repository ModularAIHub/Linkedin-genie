-- Add linkedin_user_id column to linkedin_posts table
ALTER TABLE linkedin_posts ADD COLUMN IF NOT EXISTS linkedin_user_id VARCHAR(255);

-- Reset all analytics to zero so they can be populated with real data from LinkedIn API
-- Run this after reconnecting LinkedIn with proper scopes

UPDATE linkedin_posts 
SET 
  views = 0,
  likes = 0,
  comments = 0,
  shares = 0,
  updated_at = NOW()
WHERE status = 'posted';

-- Show how many posts were reset
SELECT COUNT(*) as posts_reset FROM linkedin_posts WHERE status = 'posted';

-- Migration: Remove global UNIQUE constraint on linkedin_user_id
-- Purpose: Allow same LinkedIn account to be connected to multiple teams
-- This keeps the (team_id, linkedin_user_id) composite unique constraint

-- Drop the global unique constraint on linkedin_user_id
ALTER TABLE linkedin_team_accounts DROP CONSTRAINT IF EXISTS linkedin_team_accounts_linkedin_user_id_key;

-- Verify the per-team constraint still exists
-- This ensures same LinkedIn account can't be added twice to the SAME team
-- but CAN be added to DIFFERENT teams

-- Migration: Add account_type support for LinkedIn personal vs organization accounts
-- Allows users to connect either personal profiles or organization pages they manage

-- Add account_type column to linkedin_auth (for personal accounts)
ALTER TABLE linkedin_auth 
ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) DEFAULT 'personal' CHECK (account_type IN ('personal', 'organization'));

-- Add account_type column to linkedin_team_accounts (for team accounts)
ALTER TABLE linkedin_team_accounts 
ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) DEFAULT 'personal' CHECK (account_type IN ('personal', 'organization'));

-- Add organization-specific fields to linkedin_auth
ALTER TABLE linkedin_auth 
ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_vanity_name VARCHAR(255);

-- Add organization-specific fields to linkedin_team_accounts
ALTER TABLE linkedin_team_accounts 
ADD COLUMN IF NOT EXISTS organization_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS organization_vanity_name VARCHAR(255);

-- Comments
COMMENT ON COLUMN linkedin_auth.account_type IS 'Type of LinkedIn account: personal or organization';
COMMENT ON COLUMN linkedin_auth.organization_id IS 'LinkedIn organization ID if account_type is organization';
COMMENT ON COLUMN linkedin_team_accounts.account_type IS 'Type of LinkedIn account: personal or organization';
COMMENT ON COLUMN linkedin_team_accounts.organization_id IS 'LinkedIn organization ID if account_type is organization';

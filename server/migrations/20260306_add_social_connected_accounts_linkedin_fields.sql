-- Migration: align social_connected_accounts with LinkedIn account metadata usage
-- Adds missing LinkedIn-specific fields used by analytics/team/cross-post paths.

ALTER TABLE IF EXISTS social_connected_accounts
ADD COLUMN IF NOT EXISTS account_type VARCHAR(20)
  CHECK (account_type IN ('personal', 'organization'));

ALTER TABLE IF EXISTS social_connected_accounts
ADD COLUMN IF NOT EXISTS organization_id VARCHAR(128);

ALTER TABLE IF EXISTS social_connected_accounts
ADD COLUMN IF NOT EXISTS organization_name VARCHAR(255);

-- Backfill account_type from metadata/account_id for LinkedIn rows.
UPDATE social_connected_accounts
SET account_type = COALESCE(
  NULLIF(account_type, ''),
  NULLIF(metadata->>'account_type', ''),
  CASE
    WHEN account_id LIKE 'org:%' THEN 'organization'
    ELSE 'personal'
  END
)
WHERE platform = 'linkedin';

-- Backfill organization_id for LinkedIn org rows.
UPDATE social_connected_accounts
SET organization_id = COALESCE(
  NULLIF(organization_id, ''),
  NULLIF(metadata->>'organization_id', ''),
  CASE
    WHEN account_id LIKE 'org:%' THEN NULLIF(REPLACE(account_id, 'org:', ''), '')
    ELSE NULL
  END
)
WHERE platform = 'linkedin';

-- Backfill organization_name from metadata if present.
UPDATE social_connected_accounts
SET organization_name = COALESCE(
  NULLIF(organization_name, ''),
  NULLIF(metadata->>'organization_name', '')
)
WHERE platform = 'linkedin';

CREATE INDEX IF NOT EXISTS idx_social_connected_accounts_platform_account_type
  ON social_connected_accounts(platform, account_type);


const normalizeOptionalString = (value, maxLength = 255) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
};

const getMetadata = (row = {}) =>
  row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};

export const getLinkedInAccountType = (row = {}) => {
  const metadata = getMetadata(row);
  const explicitType =
    normalizeOptionalString(row?.account_type, 40) ||
    normalizeOptionalString(metadata?.account_type, 40);

  if (explicitType) return explicitType.toLowerCase();

  const organizationId =
    normalizeOptionalString(row?.organization_id, 255) ||
    normalizeOptionalString(metadata?.organization_id, 255);
  if (organizationId) return 'organization';

  const accountId = normalizeOptionalString(row?.account_id, 255);
  if (accountId?.startsWith('org:')) return 'organization';

  return 'personal';
};

export const getLinkedInOrganizationId = (row = {}) => {
  const metadata = getMetadata(row);
  const directOrganizationId =
    normalizeOptionalString(row?.organization_id, 255) ||
    normalizeOptionalString(metadata?.organization_id, 255);
  if (directOrganizationId) return directOrganizationId;

  const accountId = normalizeOptionalString(row?.account_id, 255);
  if (accountId?.startsWith('org:')) {
    return normalizeOptionalString(accountId.slice(4), 255);
  }

  return null;
};

export const getLinkedInUserId = (row = {}) => {
  const metadata = getMetadata(row);
  const directUserId =
    normalizeOptionalString(row?.linkedin_user_id, 255) ||
    normalizeOptionalString(metadata?.linkedin_user_id, 255);
  if (directUserId) return directUserId;

  const accountId = normalizeOptionalString(row?.account_id, 255);
  if (!accountId || accountId.startsWith('org:')) return null;
  return accountId;
};

export const resolveLinkedInAuthorIdentity = (row = {}) => {
  const accountType = getLinkedInAccountType(row);
  const organizationId = getLinkedInOrganizationId(row);
  const linkedinUserId = getLinkedInUserId(row);

  if (accountType === 'organization' && organizationId) {
    return {
      accountType,
      organizationId,
      linkedinUserId,
      authorUrn: `urn:li:organization:${organizationId}`,
    };
  }

  if (linkedinUserId) {
    return {
      accountType: 'personal',
      organizationId,
      linkedinUserId,
      authorUrn: `urn:li:person:${linkedinUserId}`,
    };
  }

  if (organizationId) {
    return {
      accountType: 'organization',
      organizationId,
      linkedinUserId: null,
      authorUrn: `urn:li:organization:${organizationId}`,
    };
  }

  return {
    accountType,
    organizationId: null,
    linkedinUserId: null,
    authorUrn: null,
  };
};

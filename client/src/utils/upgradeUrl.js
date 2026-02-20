const platformBaseUrl = String(import.meta.env.VITE_PLATFORM_URL || 'https://suitegenie.in').replace(/\/+$/, '');

export const getSuiteGenieProUpgradeUrl = () => `${platformBaseUrl}/plans?intent=pro`;

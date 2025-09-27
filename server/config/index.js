// LinkedIn Genie config for LinkedIn OAuth and platform integration

export function getLinkedInClientId() {
	return process.env.LINKEDIN_CLIENT_ID || '';
}
export function getLinkedInClientSecret() {
	return process.env.LINKEDIN_CLIENT_SECRET || '';
}
export function getLinkedInRedirectUri() {
	return process.env.LINKEDIN_REDIRECT_URI || '';
}
export function getPlatformJwtSecret() {
	return process.env.PLATFORM_JWT_SECRET || '';
}
// ...other config

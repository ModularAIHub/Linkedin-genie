import axios from 'axios';

/**
 * Resolves a LinkedIn asset URN (urn:li:digitalmediaAsset:...) to a public download URL.
 * @param {string} assetUrn - The LinkedIn asset URN.
 * @param {string} accessToken - The user's LinkedIn OAuth access token.
 * @returns {Promise<string>} - The public download URL for the asset.
 */
export async function resolveLinkedInAssetUrl(assetUrn, accessToken) {
  if (!assetUrn.startsWith('urn:li:digitalmediaAsset:')) throw new Error('Invalid LinkedIn asset URN');
  const assetId = assetUrn.replace('urn:li:digitalmediaAsset:', '');
  const url = `https://api.linkedin.com/v2/assets/${assetId}`;
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  // Try to find a usable URL in the response
  const downloadUrl = resp.data.downloadUrl || (resp.data.playableStreams && resp.data.playableStreams[0]?.streamingLocation);
  if (!downloadUrl) throw new Error('No download URL found for asset');
  return downloadUrl;
}

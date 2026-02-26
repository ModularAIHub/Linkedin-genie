import axios from 'axios';

/**
 * Resolves a LinkedIn asset URN (urn:li:digitalmediaAsset:...) to a public download URL.
 *
 * Strategy:
 *  1. Try the new LinkedIn Images REST API (LinkedIn-Version: 202304) — returns a clean downloadUrl
 *  2. Fall back to the legacy v2/assets API (deprecated but still functional for some accounts)
 *  3. Try extracting from playableStreams / recipes as a last resort
 *
 * @param {string} assetUrn   - e.g. "urn:li:digitalmediaAsset:C4D22AQF..."
 * @param {string} accessToken - User's LinkedIn OAuth access token
 * @returns {Promise<string>} - A public https:// URL that can be downloaded
 */
export async function resolveLinkedInAssetUrl(assetUrn, accessToken) {
  if (!assetUrn.startsWith('urn:li:digitalmediaAsset:')) {
    throw new Error(`Invalid LinkedIn asset URN: ${assetUrn}`);
  }

  // ── Strategy 1: New LinkedIn Images REST API (preferred) ──────────────────
  try {
    const url = `https://api.linkedin.com/rest/images/${encodeURIComponent(assetUrn)}`;
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'LinkedIn-Version': '202304',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      timeout: 10000,
    });

    const downloadUrl =
      resp.data?.downloadUrl ||
      resp.data?.originalUrl ||
      resp.data?.value?.downloadUrl;

    if (downloadUrl && downloadUrl.startsWith('http')) {
      return downloadUrl;
    }
  } catch (e) {
    // Log but don't throw — fall through to legacy API
    console.warn('[linkedinAssetResolver] New Images API failed, trying legacy', {
      assetUrn,
      error: e?.response?.status || e?.message,
    });
  }

  // ── Strategy 2: Legacy v2/assets API ──────────────────────────────────────
  try {
    const assetId = assetUrn.replace('urn:li:digitalmediaAsset:', '');
    const url = `https://api.linkedin.com/v2/assets/${assetId}`;
    const resp = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      timeout: 10000,
    });

    const data = resp.data;

    // Try the most common response shapes
    const downloadUrl =
      data?.downloadUrl ||
      data?.value?.downloadUrl ||
      (Array.isArray(data?.playableStreams) && data.playableStreams[0]?.streamingLocation) ||
      (Array.isArray(data?.recipes) && data.recipes[0]?.downloadUrl) ||
      null;

    if (downloadUrl && downloadUrl.startsWith('http')) {
      return downloadUrl;
    }

    // Some responses nest inside serviceRelationships
    if (Array.isArray(data?.serviceRelationships)) {
      for (const rel of data.serviceRelationships) {
        if (rel?.downloadUrl && rel.downloadUrl.startsWith('http')) {
          return rel.downloadUrl;
        }
      }
    }
  } catch (e) {
    console.warn('[linkedinAssetResolver] Legacy v2/assets API also failed', {
      assetUrn,
      error: e?.response?.status || e?.message,
    });
  }

  throw new Error(
    `Could not resolve LinkedIn asset URN to a download URL: ${assetUrn}. ` +
    'Both the Images API and the legacy v2/assets API returned no usable URL.'
  );
}
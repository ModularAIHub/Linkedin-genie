import axios from 'axios';

// Upload image to LinkedIn and return media URL
export async function uploadImageToLinkedIn(accessToken, authorUrn, file) {
  // 1. Register upload with LinkedIn
  const registerUrl = 'https://api.linkedin.com/v2/assets?action=registerUpload';
  const registerBody = {
    registerUploadRequest: {
      owner: authorUrn,
      recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
      serviceRelationships: [
        {
          identifier: 'urn:li:userGeneratedContent',
          relationshipType: 'OWNER',
        },
      ],
      supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD']
    }
  };
  const registerRes = await axios.post(registerUrl, registerBody, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  const uploadUrl = registerRes.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
  const asset = registerRes.data.value.asset;

  // 2. Upload image binary to LinkedIn
  await axios.post(uploadUrl, file.buffer, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': file.mimetype,
      'Content-Length': file.size,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  // 3. Return asset URN (to be used as media URL in post)
  return asset;
}

// Upload document (PDF) to LinkedIn and return media URL
export async function uploadDocumentToLinkedIn(accessToken, authorUrn, file) {
  console.log('[LINKEDIN SERVICE] uploadDocumentToLinkedIn called', {
    hasAccessToken: !!accessToken,
    authorUrn,
    fileSize: file.size,
    fileMimetype: file.mimetype,
    fileName: file.originalname
  });
  
  try {
    // 1. Register upload with LinkedIn for document
    const registerUrl = 'https://api.linkedin.com/v2/assets?action=registerUpload';
    const registerBody = {
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-document'],
        owner: authorUrn,
        serviceRelationships: [
          {
            relationshipType: 'OWNER',
            identifier: 'urn:li:userGeneratedContent'
          }
        ]
      }
    };
    
    console.log('[LINKEDIN SERVICE] Registering upload with LinkedIn...', { registerUrl, registerBody: JSON.stringify(registerBody, null, 2) });
    
    const registerRes = await axios.post(registerUrl, registerBody, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    
    console.log('[LINKEDIN SERVICE] Register response:', registerRes.data);
    
    const uploadUrl = registerRes.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = registerRes.data.value.asset;
    
    console.log('[LINKEDIN SERVICE] Upload URL obtained:', uploadUrl);
    console.log('[LINKEDIN SERVICE] Asset URN:', asset);

    // 2. Upload document binary to LinkedIn
    console.log('[LINKEDIN SERVICE] Uploading document binary to LinkedIn...');
    
    await axios.put(uploadUrl, file.buffer, {
      headers: {
        'Content-Type': file.mimetype,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    
    console.log('[LINKEDIN SERVICE] Document binary uploaded successfully');

    // 3. Return asset URN (to be used as media URL in post)
    console.log('[LINKEDIN SERVICE] Returning asset URN:', asset);
    return asset;
  } catch (error) {
    console.error('[LINKEDIN SERVICE] Error in uploadDocumentToLinkedIn:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      stack: error.stack
    });
    throw error;
  }
}

// Exchange code for access token
export async function exchangeCodeForToken(code, redirectUri, clientId, clientSecret) {
  const url = 'https://www.linkedin.com/oauth/v2/accessToken';
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  });
  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return response.data;
}

// Refresh LinkedIn access token using stored refresh token
export async function refreshLinkedInAccessToken(refreshToken) {
  const safeRefreshToken = String(refreshToken || '').trim();
  if (!safeRefreshToken) {
    throw new Error('LinkedIn refresh token is missing');
  }

  const clientId = String(process.env.LINKEDIN_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.LINKEDIN_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn client credentials are not configured');
  }

  const url = 'https://www.linkedin.com/oauth/v2/accessToken';
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: safeRefreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  return response.data;
}

// Post content to LinkedIn (supports media, carousels, company page)
export async function createLinkedInPost(accessToken, authorUrn, post_content, media_urls = [], post_type = 'single_post', company_id) {
  const url = 'https://api.linkedin.com/v2/ugcPosts';
  let shareMediaCategory = 'NONE';
  let media = [];
  if (media_urls.length > 0) {
    shareMediaCategory = 'IMAGE';
    media = media_urls.map(url => ({ status: 'READY', media: url }));
  }
    let authorField = authorUrn;
    if (!authorField && company_id && company_id !== 'null' && company_id !== 'undefined' && String(company_id).match(/^[0-9]+$/)) {
      authorField = `urn:li:organization:${company_id}`;
    }
    if (!authorField) {
      throw new Error('LinkedIn author URN is required');
    }
    const body = {
      author: authorField,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: post_content },
          shareMediaCategory,
          ...(media.length > 0 && { media })
        }
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    };
  try {
    const response = await axios.post(url, body, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Type': 'application/json'
      }
    });
    console.log('[LinkedIn API RESPONSE]', {
      status: response.status,
      data: response.data
    });
    return response.data;
  } catch (error) {
    console.error('[LinkedIn API ERROR]', {
      message: error.message,
      data: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers,
      body,
      accessTokenPreview: accessToken?.substring(0, 8) + '...'
    });
    if (error.response?.data) {
      console.error('[LinkedIn API ERROR - FULL RESPONSE]', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Delete a LinkedIn post
export async function deleteLinkedInPost(accessToken, postUrn) {
  // Extract numeric ID from URN (e.g., urn:li:share:7377769581513277440 => 7377769581513277440)
  const match = postUrn.match(/([0-9]+)$/);
  const shareId = match ? match[1] : postUrn;
  const url = `https://api.linkedin.com/v2/shares/${shareId}`;
  const response = await axios.delete(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
    }
  });
  return response.data;
}

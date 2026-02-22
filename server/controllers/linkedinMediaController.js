// POST /api/linkedin/upload-image-base64
export async function uploadImageBase64(req, res) {
  try {
    const user = req.user;
    if (!user) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get account_id from request (for team accounts)
    const accountId = req.body.account_id || req.headers['x-selected-account-id'];
    
    let accessToken, authorUrn;
    
    // If account_id is provided and not null, fetch team account credentials
    if (accountId && accountId !== 'null' && accountId !== 'undefined') {
      const { pool } = await import('../config/database.js');
      // Ensure accountId is a string before calling includes
      const accountIdStr = typeof accountId === 'string' ? accountId : String(accountId);
      const isUUID = accountIdStr.includes('-');
      let teamAccountResult;
      
      if (isUUID) {
        // Query by team_id if it's a UUID
        console.log('[UPLOAD IMAGE BASE64] Account ID is UUID, querying by team_id:', accountIdStr);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
          [accountIdStr]
        );
      } else {
        // Query by id if it's an integer
        console.log('[UPLOAD IMAGE BASE64] Account ID is integer, querying by id:', accountIdStr);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE id = $1 AND active = true`,
          [accountIdStr]
        );
      }
      
      if (teamAccountResult.rows.length === 0) {
        console.error('[UPLOAD IMAGE BASE64 ERROR] Team account not found for', isUUID ? 'team_id' : 'id', ':', accountId);
        return res.status(400).json({ error: 'LinkedIn team account not found' });
      }
      
      accessToken = teamAccountResult.rows[0].access_token;
      authorUrn = `urn:li:person:${teamAccountResult.rows[0].linkedin_user_id}`;
      console.log('[UPLOAD IMAGE BASE64] Using team account credentials');
    } else {
      // Fallback to personal account
      accessToken = user.linkedinAccessToken;
      authorUrn = user.linkedinUrn;
      console.log('[UPLOAD IMAGE BASE64] Using personal account for user:', user.id);
    }
    
    if (!accessToken || !authorUrn) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] LinkedIn account not connected', { 
        hasAccessToken: !!accessToken, 
        hasAuthorUrn: !!authorUrn, 
        accountId,
        userId: user.id,
        hasPersonalToken: !!user.linkedinAccessToken
      });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    const { base64, mimetype, filename } = req.body;
    if (!base64 || !mimetype) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] Missing base64 or mimetype', req.body);
      return res.status(400).json({ error: 'Missing base64 or mimetype' });
    }
    // Decode base64 to buffer
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch (err) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] Failed to decode base64', err);
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }
    if (!buffer || !buffer.length) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] Buffer is empty after decoding');
      return res.status(400).json({ error: 'Decoded image buffer is empty' });
    }
    // Create a file-like object
    const file = { buffer, mimetype, size: buffer.length, originalname: filename || 'image.jpg' };
    // Upload image to LinkedIn and get media URL
    let mediaUrl;
    try {
      mediaUrl = await linkedinService.uploadImageToLinkedIn(accessToken, authorUrn, file);
    } catch (err) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] LinkedIn upload failed', err && (err.response?.data || err.message || err));
      return res.status(500).json({ error: 'LinkedIn upload failed', details: err.response?.data || err.message || err });
    }
    res.json({ url: mediaUrl });
  } catch (error) {
    console.error('[UPLOAD IMAGE BASE64 ERROR] Unexpected error', error);
    res.status(500).json({ error: error.message || 'Failed to upload image to LinkedIn', details: error });
  }
}
import * as linkedinService from '../services/linkedinService.js';

// POST /api/linkedin/upload-image
export async function uploadImage(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    
    // Get account_id from request (for team accounts)
    const accountId = req.body.account_id || req.headers['x-selected-account-id'];
    
    let accessToken, authorUrn;
    
    // If account_id is provided and not null, fetch team account credentials
    if (accountId && accountId !== 'null' && accountId !== 'undefined') {
      const { pool } = await import('../config/database.js');
      // Check if accountId looks like a UUID (has hyphens) vs an integer
      const isUUID = accountId.includes('-');
      let teamAccountResult;
      
      if (isUUID) {
        // Query by team_id if it's a UUID
        console.log('[UPLOAD IMAGE] Account ID is UUID, querying by team_id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
          [accountId]
        );
      } else {
        // Query by id if it's an integer
        console.log('[UPLOAD IMAGE] Account ID is integer, querying by id:', accountId);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE id = $1 AND active = true`,
          [accountId]
        );
      }
      
      if (teamAccountResult.rows.length === 0) {
        console.error('[UPLOAD IMAGE ERROR] Team account not found for', isUUID ? 'team_id' : 'id', ':', accountId);
        return res.status(400).json({ error: 'LinkedIn team account not found' });
      }
      
      accessToken = teamAccountResult.rows[0].access_token;
      authorUrn = `urn:li:person:${teamAccountResult.rows[0].linkedin_user_id}`;
      console.log('[UPLOAD IMAGE] Using team account credentials');
    } else {
      // Fallback to personal account
      accessToken = user.linkedinAccessToken;
      authorUrn = user.linkedinUrn;
      console.log('[UPLOAD IMAGE] Using personal account for user:', user.id);
    }
    
    if (!accessToken || !authorUrn) {
      console.error('[UPLOAD IMAGE ERROR] LinkedIn account not connected', { 
        hasAccessToken: !!accessToken, 
        hasAuthorUrn: !!authorUrn, 
        accountId,
        userId: user.id,
        hasPersonalToken: !!user.linkedinAccessToken
      });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Upload image to LinkedIn and get media URL
    const mediaUrl = await linkedinService.uploadImageToLinkedIn(accessToken, authorUrn, req.file);
    res.json({ url: mediaUrl });
  } catch (error) {
    console.error('[UPLOAD IMAGE ERROR]', error);
    res.status(500).json({ error: error.message || 'Failed to upload image to LinkedIn' });
  }
}


// POST /api/linkedin/upload-document-base64
export async function uploadDocumentBase64(req, res) {
  console.log('[UPLOAD DOCUMENT BASE64] Request received');
  try {
    const user = req.user;
    if (!user) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    console.log('[UPLOAD DOCUMENT BASE64] User authenticated:', user.id);
    
    // Get account_id from request (for team accounts)
    const accountId = req.body.account_id || req.headers['x-selected-account-id'];
    console.log('[UPLOAD DOCUMENT BASE64] Account ID:', accountId);
    
    let accessToken, authorUrn;
    
    // If account_id is provided and not null, fetch team account credentials
    if (accountId && accountId !== 'null' && accountId !== 'undefined') {
      const { pool } = await import('../config/database.js');
      const accountIdStr = typeof accountId === 'string' ? accountId : String(accountId);
      const isUUID = accountIdStr.includes('-');
      let teamAccountResult;
      
      if (isUUID) {
        console.log('[UPLOAD DOCUMENT BASE64] Account ID is UUID, querying by team_id:', accountIdStr);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE team_id = $1 AND active = true LIMIT 1`,
          [accountIdStr]
        );
      } else {
        console.log('[UPLOAD DOCUMENT BASE64] Account ID is integer, querying by id:', accountIdStr);
        teamAccountResult = await pool.query(
          `SELECT access_token, linkedin_user_id FROM linkedin_team_accounts WHERE id = $1 AND active = true`,
          [accountIdStr]
        );
      }
      
      if (teamAccountResult.rows.length === 0) {
        console.error('[UPLOAD DOCUMENT BASE64 ERROR] Team account not found for', isUUID ? 'team_id' : 'id', ':', accountId);
        return res.status(400).json({ error: 'LinkedIn team account not found' });
      }
      
      accessToken = teamAccountResult.rows[0].access_token;
      authorUrn = `urn:li:person:${teamAccountResult.rows[0].linkedin_user_id}`;
      console.log('[UPLOAD DOCUMENT BASE64] Using team account credentials');
    } else {
      // Fallback to personal account
      accessToken = user.linkedinAccessToken;
      authorUrn = user.linkedinUrn;
      console.log('[UPLOAD DOCUMENT BASE64] Using personal account for user:', user.id);
    }
    
    if (!accessToken || !authorUrn) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] LinkedIn account not connected', { 
        hasAccessToken: !!accessToken, 
        hasAuthorUrn: !!authorUrn, 
        accountId,
        userId: user.id,
        hasPersonalToken: !!user.linkedinAccessToken
      });
      return res.status(400).json({ error: 'LinkedIn account not connected' });
    }
    
    const { base64, mimetype, filename } = req.body;
    console.log('[UPLOAD DOCUMENT BASE64] Request body:', { 
      hasBase64: !!base64, 
      base64Length: base64?.length, 
      mimetype, 
      filename 
    });
    
    if (!base64 || !mimetype) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] Missing base64 or mimetype', req.body);
      return res.status(400).json({ error: 'Missing base64 or mimetype' });
    }
    
    // Decode base64 to buffer
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
      console.log('[UPLOAD DOCUMENT BASE64] Buffer created, size:', buffer.length);
    } catch (err) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] Failed to decode base64', err);
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }
    
    if (!buffer || !buffer.length) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] Buffer is empty after decoding');
      return res.status(400).json({ error: 'Decoded document buffer is empty' });
    }
    
    // Create a file-like object
    const file = { buffer, mimetype, size: buffer.length, originalname: filename || 'document.pdf' };
    console.log('[UPLOAD DOCUMENT BASE64] File object created:', { 
      size: file.size, 
      mimetype: file.mimetype, 
      originalname: file.originalname 
    });
    
    // Upload document to LinkedIn and get media URL
    let mediaUrl;
    try {
      console.log('[UPLOAD DOCUMENT BASE64] Calling uploadDocumentToLinkedIn...');
      mediaUrl = await linkedinService.uploadDocumentToLinkedIn(accessToken, authorUrn, file);
      console.log('[UPLOAD DOCUMENT BASE64] Upload successful, mediaUrl:', mediaUrl);
    } catch (err) {
      console.error('[UPLOAD DOCUMENT BASE64 ERROR] LinkedIn upload failed', err && (err.response?.data || err.message || err));
      return res.status(500).json({ error: 'LinkedIn upload failed', details: err.response?.data || err.message || err });
    }
    
    console.log('[UPLOAD DOCUMENT BASE64] Sending success response');
    res.json({ url: mediaUrl });
  } catch (error) {
    console.error('[UPLOAD DOCUMENT BASE64 ERROR] Unexpected error', error);
    res.status(500).json({ error: error.message || 'Failed to upload document to LinkedIn', details: error });
  }
}

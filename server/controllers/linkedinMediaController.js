// POST /api/linkedin/upload-image-base64
export async function uploadImageBase64(req, res) {
  try {
    const user = req.user;
    if (!user) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] Not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const accessToken = user.linkedinAccessToken;
    const authorUrn = user.linkedinUrn;
    if (!accessToken || !authorUrn) {
      console.error('[UPLOAD IMAGE BASE64 ERROR] LinkedIn account not connected', { accessToken, authorUrn });
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
    const accessToken = user.linkedinAccessToken;
    const authorUrn = user.linkedinUrn;
    if (!accessToken || !authorUrn) return res.status(400).json({ error: 'LinkedIn account not connected' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Upload image to LinkedIn and get media URL
    const mediaUrl = await linkedinService.uploadImageToLinkedIn(accessToken, authorUrn, req.file);
    res.json({ url: mediaUrl });
  } catch (error) {
    console.error('[UPLOAD IMAGE ERROR]', error);
    res.status(500).json({ error: error.message || 'Failed to upload image to LinkedIn' });
  }
}

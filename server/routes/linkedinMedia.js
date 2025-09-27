import express from 'express';
import * as linkedinMediaController from '../controllers/linkedinMediaController.js';

const router = express.Router();

// POST /api/linkedin/upload-image-base64 - Upload image as base64 in JSON
router.post('/upload-image-base64', linkedinMediaController.uploadImageBase64);

// (Optional) Keep the old multipart route for compatibility
// (Removed old multipart upload route; only base64 JSON upload is supported)

export default router;

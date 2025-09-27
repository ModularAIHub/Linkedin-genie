import express from 'express';
import * as linkedinController from '../controllers/linkedinController.js';

const router = express.Router();

// GET /api/linkedin/status - Returns connected LinkedIn account info
router.get('/status', linkedinController.getStatus);

// GET /api/linkedin/connect - Initiate LinkedIn OAuth
router.get('/connect', linkedinController.startOAuth);

// POST /api/linkedin/disconnect - Disconnect LinkedIn account
router.post('/disconnect', linkedinController.disconnect);

// GET /api/linkedin/profile - Get LinkedIn profile info
router.get('/profile', linkedinController.getProfile);

export default router;

// LinkedIn Genie OAuth routes
import express from 'express';
import * as oauthController from '../controllers/oauthController.mjs';

const router = express.Router();
router.get('/linkedin', oauthController.startOAuth);
router.get('/linkedin/callback', oauthController.handleOAuthCallback);

export default router;

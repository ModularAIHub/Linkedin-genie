// LinkedIn Genie OAuth routes
import express from 'express';
import * as oauthController from '../controllers/oauthController.mjs';

const router = express.Router();

// Personal LinkedIn OAuth
router.get('/linkedin', oauthController.startOAuth);
router.get('/linkedin/callback', oauthController.handleOAuthCallback);

// Team LinkedIn OAuth (called from new-platform team page)
router.get('/linkedin/team-connect', oauthController.startTeamOAuth);

// Select account type (personal vs organization) - for personal accounts
router.post('/linkedin/select-account-type', oauthController.selectAccountType);

// Complete team account selection (personal vs organization page)
router.post('/linkedin/complete-team-selection', oauthController.completeTeamAccountSelection);

export default router;

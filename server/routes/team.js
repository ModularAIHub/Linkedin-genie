import express from 'express';
import * as teamController from '../controllers/teamController.js';

const router = express.Router();

// Get all LinkedIn accounts (personal + team accounts)
router.get('/accounts', teamController.getAccounts);

// Get teams the user belongs to
router.get('/teams', teamController.getTeams);

// Connect user's LinkedIn account to a team
router.post('/connect', teamController.connectTeamAccount);

// Disconnect a LinkedIn account from a team
router.delete('/accounts/:accountId', teamController.disconnectTeamAccount);

// Set selected LinkedIn account (stores in session/context)
router.post('/select-account', teamController.selectAccount);

export default router;

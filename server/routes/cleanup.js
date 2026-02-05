// cleanup.js
// Routes for cleaning up LinkedIn data when users/teams are deleted

import express from 'express';
import { cleanupController } from '../controllers/cleanupController.js';

const router = express.Router();

// Clean up user's LinkedIn data
router.post('/user', cleanupController.cleanupUserData);

// Clean up team's LinkedIn data
router.post('/team', cleanupController.cleanupTeamData);

export default router;

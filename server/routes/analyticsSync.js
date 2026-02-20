import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';
import { requireProPlan } from '../middleware/planAccess.js';
import { requirePlatformLogin } from '../middleware/requirePlatformLogin.js';

const router = express.Router();

// POST /api/analytics/sync - Sync analytics from LinkedIn
router.post('/sync', requirePlatformLogin, requireProPlan('Sync Latest'), analyticsController.syncAnalytics);

export default router;

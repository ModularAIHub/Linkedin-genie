import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';

const router = express.Router();

// POST /api/analytics/sync - Sync analytics from LinkedIn
router.post('/sync', analyticsController.syncAnalytics);

export default router;

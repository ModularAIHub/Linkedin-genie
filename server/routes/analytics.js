import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';

const router = express.Router();
router.get('/', analyticsController.getAnalytics);
// Add /overview route for frontend compatibility
router.get('/overview', analyticsController.getAnalytics);

export default router;

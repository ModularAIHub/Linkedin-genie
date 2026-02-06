
import express from 'express';
import * as analyticsController from '../controllers/analyticsController.js';
import { requirePlatformLogin } from '../middleware/requirePlatformLogin.js';



const router = express.Router();
router.get('/', requirePlatformLogin, analyticsController.getAnalytics);
// Add /overview route for frontend compatibility
router.get('/overview', requirePlatformLogin, analyticsController.getAnalytics);
// Add /sync route for analytics sync
router.post('/sync', requirePlatformLogin, analyticsController.syncAnalytics);

export default router;

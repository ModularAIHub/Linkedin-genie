
import express from 'express';
import * as scheduleController from '../controllers/scheduleController.js';
const router = express.Router();

router.post('/', scheduleController.schedulePost);
router.post('/bulk', scheduleController.bulkSchedulePosts);
router.get('/', scheduleController.getScheduledPosts);
router.get('/status', scheduleController.getSchedulerStatus);
router.post('/cancel', scheduleController.cancelScheduledPost);
router.post('/retry', scheduleController.retryFailedScheduledPost);
router.delete('/:id', scheduleController.deleteScheduledPost);

export default router;

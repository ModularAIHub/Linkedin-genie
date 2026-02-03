
import express from 'express';
import * as scheduleController from '../controllers/scheduleController.js';
const router = express.Router();

router.post('/', scheduleController.schedulePost);
router.post('/bulk', scheduleController.bulkSchedulePosts);
router.get('/', scheduleController.getScheduledPosts);
router.delete('/:id', scheduleController.cancelScheduledPost);

export default router;

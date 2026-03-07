import express from 'express';
import {
  getProfileContext,
  saveProfileContext,
  saveCompetitors,
  runAutomation,
  getQueue,
  patchQueueItem,
  fetchLatest,
} from '../controllers/automationController.js';

const router = express.Router();

router.get('/profile-context', getProfileContext);
router.post('/profile-context', saveProfileContext);
router.put('/competitors', saveCompetitors);
router.post('/run', runAutomation);
router.get('/queue', getQueue);
router.patch('/queue/:id', patchQueueItem);
router.post('/fetch-latest', fetchLatest);

export default router;

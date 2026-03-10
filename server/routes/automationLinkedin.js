import express from 'express';
import {
  getProfileContext,
  saveProfileContext,
  saveCompetitors,
  runAutomation,
  getQueue,
  patchQueueItem,
  fetchLatest,
  runAdaptiveVaultLoop,
  getLatestAdaptiveVaultLoop,
  getCommentReplyInbox,
  generateCommentReplyAssist,
  sendCommentReplyAssist,
  getCommentReplyAssistHistory,
} from '../controllers/automationController.js';
import { requireProPlan } from '../middleware/planAccess.js';

const router = express.Router();
router.use(requireProPlan('LinkedIn Automation'));

router.get('/profile-context', getProfileContext);
router.post('/profile-context', saveProfileContext);
router.put('/competitors', saveCompetitors);
router.post('/run', runAutomation);
router.get('/queue', getQueue);
router.patch('/queue/:id', patchQueueItem);
router.post('/fetch-latest', fetchLatest);
router.post('/adaptive-vault-loop/run', runAdaptiveVaultLoop);
router.get('/adaptive-vault-loop/latest', getLatestAdaptiveVaultLoop);
router.get('/comment-reply/inbox', getCommentReplyInbox);
router.post('/comment-reply/generate', generateCommentReplyAssist);
router.post('/comment-reply/send', sendCommentReplyAssist);
router.get('/comment-reply/history', getCommentReplyAssistHistory);

export default router;

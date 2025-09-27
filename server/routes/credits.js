import express from 'express';
import * as creditController from '../controllers/creditController.js';
import { requirePlatformLogin } from '../middleware/requirePlatformLogin.js';
const router = express.Router();

router.get('/balance', requirePlatformLogin, creditController.getBalance);
router.get('/history', requirePlatformLogin, creditController.getHistory);
router.get('/pricing', requirePlatformLogin, creditController.getPricing);
router.post('/refund', requirePlatformLogin, creditController.refund);

export default router;

import express from 'express';
import { bulkGenerate } from '../controllers/aiController.js';
import { requireProPlan } from '../middleware/planAccess.js';
const router = express.Router();


// Bulk AI content generation endpoint
router.post('/bulk-generate', requireProPlan('Bulk Generation'), bulkGenerate);

export default router;

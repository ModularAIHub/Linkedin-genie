
import express from 'express';
import * as aiController from '../controllers/aiController.js';
const router = express.Router();

// AI content generation for LinkedIn posts

router.post('/generate', aiController.generateContent);
router.post('/bulk-generate', aiController.bulkGenerate);

export default router;

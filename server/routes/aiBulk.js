import express from 'express';
import { bulkGenerate } from '../controllers/aiController.js';
const router = express.Router();


// Bulk AI content generation endpoint
router.post('/bulk-generate', bulkGenerate);

export default router;

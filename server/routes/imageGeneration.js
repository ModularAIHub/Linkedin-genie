
import express from 'express';
import * as imageGenerationController from '../controllers/imageGenerationController.js';
const router = express.Router();

// AI image generation for LinkedIn posts
router.post('/generate', imageGenerationController.generateImage);

export default router;

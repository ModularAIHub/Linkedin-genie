import express from 'express';
import authRoutes from './auth.js';
import postsRoutes from './posts.js';
import scheduleRoutes from './schedule.js';
import analyticsRoutes from './analytics.js';
import analyticsSyncRoutes from './analyticsSync.js';
import linkedinRoutes from './linkedin.js';
import linkedinMediaRoutes from './linkedinMedia.js';
import userRoutes from './user.js';
import aiRoutes from './ai.js';
import aiBulkRoutes from './aiBulk.js';
import imageGenerationRoutes from './imageGeneration.js';
import creditsRoutes from './credits.js';

const router = express.Router();
router.use('/auth', authRoutes);
router.use('/posts', postsRoutes);
router.use('/schedule', scheduleRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/analytics', analyticsSyncRoutes);
router.use('/linkedin', linkedinRoutes);
router.use('/linkedin', linkedinMediaRoutes);
router.use('/user', userRoutes);
router.use('/ai', aiRoutes);
router.use('/ai', aiBulkRoutes);
router.use('/image-generation', imageGenerationRoutes);
router.use('/credits', creditsRoutes);

export default router;


import express from 'express';
import * as postController from '../controllers/postController.js';
const router = express.Router();

// Create a LinkedIn post
router.post('/', postController.createPost);
// Fetch user's LinkedIn posts
router.get('/', postController.getPosts);
// Delete a LinkedIn post
router.delete('/:id', postController.deletePost);
// AI content generation for LinkedIn posts
router.post('/ai-generate', postController.aiGenerate);

export default router;

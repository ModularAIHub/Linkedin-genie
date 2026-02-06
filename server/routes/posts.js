
import express from 'express';
import { createPost, getPosts, deletePost, aiGenerate } from '../controllers/postController.js';

const router = express.Router();

// Create a LinkedIn post
router.post('/', createPost);
// Fetch user's LinkedIn posts
router.get('/', getPosts);
// Delete a LinkedIn post
router.delete('/:id', deletePost);
// AI content generation for LinkedIn posts
router.post('/ai-generate', aiGenerate);

export default router;

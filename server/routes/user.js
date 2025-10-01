
import express from 'express';
import * as userController from '../controllers/userController.js';
const router = express.Router();



router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
// Add user status route for /api/user/status
router.get('/status', userController.getUserStatus);

// Add BYOK/platform mode route for /api/user/api-key-preference
router.get('/api-key-preference', userController.getApiKeyPreference);

// Add BYOK keys route for /api/user/byok-keys
router.get('/byok-keys', userController.getByokKeys);

export default router;

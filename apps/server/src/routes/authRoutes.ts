import { Router } from 'express';
import { register, login, refreshToken, getMe } from '../controllers/authController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.get('/me', authenticateToken, getMe);

export default router;
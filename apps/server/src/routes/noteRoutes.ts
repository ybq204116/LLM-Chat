import { Router } from 'express';
import {
    getNotes,
    getNote,
    createNote,
    updateNote,
    deleteNote,
    togglePinNote
} from '../controllers/noteController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', getNotes);
router.get('/:noteId', getNote);
router.post('/', createNote);
router.patch('/:noteId', updateNote);
router.delete('/:noteId', deleteNote);
router.patch('/:noteId/toggle-pin', togglePinNote);

export default router;
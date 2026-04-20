import { Router } from 'express';
import {
    getNotes,
    getNote,
    createNote,
    updateNote,
    deleteNote,
    togglePinNote,
    createNoteImageUploadToken
} from '../controllers/noteController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

router.use(authenticateToken);

router.get('/', getNotes);
router.post('/files/upload-token', createNoteImageUploadToken);
router.get('/:noteId', getNote);
router.post('/', createNote);
router.patch('/:noteId', updateNote);
router.delete('/:noteId', deleteNote);
router.patch('/:noteId/toggle-pin', togglePinNote);

export default router;

import { Request, Response } from 'express';
import { Note } from '../models/Note';

interface AuthRequest extends Request {
    user?: any;
}

export const getNotes = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.userId;
        const notes = await Note.find({ userId }).sort({ isPinned: -1, updatedAt: -1 });
        res.json(notes);
    } catch (error) {
        res.status(500).json({ message: '获取笔记列表失败', error });
    }
};

export const getNote = async (req: AuthRequest, res: Response) => {
    try {
        const { noteId } = req.params;
        const note = await Note.findById(noteId);
        if (!note) {
            return res.status(404).json({ message: '笔记不存在' });
        }
        res.json(note);
    } catch (error) {
        res.status(500).json({ message: '获取笔记失败', error });
    }
};

export const createNote = async (req: AuthRequest, res: Response) => {
    try {
        const { title, content } = req.body;
        const userId = req.user.userId;

        const note = new Note({
            userId,
            title: title || '无标题笔记',
            content: content || ''
        });

        await note.save();
        res.status(201).json(note);
    } catch (error) {
        res.status(500).json({ message: '创建笔记失败', error });
    }
};

export const updateNote = async (req: AuthRequest, res: Response) => {
    try {
        const { noteId } = req.params;
        const { title, content, isPinned } = req.body;

        const note = await Note.findByIdAndUpdate(
            noteId,
            { title, content, isPinned, updatedAt: new Date() },
            { new: true }
        );

        if (!note) {
            return res.status(404).json({ message: '笔记不存在' });
        }

        res.json(note);
    } catch (error) {
        res.status(500).json({ message: '更新笔记失败', error });
    }
};

export const deleteNote = async (req: AuthRequest, res: Response) => {
    try {
        const { noteId } = req.params;
        const note = await Note.findByIdAndDelete(noteId);

        if (!note) {
            return res.status(404).json({ message: '笔记不存在' });
        }

        res.json({ message: '笔记已删除', id: noteId });
    } catch (error) {
        res.status(500).json({ message: '删除笔记失败', error });
    }
};

export const togglePinNote = async (req: AuthRequest, res: Response) => {
    try {
        const { noteId } = req.params;
        const note = await Note.findById(noteId);

        if (!note) {
            return res.status(404).json({ message: '笔记不存在' });
        }

        note.isPinned = !note.isPinned;
        note.updatedAt = new Date();
        await note.save();

        res.json(note);
    } catch (error) {
        res.status(500).json({ message: '切换置顶状态失败', error });
    }
};
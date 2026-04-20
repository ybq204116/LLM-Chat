import { Request, Response } from 'express';
import { Note } from '../models/Note';
import crypto from 'crypto';
import path from 'path';
import qiniu from 'qiniu';

interface AuthRequest extends Request {
    user?: any;
}

const DEFAULT_QINIU_UPLOAD_HOST = 'https://upload.qiniup.com';
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const QINIU_REGION_UPLOAD_HOSTS: Record<string, string> = {
    z0: 'https://upload.qiniup.com',
    z1: 'https://upload-z1.qiniup.com',
    z2: 'https://upload-z2.qiniup.com',
    na0: 'https://upload-na0.qiniup.com',
    as0: 'https://upload-as0.qiniup.com',
    'cn-east-2': 'https://upload-cn-east-2.qiniup.com'
};

const resolveQiniuConfig = () => {
    const accessKey = process.env.QINIU_ACCESS_KEY;
    const secretKey = process.env.QINIU_SECRET_KEY;
    const bucket = process.env.QINIU_BUCKET;
    const publicDomain = process.env.QINIU_PUBLIC_DOMAIN;
    const region = (process.env.QINIU_REGION || '').trim();
    const uploadHost = process.env.QINIU_UPLOAD_HOST
        || QINIU_REGION_UPLOAD_HOSTS[region]
        || DEFAULT_QINIU_UPLOAD_HOST;

    if (!accessKey || !secretKey || !bucket || !publicDomain) {
        return null;
    }

    return { accessKey, secretKey, bucket, publicDomain, uploadHost };
};

const extractExtension = (fileName: string = '', fileType: string = ''): string => {
    const extFromName = path.extname(fileName).toLowerCase();
    if (extFromName) return extFromName;

    const mimeToExt: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
    };

    return mimeToExt[fileType] || '.png';
};

const buildPublicUrl = (domain: string, key: string): string => {
    const normalizedDomain = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    return `${normalizedDomain.replace(/\/$/, '')}/${key}`;
};

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

export const createNoteImageUploadToken = async (req: AuthRequest, res: Response) => {
    try {
        const qiniuConfig = resolveQiniuConfig();
        if (!qiniuConfig) {
            return res.status(500).json({ message: '七牛云配置不完整' });
        }

        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ message: '未授权' });
        }

        const { fileName = '', fileType = '', fileSize = 0 } = req.body || {};
        if (!fileType || !fileType.startsWith('image/')) {
            return res.status(400).json({ message: '仅支持图片文件上传' });
        }

        if (Number(fileSize) > MAX_IMAGE_SIZE_BYTES) {
            return res.status(400).json({ message: '图片大小不能超过 10MB' });
        }

        const ext = extractExtension(fileName, fileType);
        const key = `${crypto.randomUUID()}${ext}`;

        const mac = new qiniu.auth.digest.Mac(qiniuConfig.accessKey, qiniuConfig.secretKey);
        const putPolicy = new qiniu.rs.PutPolicy({
            scope: `${qiniuConfig.bucket}:${key}`,
            expires: 3600
        });
        const uploadToken = putPolicy.uploadToken(mac);

        return res.json({
            uploadToken,
            uploadHost: qiniuConfig.uploadHost,
            key,
            url: buildPublicUrl(qiniuConfig.publicDomain, key)
        });
    } catch (error) {
        return res.status(500).json({ message: '生成上传凭证失败', error });
    }
};

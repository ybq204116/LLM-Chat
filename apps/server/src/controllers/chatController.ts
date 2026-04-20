import { Request, Response } from 'express';
import { Conversation, Message } from '../models/Chat';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import qiniu from 'qiniu';
import type { IMessage, IConversation } from '@llm-chat/shared';

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

const createQiniuUploadToken = (
  accessKey: string,
  secretKey: string,
  bucket: string,
  key: string
): string => {
  const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
  const putPolicy = new qiniu.rs.PutPolicy({
    scope: `${bucket}:${key}`,
    expires: 3600
  });
  return putPolicy.uploadToken(mac);
};

const uploadBufferToQiniu = async (
  buffer: Buffer,
  key: string,
  fileType: string,
  qiniuConfig: { accessKey: string; secretKey: string; bucket: string; publicDomain: string; uploadHost: string }
): Promise<string> => {
  const config = new qiniu.conf.Config();
  const formUploader = new qiniu.form_up.FormUploader(config);
  const putExtra = new qiniu.form_up.PutExtra();
  if (fileType) {
    putExtra.mimeType = fileType;
  }

  const uploadToken = createQiniuUploadToken(
    qiniuConfig.accessKey,
    qiniuConfig.secretKey,
    qiniuConfig.bucket,
    key
  );

  await new Promise<void>((resolve, reject) => {
    formUploader.put(uploadToken, key, buffer, putExtra, (err, body, info) => {
      if (err) {
        reject(err);
        return;
      }
      if (!info || info.statusCode < 200 || info.statusCode >= 300) {
        reject(new Error(`七牛上传失败: ${info?.statusCode || 'unknown'}`));
        return;
      }
      if (!body?.key) {
        reject(new Error('七牛上传失败: 缺少文件 key'));
        return;
      }
      resolve();
    });
  });

  return buildPublicUrl(qiniuConfig.publicDomain, key);
};

export const createChatImageUploadToken = async (req: AuthRequest, res: Response) => {
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

// 代理聊天请求到 SiliconFlow (支持流式转发)
export const proxyChat = async (req: AuthRequest, res: Response) => {
  try {
    const { model, messages, stream, ...rest } = req.body;
    const apiKey = process.env.SILICONFLOW_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ message: 'Server API key not configured' });
    }

    // 设置响应头以支持流式传输
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    const response = await axios({
      method: 'post',
      url: 'https://api.siliconflow.cn/v1/chat/completions',
      data: {
        model,
        messages,
        stream: stream || false,
        ...rest
      },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: stream ? 'stream' : 'json'
    });

    if (stream) {
      // 转发流
      response.data.pipe(res);

      // 监听流结束
      response.data.on('end', () => {
        res.end();
      });

      // 监听错误
      response.data.on('error', (err: any) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      });
    } else {
      res.json(response.data);
    }
  } catch (error: any) {
    console.error('Proxy error:', error.response?.data || error.message);
    const status = error.response?.status || 500;
    const upstreamData = error.response?.data;
    const message = upstreamData?.message
      || upstreamData?.error?.message
      || upstreamData?.detail
      || (typeof upstreamData === 'string' ? upstreamData : null)
      || error.message
      || 'Proxy request failed';
    res.status(status).json({
      message,
      upstream: upstreamData
    });
  }
};

// 代理图片生成请求到 SiliconFlow
export const proxyImageGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const { prompt, model, ...rest } = req.body;
    const apiKey = process.env.SILICONFLOW_API_KEY;
    const qiniuConfig = resolveQiniuConfig();

    if (!apiKey) {
      return res.status(500).json({ message: 'Server API key not configured' });
    }
    if (!qiniuConfig) {
      return res.status(500).json({ message: '七牛云配置不完整' });
    }

    const response = await axios({
      method: 'post',
      url: 'https://api.siliconflow.cn/v1/images/generations',
      data: {
        prompt,
        model,
        ...rest
      },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const data = response.data;

    // 处理图片保存到本地
    // SiliconFlow 返回的是 images 数组，而 OpenAI 标准返回的是 data 数组
    const imageArray = data.images || data.data;

    if (data && imageArray && Array.isArray(imageArray)) {
      for (const item of imageArray) {
        if (item.url) {
          try {
            const imageResponse = await axios.get(item.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(imageResponse.data, 'binary');
            const contentTypeHeader = String(imageResponse.headers?.['content-type'] || '').toLowerCase();
            const urlObj = new URL(item.url);
            const extFromUrl = path.extname(urlObj.pathname).toLowerCase();
            const ext = extFromUrl || extractExtension('', contentTypeHeader);
            const fileType = contentTypeHeader || 'image/png';
            const key = `${crypto.randomUUID()}${ext}`;

            item.url = await uploadBufferToQiniu(buffer, key, fileType, qiniuConfig);

          } catch (imgError) {
            console.error('Failed to upload generated image to qiniu:', imgError);
            // 下载失败则保留原 URL
          }
        }
      }
    }

    res.json(data);
  } catch (error: any) {
    console.error('Proxy error:', error.response?.data || error.message);
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Proxy request failed';
    res.status(status).json({ message });
  }
};

// 获取用户的所有对话列表
export const getConversations = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.userId;
    const conversations = await Conversation.find({ userId }).sort({ updatedAt: -1 });
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: '获取对话列表失败', error });
  }
};

// 获取单个对话的所有消息
export const getMessages = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const messages = await Message.find({ conversationId }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: '获取消息失败', error });
  }
};

// 创建新对话
export const createConversation = async (req: AuthRequest, res: Response) => {
  try {
    const { title, model } = req.body;
    const userId = req.user.userId;

    const conversation = new Conversation({
      userId,
      title: title || '新对话',
      model
    });

    await conversation.save();
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ message: '创建对话失败', error });
  }
};

// 保存消息
export const saveMessage = async (req: Request, res: Response) => {
  try {
    const { conversationId, role, content } = req.body;

    const message = new Message({
      conversationId,
      role,
      content
    });

    await message.save();

    // 更新对话的更新时间
    await Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: '保存消息失败', error });
  }
};

// 删除单条消息
export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const deletedMessage = await Message.findByIdAndDelete(messageId);

    if (!deletedMessage) {
      return res.status(404).json({ message: '消息不存在' });
    }

    // 如果消息包含图片，尝试删除本地文件
    if (typeof deletedMessage.content === 'string') {
      const imageRegex = /!\[.*?\]\((.*?\/uploads\/.*?)\)/g;
      let match;
      while ((match = imageRegex.exec(deletedMessage.content)) !== null) {
        const imageUrl = match[1];
        try {
          const urlObj = new URL(imageUrl);
          const filename = path.basename(urlObj.pathname);
          const filepath = path.join(__dirname, '../../uploads', filename);

          if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log(`Deleted local image: ${filename}`);
          }
        } catch (err) {
          console.error('Failed to delete local image file:', err);
        }
      }
    }

    res.json({ message: '消息已删除', id: messageId });
  } catch (error) {
    res.status(500).json({ message: '删除消息失败', error });
  }
};

// 删除对话
export const deleteConversation = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;

    // 在删除消息前，先获取所有消息以清理图片
    const messages = await Message.find({ conversationId });
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        const imageRegex = /!\[.*?\]\((.*?\/uploads\/.*?)\)/g;
        let match;
        while ((match = imageRegex.exec(msg.content)) !== null) {
          const imageUrl = match[1];
          try {
            const urlObj = new URL(imageUrl);
            const filename = path.basename(urlObj.pathname);
            const filepath = path.join(__dirname, '../../uploads', filename);
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
            }
          } catch (err) {
            console.error('Failed to delete image during conversation cleanup:', err);
          }
        }
      }
    }

    await Conversation.findByIdAndDelete(conversationId);
    await Message.deleteMany({ conversationId });
    res.json({ message: '对话已删除' });
  } catch (error) {
    res.status(500).json({ message: '删除对话失败', error });
  }
};

// 更新对话（例如修改标题）
export const updateConversation = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { title } = req.body;

    const conversation = await Conversation.findByIdAndUpdate(
      conversationId,
      { title },
      { new: true } // 返回更新后的文档
    );

    if (!conversation) {
      return res.status(404).json({ message: '对话不存在' });
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({ message: '更新对话失败', error });
  }
};

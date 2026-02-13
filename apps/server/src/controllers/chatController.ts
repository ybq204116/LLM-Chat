import { Request, Response } from 'express';
import { Conversation, Message } from '../models/Chat';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IMessage, IConversation } from '@llm-chat/shared';

interface AuthRequest extends Request {
  user?: any;
}

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
    const message = error.response?.data?.message || 'Proxy request failed';
    res.status(status).json({ message });
  }
};

// 代理图片生成请求到 SiliconFlow
export const proxyImageGeneration = async (req: AuthRequest, res: Response) => {
  try {
    const { prompt, model, ...rest } = req.body;
    const apiKey = process.env.SILICONFLOW_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ message: 'Server API key not configured' });
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
      const uploadsDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      for (const item of imageArray) {
        if (item.url) {
          try {
            const imageResponse = await axios.get(item.url, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(imageResponse.data, 'binary');

            // 生成文件名
            const urlObj = new URL(item.url);
            const ext = path.extname(urlObj.pathname) || '.png';
            const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
            const filepath = path.join(uploadsDir, filename);

            fs.writeFileSync(filepath, buffer);

            // 构造本地 URL
            const protocol = req.protocol;
            const host = req.get('host');
            const serverUrl = `${protocol}://${host}`;
            item.url = `${serverUrl}/uploads/${filename}`;

          } catch (imgError) {
            console.error('Failed to download and save image:', imgError);
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

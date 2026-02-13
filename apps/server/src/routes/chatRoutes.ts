import { Router } from 'express';
import {
  getConversations,
  getMessages,
  createConversation,
  saveMessage,
  deleteMessage,
  deleteConversation,
  updateConversation,
  proxyChat,
  proxyImageGeneration
} from '../controllers/chatController';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// 所有聊天路由都需要登录
router.use(authenticateToken);

router.post('/completions', proxyChat); // 添加代理路由
router.post('/images/generations', proxyImageGeneration); // 添加图片生成代理路由
router.get('/conversations', getConversations);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/conversations', createConversation);
router.post('/messages', saveMessage);
router.delete('/messages/:messageId', deleteMessage); // 添加删除消息路由
router.patch('/conversations/:conversationId', updateConversation); // 添加更新路由
router.delete('/conversations/:conversationId', deleteConversation);

export default router;

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';

interface AuthRequest extends Request {
  user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ message: '未授权，请先登录' });
    return;
  }

  jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
    if (err) {
      res.status(403).json({ message: 'Token 无效或已过期' });
      return;
    }

    try {
      // 检查用户是否依然存在于数据库中
      const user = await User.findById(decoded.userId);
      if (!user) {
        res.status(401).json({ message: '用户不存在或已被删除' });
        return;
      }

      req.user = decoded;
      next();
    } catch (error) {
      res.status(500).json({ message: '服务器内部错误' });
    }
  });
};

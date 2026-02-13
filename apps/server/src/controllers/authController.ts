import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your_refresh_secret_key';

// 生成 Access Token
const generateAccessToken = (userId: any, username: string) => {
    return jwt.sign(
        { userId, username },
        JWT_SECRET,
        { expiresIn: '30m' } // Access Token 有效期 30 分钟
    );
};

// 生成 Refresh Token
const generateRefreshToken = (userId: any, username: string) => {
    return jwt.sign(
        { userId, username },
        REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' } // Refresh Token 有效期 7 天
    );
};

export const register = async (req: Request, res: Response): Promise<void> => {
    try {
        const { username, password, phoneNumber } = req.body;

        // 基础验证
        if (!username || !password || !phoneNumber) {
            res.status(400).json({ message: '请填写用户名、密码和手机号' });
            return;
        }

        if (username.length < 3) {
            res.status(400).json({ message: '用户名至少需要3个字符' });
            return;
        }

        if (password.length < 6) {
            res.status(400).json({ message: '密码至少需要6个字符' });
            return;
        }

        // 手机号正则校验 (中国大陆手机号)
        const phoneRegex = /^1[3-9]\d{9}$/;
        if (!phoneRegex.test(phoneNumber)) {
            res.status(400).json({ message: '请输入有效的手机号' });
            return;
        }

        // 检查用户名是否已存在
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            res.status(400).json({ message: '用户名已存在' });
            return;
        }

        // 检查手机号是否已存在
        const existingPhone = await User.findOne({ phoneNumber });
        if (existingPhone) {
            res.status(400).json({ message: '该手机号已注册' });
            return;
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(password, 10);

        // 创建新用户
        const user = new User({
            username,
            password: hashedPassword,
            phoneNumber
        });

        await user.save();
        res.status(201).json({ message: '注册成功' });
    } catch (error) {
        res.status(500).json({ message: '服务器错误', error });
    }
};

export const login = async (req: Request, res: Response): Promise<void> => {
    try {
        const { username, password } = req.body;

        // 查找用户
        const user = await User.findOne({ username });
        if (!user) {
            res.status(400).json({ message: '用户不存在' });
            return;
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            res.status(400).json({ message: '密码错误' });
            return;
        }

        // 生成 JWT
        const accessToken = generateAccessToken(user._id, user.username);
        const refreshToken = generateRefreshToken(user._id, user.username);

        // 保存 Refresh Token 到数据库
        user.refreshToken = refreshToken;
        await user.save();

        res.json({
            token: accessToken,
            refreshToken,
            user: { id: user._id, username: user.username }
        });
    } catch (error) {
        res.status(500).json({ message: '服务器错误', error });
    }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            res.status(401).json({ message: '请提供刷新令牌' });
            return;
        }

        // 验证 Refresh Token
        jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, async (err: any, decoded: any) => {
            if (err) {
                res.status(403).json({ message: '刷新令牌无效或已过期' });
                return;
            }

            // 检查数据库中的 Refresh Token
            const user = await User.findById(decoded.userId);
            if (!user || user.refreshToken !== refreshToken) {
                res.status(403).json({ message: '刷新令牌无效' });
                return;
            }

            // 生成新的 Access Token
            const newAccessToken = generateAccessToken(user._id, user.username);

            // 检查 Refresh Token 是否即将过期（比如小于 1 天）
            // 如果即将过期，则自动生成新的 Refresh Token 并更新数据库，实现“自动续期”
            const now = Math.floor(Date.now() / 1000);
            const exp = decoded.exp || 0;
            let newRefreshToken = null;

            // 如果剩余时间小于 1 天 (86400秒)，则轮换 Refresh Token
            if (exp - now < 86400) {
                newRefreshToken = generateRefreshToken(user._id, user.username);
                user.refreshToken = newRefreshToken;
                await user.save();
            }

            res.json({
                token: newAccessToken,
                refreshToken: newRefreshToken, // 如果更新了，前端需要同步更新
                user: { id: user._id, username: user.username }
            });
        });
    } catch (error) {
        res.status(500).json({ message: '服务器错误', error });
    }
};

export const getMe = async (req: any, res: Response): Promise<void> => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) {
            res.status(404).json({ message: '用户不存在' });
            return;
        }
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: '服务器错误', error });
    }
};
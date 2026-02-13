export const SHARED_VERSION = '1.0.0';

// 用户接口
export interface IUser {
    _id?: string;
    username: string;
    password?: string;
    avatar?: string;
    refreshToken?: string;
    createdAt?: Date;
}

// 消息接口
export interface IMessage {
    _id?: string;
    conversationId?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    reasoning_content?: string;
    hasImage?: boolean; // 前端辅助字段
    loading?: boolean;  // 前端辅助字段
    timestamp?: string | Date;
}

// 对话接口
export interface IConversation {
    _id: string;
    userId: string;
    title: string;
    model: string;
    createdAt: string | Date;
    updatedAt: string | Date;
}

// API 响应通用结构
export interface IApiResponse<T = any> {
    message?: string;
    data?: T;
    error?: any;
}


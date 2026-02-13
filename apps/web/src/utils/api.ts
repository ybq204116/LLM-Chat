import axios from 'axios'
import { useAuthStore } from '../stores/auth'

// 定义API基础URL
// 修改为调用本地后端代理接口，而不是直接调用 SiliconFlow
const API_BASE_URL = 'http://localhost:3000/api/chat'

import type { IMessage } from '@llm-chat/shared';

// 定义LLM/VLM API请求负载接口
interface ChatPayload {
    model: string
    messages: IMessage[]
    temperature: number
    max_tokens: number
    stream?: boolean
    top_p?: number
    top_k?: number
    frequency_penalty?: number
    n?: number
    response_format?: {
        type: string
    }
    tools?: Array<{
        type: string
        function: {
            description: string
            name: string
            parameters: Record<string, unknown>
            strict: boolean
        }
    }>
}

// 定义LLM/VLM API响应接口
interface ChatResponse {
    choices: Array<{
        message?: {
            content: string
            reasoning_content?: string
        }
    }>
}

// 定义文生图 API请求负载接口
interface ImageGenerationPayload {
    model: string
    prompt: string
    image_size?: string
    num_inference_steps?: number
    seed?: number
}

// 定义文生图 API响应接口
interface ImageGenerationResponse {
    images: Array<{
        url: string
    }>
    timings: {
        inference: number
    }
    seed: number
}

// 自定义错误类，包含HTTP状态码和响应信息
export class ApiError extends Error {
    statusCode: number;
    responseMessage: string;

    constructor(statusCode: number, message: string, responseMessage: string) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.responseMessage = responseMessage;
    }
}

// 创建请求头
const createHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token')
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` // 使用我们自己的 JWT Token
    }
}

// 刷新 Token 的辅助函数
const refreshTokenIfNeeded = async (): Promise<string | null> => {
    const authStore = useAuthStore()
    const refreshToken = authStore.refreshToken

    if (!refreshToken) {
        authStore.logout()
        window.location.href = '/login'
        return null
    }

    try {
        const res = await axios.post('http://localhost:3000/api/auth/refresh-token', {
            refreshToken
        })

        if (res.data.token) {
            // 如果后端返回了新的 refreshToken，也要更新
            if (res.data.refreshToken) {
                 authStore.setAuth(res.data.token, res.data.refreshToken, res.data.user || authStore.user);
            } else {
                 authStore.updateAccessToken(res.data.token);
            }
            return res.data.token
        }
    } catch (error) {
        authStore.logout()
        window.location.href = '/login'
    }
    return null
}

/**
 * 封装带重试机制的 fetch
 */
const fetchWithRetry = async (url: string, options: RequestInit): Promise<Response> => {
    let response = await fetch(url, options)

    // 如果是 401 错误，尝试刷新 Token 并重试
    if (response.status === 401) {
        const newToken = await refreshTokenIfNeeded()
        if (newToken) {
            // 更新 Authorization 头并重试
            const headers = {
                ...options.headers,
                'Authorization': `Bearer ${newToken}`
            }
            response = await fetch(url, { ...options, headers })
        }
    }

    return response
}

/**
 * 发送聊天消息 (流式输出)
 */
export const sendMessageStream = async (
    payload: ChatPayload,
    onChunk: (content: string, reasoning?: string) => void,
    onComplete: () => void,
    onError: (error: ApiError) => void,
    signal?: AbortSignal
): Promise<void> => {
    try {
        const response = await fetchWithRetry(`${API_BASE_URL}/completions`, {
            method: 'POST',
            headers: createHeaders(),
            body: JSON.stringify({
                ...payload,
                stream: true
            }),
            signal
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new ApiError(
                response.status,
                '请求失败',
                errorData.message || '未知错误'
            );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法读取响应流');

        const decoder = new TextDecoder();
        let fullContent = '';
        let fullReasoning = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices[0]?.delta?.content || '';
                        const reasoning = parsed.choices[0]?.delta?.reasoning_content || '';

                        if (content || reasoning) {
                            fullContent += content;
                            fullReasoning += reasoning;
                            onChunk(fullContent, fullReasoning);
                        }
                    } catch (e) {
                        // 忽略解析失败的 chunk
                    }
                }
            }
        }

        onComplete();
    } catch (error: any) {
        if (error.name === 'AbortError') return;
        onError(error instanceof ApiError ? error : new ApiError(500, '网络错误', error.message));
    }
};

/**
 * 非流式请求
 */
export const sendMessage = async (payload: ChatPayload, signal?: AbortSignal): Promise<ChatResponse> => {
    const response = await fetchWithRetry(`${API_BASE_URL}/completions`, {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify({
            ...payload,
            stream: false
        }),
        signal
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
            response.status,
            '请求失败',
            errorData.message || '未知错误'
        );
    }

    return response.json();
};

/**
 * 文生图请求
 */
export const sendImageGeneration = async (payload: ImageGenerationPayload, signal?: AbortSignal): Promise<ImageGenerationResponse> => {
    const response = await fetchWithRetry(`${API_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: createHeaders(),
        body: JSON.stringify(payload),
        signal
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
            response.status,
            '请求失败',
            errorData.message || '未知错误'
        );
    }

    return response.json();
}; 
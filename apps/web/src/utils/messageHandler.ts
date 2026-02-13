import type { IMessage } from '@llm-chat/shared';

interface StreamResponse {
    choices: Array<{
        delta: {
            content?: string | null;
            reasoning_content?: string | null;
        };
    }>;
}

export interface SyncResponse {
    choices: Array<{
        message?: {
            content: string;
            reasoning_content?: string;
        };
    }>;
}

interface ProcessStreamOptions {
    updateMessage: (content: string, reasoning_content?: string) => void;
}

export interface SyncImageResponse {
    images: Array<{
        url: string;
    }>;
}

export const messageHandler = {
    // 格式化消息
    formatMessage(role: 'user' | 'assistant', content: string): IMessage {
        const hasImage = content.includes('![') && content.includes('](data:image/')

        return {
            // id: Date.now(), // 注意：IMessage 中 _id 是 string，这里可能需要适配或保持前端独有的 id
            role,
            content,
            hasImage,
            loading: false,
            timestamp: new Date().toISOString()
        };
    },

    // 格式化图片消息
    formatImageMessage(role: 'user' | 'assistant', images: Array<{ url: string }>): IMessage {
        // 将所有图片URL转换为Markdown格式
        const content = images
            .map(img => `![generated image](${img.url})`)
            .join('\n\n');

        return this.formatMessage(role, content)
    },

    async processStreamResponse(
        response: Response,
        { updateMessage }: ProcessStreamOptions
    ): Promise<void> {
        let fullResponse = '';
        let fullReasoningResponse = '';

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        try {
            while (true) {
                const { done, value } = await reader.read();

                // 处理流结束的情况
                if (done) {
                    console.log('流式响应完成');
                    break;
                }

                // 处理数据块
                const lines = decoder.decode(value)
                    .split('\n')
                    .filter(line => line.trim() !== '')
                    .filter(line => line.startsWith('data: '));

                for (const line of lines) {
                    const jsonStr = line.replace('data: ', '');
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const jsData = JSON.parse(jsonStr) as StreamResponse;
                        const delta = jsData.choices[0]?.delta;

                        if (delta) {
                            let hasUpdate = false;

                            // 严格检查 content
                            if (delta.content !== undefined && delta.content !== null) {
                                fullResponse += delta.content;
                                hasUpdate = true;
                            }

                            // 严格检查 reasoning_content
                            if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                                fullReasoningResponse += delta.reasoning_content;
                                hasUpdate = true;
                            }

                            // 只在有实际更新时才调用更新函数
                            if (hasUpdate) {
                                updateMessage(fullResponse, fullReasoningResponse);
                            }
                        }
                    } catch (e) {
                        console.error('解析JSON失败:', e);
                        console.error('问题数据:', jsonStr);
                    }
                }
            }
        } catch (error) {
            // 处理中止和其他错误
            if (error instanceof Error) {
                const isAborted = error.name === 'AbortError';
                if (isAborted) {
                    console.log('流式响应被中止');
                } else {
                    console.error('流处理错误:', error);
                }
            }
            throw error;
        } finally {
            // 确保读取器被正确关闭
            reader.releaseLock();
        }
    },
};
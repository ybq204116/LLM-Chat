<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { useChatStore } from '../stores/chat'
import { useSettingsStore, useModelOptions } from '../stores/settings'
import { sendMessageStream, sendMessage as sendApiMessage, sendImageGeneration, ApiError } from '../utils/api'
import { messageHandler } from '../utils/messageHandler'
import ChatMessage from '../components/ChatMessage.vue'
import ChatInput from '../components/ChatInput.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import SideBar from '../components/SideBar.vue'
import SearchBar from '../components/SearchBar.vue'
import { ElMessage } from 'element-plus'

// 初始化聊天存储
const chatStore = useChatStore()
// 计算属性，获取消息列表和加载状态
const currentChatMessages = computed(() => chatStore.messages)
const isLoading = computed(() => chatStore.isLoading)
// 设置面板显示状态
const showSettings = ref(false)
// 虚拟滚动组件引用
const scroller = ref<any>(null)
// AbortController 用于中止请求
const abortController = ref<AbortController | null>(null)

// 转换消息列表以适配虚拟滚动
const virtualMessages = computed(() => {
    return chatStore.messages.map((m: any, index: number) => ({
        ...m,
        // 确保每条消息都有唯一ID
        // 1. 如果有 _id，使用 _id
        // 2. 如果没有 _id（如刚发送的消息），使用 timestamp + index 组合
        // 这样可以避免当 timestamp 相同时（连续快速发送）导致 key 冲突
        id: m._id || `${m.timestamp}_${index}`
    }))
})

// 监听消息变化，滚动到底部
watch(() => chatStore.messages.length, () => {
    nextTick(() => {
        scrollToBottom()
    })
})

// 监听最后一条消息内容变化（流式生成时），滚动到底部
watch(() => chatStore.messages[chatStore.messages.length - 1]?.content, () => {
    if (chatStore.activeConversationId === chatStore.currentGeneratingId) {
        nextTick(() => {
            scrollToBottom()
        })
    }
})

// 切换对话时滚动到底部
watch(() => chatStore.activeConversationId, () => {
    nextTick(() => {
        scrollToBottom()
    })
})

const scrollToBottom = () => {
    if (scroller.value) {
        scroller.value.scrollToBottom()
    }
}

// 将文本消息转换为VLM消息，text -> VLMContentItem[]
const convertTextToMessageContent = (text: string) => {
  const content = [];  // VLMContentItem[]
  const imageRegex = /!\[.*?\]\((data:image\/(png|jpg|jpeg);base64,[^)]+)\)/g;
  let match;
  let lastIndex = 0;
  let firstTextExtracted = false; // 添加一个标志变量，用于标记是否已提取了第一段文本

  while ((match = imageRegex.exec(text)) !== null) {
    const imageUrl = match[1];
    const imageStartIndex = match.index;

    // 提取图片前的文本，确保不是空白字符
    if (imageStartIndex > lastIndex && !firstTextExtracted) {
      firstTextExtracted = true;
      const textContent = text.substring(lastIndex, imageStartIndex).trim();
      if (textContent && !/^\s*$/.test(textContent)) {
        content.push({ type: "text" as const, text: textContent });
      }
    }

    // 提取image_url(data url)
    content.push({
      type: "image_url" as const,
      image_url: { url: imageUrl },
    });

    lastIndex = imageRegex.lastIndex;
  }

  // 若没有图片，则提取整个文本
  if (!firstTextExtracted) {
    content.push({ type: "text" as const, text: text });
  }

  return content;
}

// 将普通消息列表转换为VLM消息列表
const createVLMMessage = () => {
  // 获取当前会话的所有消息
  return currentChatMessages.value.map(message => {
    // 将每条消息转换为VLM格式
    const content = !message.hasImage ? [{ type: "text" as const, text: message.content }] : convertTextToMessageContent(message.content);
    return {
      role: message.role,
      content: content
    };
  });
}

// 发送LLM/VLM消息
const sendMessage = async (modelType: string) => {
    console.log('发送LLM/VLM消息')
    try {
        const settingsStore = useSettingsStore()
        
        // 创建新的 AbortController
        abortController.value = new AbortController()

        const messages = modelType === 'visual' 
            ? createVLMMessage().slice(0, -1)
            : currentChatMessages.value.slice(0, -1).map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
              }))

        const payload = {
            model: settingsStore.model,
            messages: messages as any,
            temperature: settingsStore.temperature,
            max_tokens: settingsStore.maxTokens,
            stream: settingsStore.streamResponse
        }

        if (settingsStore.streamResponse) {
            await sendMessageStream(
                payload,
                (content, reasoning_content) => {
                    chatStore.updateLastMessage(content, reasoning_content)
                },
                async () => {
                    // 生成完成后，保存 AI 的完整回复到后端
                    await chatStore.saveLastMessage()
                    chatStore.currentGeneratingId = null
                    chatStore.isLoading = false
                    abortController.value = null
                },
                (error) => {
                    throw error
                },
                abortController.value.signal
            )
        } else {
            const result = await sendApiMessage(payload, abortController.value.signal)
            const content = result.choices[0]?.message?.content || ''
            const reasoning = result.choices[0]?.message?.reasoning_content || ''
            chatStore.updateLastMessage(content, reasoning)
            await chatStore.saveLastMessage()
            chatStore.currentGeneratingId = null
            chatStore.isLoading = false
            abortController.value = null
        }

    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log('请求已中止')
            chatStore.updateLastMessage('（已停止生成）', '')
            chatStore.currentGeneratingId = null
            chatStore.isLoading = false
            return
        }

        console.error('发送消息失败:', error)
        
        // 错误消息格式化逻辑
        let errorMessage = '抱歉，发生了错误，请稍后重试。'
        
        if (error instanceof ApiError) {
            ElMessage.error({
                dangerouslyUseHTMLString: true,
                message: `
                    <div style="font-size: 14px;">
                        <span style="color: #F56C6C; font-weight: bold;">${error.statusCode}</span>
                        <span style="color: #F56C6C; font-weight: bold;"> ${error.message}</span>
                        <br>
                        <span style="color: #909399; font-size: 13px;">${error.responseMessage || '未知错误'}</span>
                    </div>
                `,
                duration: 5000,
                showClose: true
            })
        }
        
        chatStore.updateLastMessage(errorMessage, '')
        chatStore.currentGeneratingId = null
        chatStore.isLoading = false
        abortController.value = null
    }
}

// 发送T2I消息
const sendT2IMessage = async () => {
    console.log('发送T2I消息')
    try {
        const settingsStore = useSettingsStore()
        
        // 创建新的 AbortController
        abortController.value = new AbortController()

        // 获取最后一条用户消息的内容作为提示词
        const userMessage = currentChatMessages.value.slice(-2)[0]
        if (!userMessage || userMessage.role !== 'user') {
            throw new Error('无效的用户消息')
        }

        // 提取提示词
        const prompt = userMessage.content
            .replace(/^画\s*|^\/image\s+/i, '')
            .trim()

        const payload = {
            model: settingsStore.model,
            prompt: prompt,
            image_size: settingsStore.t2iConfig.imageSize,
            num_inference_steps: settingsStore.t2iConfig.inferenceSteps,
            seed: Math.floor(Math.random() * 1000000)
        }

        const response = await sendImageGeneration(payload, abortController.value.signal)
        
        // 处理图片响应
        const imageMessage = messageHandler.formatImageMessage('assistant', response.images)
        chatStore.updateLastMessage(imageMessage.content)
        await chatStore.saveLastMessage()
        abortController.value = null

    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.log('请求已中止')
            chatStore.updateLastMessage('（已停止生成）')
            chatStore.currentGeneratingId = null
            chatStore.isLoading = false
            return
        }

        console.error('图片生成失败:', error)
        
        let errorMessage = '抱歉，图片生成失败，请稍后重试。'
        
        if (error instanceof ApiError) {
            ElMessage.error({
                dangerouslyUseHTMLString: true,
                message: `
                    <div style="font-size: 14px;">
                        <span style="color: #F56C6C; font-weight: bold;">${error.statusCode}</span>
                        <span style="color: #F56C6C; font-weight: bold;"> ${error.message}</span>
                        <br>
                        <span style="color: #909399; font-size: 13px;">${error.responseMessage || '未知错误'}</span>
                    </div>
                `,
                duration: 5000,
                showClose: true
            })
        } else {
            ElMessage.error('图片生成失败，请稍后重试')
        }
        
        chatStore.updateLastMessage(errorMessage)
        abortController.value = null
    } finally {
        chatStore.currentGeneratingId = null
        chatStore.isLoading = false
    }
}

/**
 * 发送消息处理函数
 * @param {string} content 用户输入的消息内容
 */
const handleSend = async (content: string) => {
    console.log('发送消息')

    if (isLoading.value) return
    // 添加用户消息和助理的空消息
    chatStore.addMessage(messageHandler.formatMessage('user', content))
    chatStore.addMessage(messageHandler.formatMessage('assistant', ''), false)
    chatStore.isLoading = true
    // 将当前正在生成回复的对话ID设置为活跃对话的ID
    // 这样可以追踪哪个对话正在等待AI响应
    chatStore.currentGeneratingId = chatStore.activeConversationId

    // 获取设置并发送消息
    const settingsStore = useSettingsStore()
    const modelOptions = useModelOptions()
    const modelOption = modelOptions.value.find(m => m.value === settingsStore.model)
    const modelType = modelOption?.type

    // 根据模型类型发送消息
    if (modelType === 'plain' || modelType === 'visual'){
        await sendMessage(modelType)
    } else if (modelType === 'text2img'){
        await sendT2IMessage()
    } else {
        throw new Error('无效的模型类型')
    }
}

/**
 * 清除消息处理函数
 */
const handleClear = () => {
    chatStore.clearMessages()
}

// 处理消息更新
const handleMessageUpdate = async (updatedMessage: any) => {
    const index = chatStore.messages.findIndex(m => (m._id && m._id === updatedMessage._id) || m.timestamp === updatedMessage.timestamp)
    if (index !== -1) {
        // 删除当前消息及其后的助手回复
        chatStore.messages.splice(index, 2)
        // 重新发送更新后的消息
        await handleSend(updatedMessage.content)
    }
}

// 处理消息删除
const handleMessageDelete = async (message: any) => {
    try {
        await chatStore.deleteMessage(message)
    } catch (error) {
        console.error('删除消息失败', error)
        ElMessage.error('删除失败')
    }
}
// 处理重新生成
const handleRegenerate = async (message: any) => {
    // 找到当前助手消息的索引
    const index = chatStore.messages.findIndex(m => ((m._id && m._id === message._id) || m.timestamp === message.timestamp) && m.role === "assistant")
    
    if (index !== -1 && index > 0) {
        // 1. 先中止当前的任何生成任务
        handleStop()

        // 2. 获取上一条用户消息的内容
        const userMessage = chatStore.messages[index - 1]
        const userContent = userMessage.content
        
        // 3. 删除旧的消息对（用户消息 + 随后的一条助手消息）
        try {
            if (userMessage._id) {
                // 如果用户消息已保存，调用后端删除，后端逻辑会自动处理级联删除助手消息
                await chatStore.deleteMessage(userMessage)
            } else {
                // 如果未保存，直接从本地数组移除这两条
                chatStore.messages.splice(index - 1, 2)
            }
        } catch (error) {
            console.error('删除旧消息失败', error)
            ElMessage.error('删除旧消息失败')
            return
        }

        // 4. 调用 handleSend 重新发送
        // 注意：不需要在这里手动设置 isLoading，handleSend 内部会处理
        await handleSend(userContent)
    }
}

// 处理搜索结果跳转
const handleSearchSelect = (messageId: string) => {
    const index = virtualMessages.value.findIndex((m: any) => m.id === messageId)
    if (index !== -1 && scroller.value) {
        scroller.value.scrollToItem(index)
        
        // 添加高亮效果
        nextTick(() => {
            // 由于虚拟滚动，我们需要等待 DOM 更新
            // 注意：这里可能需要稍微延迟，因为滚动和渲染需要时间
            setTimeout(() => {
                // 尝试查找对应的 DOM 元素添加高亮
                // 这里可能无法直接获取到 DynamicScrollerItem 的 ref，
                // 可以尝试通过 CSS 选择器查找当前可见区域内的对应元素
                // 但由于 DynamicScrollerItem 没有直接暴露 ID 到 DOM 属性上（除了 key），
                // 我们可能需要在 ChatMessage 组件中处理高亮，或者简单地只做滚动
            }, 100)
        })
    }
}

// 添加暂停处理函数
const handleStop = () => {
    // 中止当前的请求
    if (abortController.value) {
        abortController.value.abort()
        abortController.value = null
    }
    
    // 重置状态
    chatStore.currentGeneratingId = null
    chatStore.isLoading = false
}
</script>

<template>
    <div class="app-container">
        <!-- 侧边栏 -->
        <side-bar />

        <!-- 聊天容器 -->
        <div class="chat-container">
            <!-- 聊天头部，包含标题和设置按钮 -->
            <div class="chat-header">
                <h1>LLM Chat</h1>
                <search-bar @select="handleSearchSelect" />
                <el-button circle :icon="Setting" @click="showSettings = true" />
            </div>

            <!-- 消息容器，显示对话消息 -->
            <div class="messages-container">
                <template v-if="virtualMessages.length">
                    <DynamicScroller
                        ref="scroller"
                        :items="virtualMessages"
                        :min-item-size="60"
                        class="scroller"
                        key-field="id"
                    >
                        <template v-slot="{ item, index, active }">
                            <DynamicScrollerItem
                                :item="item"
                                :active="active"
                                :size-dependencies="[
                                    item.content,
                                    item.reasoning_content
                                ]"
                                :data-index="index"
                            >
                                <chat-message 
                                    :message="item"
                                    @update="handleMessageUpdate" 
                                    @delete="handleMessageDelete"
                                    @regenerate="handleRegenerate" 
                                />
                            </DynamicScrollerItem>
                        </template>
                    </DynamicScroller>
                </template>
                <div v-else class="empty-state">
                    <el-empty description="开始对话吧" />
                </div>
            </div>

            <!-- 聊天输入框 -->
            <chat-input :loading="isLoading" :generating="chatStore.currentGeneratingId !== null"
                @send="handleSend" @clear="handleClear" @stop="handleStop" 
            />

            <!-- 设置面板 -->
            <settings-panel v-model="showSettings" />
        </div>
    </div>
</template>

<style lang="scss" scoped>
.app-container {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

/* 定义聊天容器的样式，占据整个视口高度，使用flex布局以支持列方向的布局 */
.chat-container {
    flex: 1;
    min-width: 0; /* 防止内容溢出 */
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 控制溢出 */
}

/* 设置聊天头部的样式，包括对齐方式和背景色等 */
.chat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background-color: var(--bg-color);
    border-bottom: 1px solid var(--border-color);

    /* 设置聊天头部标题的样式，无默认间距，自定义字体大小和颜色 */
    h1 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--text-color-primary);
    }
}

/* 定义消息容器的样式，占据剩余空间，支持滚动，自定义背景色 */
.messages-container {
    flex: 1;
    overflow: hidden; /* 虚拟滚动组件自带滚动条 */
    padding: 1rem;
    background-color: var(--bg-color-secondary);
    position: relative;
}

.scroller {
    height: 100%;
}

/* 设置空状态时的样式，占据全部高度，居中对齐内容 */
.empty-state {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
}
</style>
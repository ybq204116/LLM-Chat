import { defineStore } from 'pinia'
import request from '../utils/request'
import { useAuthStore } from './auth'
import type { IMessage, IConversation } from '@llm-chat/shared'

interface ChatState {
  conversations: IConversation[]
  activeConversationId: string | null
  messages: IMessage[] // 当前选中对话的消息列表
  isLoading: boolean
  isSending: boolean
  currentGeneratingId: string | null
}

export const useChatStore = defineStore('chat', {
  state: (): ChatState => ({
    conversations: [],
    activeConversationId: null,
    messages: [],
    isLoading: false,
    isSending: false,
    currentGeneratingId: null
  }),

  actions: {
    // 1. 获取所有对话列表
    async fetchConversations() {
      const authStore = useAuthStore()
      if (!authStore.isLoggedIn) return

      this.isLoading = true
      try {
        const res: any = await request.get('/chat/conversations')
        this.conversations = res

        // 如果没有任何对话，创建一个默认的新对话
        if (this.conversations.length === 0) {
          await this.createConversation()
        } else if (!this.activeConversationId) {
          // 如果有对话但没有选中，默认选中第一个
          this.setActiveConversation(this.conversations[0]._id)
        }
      } catch (error) {
        console.error('获取对话列表失败', error)
      } finally {
        this.isLoading = false
      }
    },

    // 2. 切换当前对话并加载消息
    async setActiveConversation(id: string) {
      this.activeConversationId = id
      this.messages = [] // 先清空，避免显示上一个对话的残影
      this.isLoading = true

      try {
        const res: any = await request.get(`/chat/conversations/${id}/messages`)
        this.messages = res.map((msg: any) => ({
          ...msg,
          timestamp: msg.timestamp || new Date().toISOString()
        }))
      } catch (error) {
        console.error('获取消息失败', error)
      } finally {
        this.isLoading = false
      }
    },

    // 3. 创建新对话
    async createConversation(title: string = '新对话', model: string = 'deepseek-ai/DeepSeek-V3') {
      try {
        const res: any = await request.post('/chat/conversations', { title, model })
        const newConv = res
        this.conversations.unshift(newConv) // 加到列表头部
        this.setActiveConversation(newConv._id)
        return newConv._id
      } catch (error) {
        console.error('创建对话失败', error)
      }
    },

    // 4. 发送/保存消息（UI乐观更新 + 后端保存）
    async addMessage(message: Omit<IMessage, '_id' | 'timestamp'>, saveToBackend: boolean = true) {
      if (!this.activeConversationId) return

      // 1. UI 立即显示（乐观更新）
      const tempMsg: IMessage = {
        ...message,
        timestamp: new Date().toISOString()
      }
      this.messages.push(tempMsg)

      // 2. 异步保存到后端
      if (saveToBackend) {
        try {
          const res: any = await request.post('/chat/messages', {
            conversationId: this.activeConversationId,
            role: message.role,
            content: message.content
          })
          // 更新本地消息的 _id
          if (res && res._id) {
            tempMsg._id = res._id
          }
        } catch (error) {
          console.error('消息保存失败', error)
        }
      }
    },

    // 5. 更新最后一条消息（用于流式输出）
    updateLastMessage(content: string, reasoning_content?: string) {
      if (this.messages.length > 0) {
        const lastMsg = this.messages[this.messages.length - 1]
        lastMsg.content = content
        if (reasoning_content) {
          lastMsg.reasoning_content = reasoning_content
        }
      }
    },

    // 6. 流式输出结束后，保存完整的 AI 回复
    async saveLastMessage() {
      if (!this.activeConversationId || this.messages.length === 0) return

      const lastMsg = this.messages[this.messages.length - 1]
      if (lastMsg.role !== 'assistant') return

      try {
        const res: any = await request.post('/chat/messages', {
          conversationId: this.activeConversationId,
          role: 'assistant',
          content: lastMsg.content
        })
        // 更新本地消息的 _id
        if (res && res._id) {
          lastMsg._id = res._id
        }
      } catch (error) {
        console.error('保存 AI 回复失败', error)
      }
    },

    // 7. 删除单条消息（或消息对）
    async deleteMessage(message: IMessage) {
      if (!this.activeConversationId) return

      const index = this.messages.findIndex(m => (m._id && m._id === message._id) || m.timestamp === message.timestamp)
      if (index === -1) return

      // 确定要删除的消息列表（如果是用户消息，通常连带删除后续的助手回复）
      const messagesToDelete: IMessage[] = [this.messages[index]]

      // 如果是用户消息，且下一条是助手消息，则一并删除
      if (message.role === 'user' && index + 1 < this.messages.length) {
        const nextMsg = this.messages[index + 1]
        if (nextMsg.role === 'assistant') {
          messagesToDelete.push(nextMsg)
        }
      }

      // 从后端删除
      for (const msg of messagesToDelete) {
        if (msg._id) {
          try {
            await request.delete(`/chat/messages/${msg._id}`)
          } catch (error) {
            console.error(`删除消息 ${msg._id} 失败`, error)
          }
        }
      }

      // 从本地删除 (使用 splice 一次性删除)
      // 注意：这里假设 messagesToDelete 是连续的
      this.messages.splice(index, messagesToDelete.length)
    },

    // 8. 删除对话
    async deleteConversation(id: string) {
      try {
        await request.delete(`/chat/conversations/${id}`)

        const index = this.conversations.findIndex(c => c._id === id)
        if (index !== -1) {
          this.conversations.splice(index, 1)
        }

        if (this.activeConversationId === id) {
          this.activeConversationId = null
          this.messages = []

          if (this.conversations.length > 0) {
            this.setActiveConversation(this.conversations[0]._id)
          }
        }
      } catch (error) {
        console.error('删除对话失败', error)
      }
    },

    // 6. 更新对话标题
    async updateConversationTitle(id: string, title: string) {
      try {
        await request.patch(`/chat/conversations/${id}`, { title })

        const conversation = this.conversations.find(c => c._id === id)
        if (conversation) {
          conversation.title = title
        }
      } catch (error) {
        console.error('更新对话标题失败', error)
      }
    },

    // 7. 清空当前对话消息
    clearMessages() {
      this.messages = []
    }
  }
})

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { Delete, Position, Upload, Plus, Document, VideoPlay, MagicStick } from '@element-plus/icons-vue'
import { ElInput, ElMessage, ElMessageBox } from 'element-plus'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'


// 设置 PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

// 定义组件的属性
const props = defineProps({
  loading: {
    type: Boolean,
    default: false
  },
  generating: {
    type: Boolean,
    default: false
  }
})

// 定义组件的事件
const emit = defineEmits(['send', 'clear', 'stop'])

// 消息文本的响应式引用
const messageText = ref('')

import { sendMessage as sendApiMessage } from '../utils/api'
import { useSettingsStore } from '../stores/settings'

const isOptimizing = ref(false)



// 输入框的占位符
const placeholder = `输入消息，按Enter发送
Shift + Enter 换行`

const showUpload = ref(false)
const selectedFiles = ref<File[]>([])

// 切换上传区域显示
const toggleUpload = () => {
  showUpload.value = !showUpload.value
}

// 处理文件选择
const handleFileChange = (file: { raw: File }) => {
  selectedFiles.value.push(file.raw)
}

// 移除文件
const removeFile = (index: number) => {
  selectedFiles.value.splice(index, 1)
}

// 判断是否为图片文件
const isImage = (file: File) => {
  return file.type.startsWith('image/')
}

// 获取预览URL
const getPreviewUrl = (file: File) => {
  return URL.createObjectURL(file)
}

// 修改发送处理函数
const handleSend = async () => {
  if ((!messageText.value.trim() && selectedFiles.value.length === 0) || props.loading) return

  try {
    // 处理文件上传
    const fileContents = await Promise.all(
      selectedFiles.value.map(async (file) => {
        if (isImage(file)) {
          return await convertImageToBase64(file)
        } else {
          return await readFileContent(file)
        }
      })
    )

    // 组合消息内容
    let content = messageText.value
    if (fileContents.length > 0) {
      content = content + '\n' + fileContents.join('\n')
    }

    emit('send', content)
    messageText.value = ''
    selectedFiles.value = []
    showUpload.value = false
  } catch (error) {
    console.error('发送失败:', error)
    ElMessage.error('发送失败，请重试')
  }
}

// 将图片转换为base64
const convertImageToBase64 = (file: File) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(`![${file.name}](${e.target?.result})`)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// 读取文件内容
const readFileContent = async (file: File) => {
  try {
    const fileName = file.name.toLowerCase()
    
    if (fileName.endsWith('.docx')) {
      const arrayBuffer = await file.arrayBuffer()
      const result = await mammoth.extractRawText({ arrayBuffer })
      return `\`\`\`document\n${result.value}\n\`\`\``
    } else if (fileName.endsWith('.pdf')) {
      const arrayBuffer = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument(arrayBuffer)
      const pdf = await loadingTask.promise
      let fullText = ''
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map((item: any) => item.str).join(' ')
        fullText += pageText + '\n\n'
      }
      
      return `\`\`\`document\n${fullText}\n\`\`\``
    } else {
      // 默认作为文本文件读取
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          resolve(`\`\`\`document\n${e.target?.result}\n\`\`\``)
        }
        reader.onerror = reject
        reader.readAsText(file)
      })
    }
  } catch (error) {
    console.error('文件解析失败:', error)
    ElMessage.error(`文件 ${file.name} 解析失败`)
    throw error
  }
}



// 处理清空对话的函数
const handleClear = async () => {
  try {
    // 使用Element Plus的消息框组件，提示用户是否确定清空对话记录
    await ElMessageBox.confirm(
      '确定要清空当前会话的所有对话记录吗？',
      '警告',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
    // 如果用户确认清空，则触发clear事件
    emit('clear')
  } catch {
    // 如果用户取消操作，则不做任何事情
  }
}

const inputRef = ref<InstanceType<typeof ElInput> | null>(null)

// 调整输入框高度的方法
const adjustHeight = () => {
  if (inputRef.value) {
    // 获取输入框的DOM元素,因为是 ref，需要通过$el获取DOM元素
    const textarea = inputRef.value.$el.querySelector('textarea')
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }
}

const optimizePrompt = async () => {
  if (!messageText.value.trim() || isOptimizing.value) return

  isOptimizing.value = true
  const originalText = messageText.value
  
  try {
    const settingsStore = useSettingsStore()
    const metaPrompt = "你是一个专业的大语言模型Prompt工程师。请将用户输入的简单意图，扩写为一个详细、结构清晰、逻辑严密的优质Prompt，不仅要明确角色和任务，还能给出适当的约束以保证模型输出最佳结果。请直接返回优化后的Prompt文本，不要包含任何前言、后语或注释。"
    
    const messages = [
        { role: 'user' as const, content: `${metaPrompt}\n\n请优化以下内容：\n${originalText}` }
    ]
    
    const payload = {
        model: settingsStore.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: settingsStore.maxTokens,
        stream: false
    }

    const result = await sendApiMessage(payload)
    const optimizedContent = result.choices[0]?.message?.content || ''
    
    if (optimizedContent) {
      messageText.value = optimizedContent.trim()
      ElMessage.success('提示词优化成功')
      nextTick(() => {
        adjustHeight()
      })
    }
  } catch (error) {
    console.error('提示词优化失败:', error)
    ElMessage.error('提示词优化失败，请重试')
  } finally {
    isOptimizing.value = false
  }
}

const handleKeydown = (evt: Event | KeyboardEvent) => {
  const e = evt as KeyboardEvent
  if(!e.key) return
  
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    handleSend()
  }
}

// 添加暂停处理函数
const handleStop = () => {
  emit('stop')
}
</script>

<template>
  <!-- 聊天输入容器 -->
  <div class="chat-input-container">
    <!-- Slash Command Menu -->


    <!-- 输入框和按钮的组合 -->
    <div class="input-wrapper">
      <!-- 添加文件上传区域 -->
      <div class="upload-area" v-if="showUpload">
        <el-upload class="upload-component" :action="null" :auto-upload="false" :on-change="handleFileChange"
          :show-file-list="false" multiple accept="image/*,.txt,.md,.docx,.pdf">
          <!-- trigger	触发文件选择框的内容 -->
          <template #trigger>
            <el-button type="primary" :icon="Plus">添加文件</el-button>
          </template>
        </el-upload>

        <!-- 预览区域 -->
        <div class="preview-list" v-if="selectedFiles.length">
          <div v-for="(file, index) in selectedFiles" :key="index" class="preview-item">
            <!-- 图片预览 -->
            <img v-if="isImage(file)" :src="getPreviewUrl(file)" class="preview-image" />
            <!-- 文件名预览 -->
            <div v-else class="file-preview">
              <el-icon>
                <Document />
              </el-icon>
              <span>{{ file.name }}</span>
            </div>
            <!-- 删除按钮 -->
            <el-button class="delete-btn" type="danger" :icon="Delete" circle @click="removeFile(index)" />
          </div>
        </div>
      </div>

      <el-input v-model="messageText" type="textarea" :rows="2" :autosize="{ minRows: 2, maxRows: 5 }"
        :placeholder="placeholder" resize="none" 
        @keydown="handleKeydown"
        @input="adjustHeight" ref="inputRef" />

      <div class="button-group">
        <!-- 添加切换上传区域的按钮 -->
        <el-tooltip content="上传文件" placement="top">
          <el-button circle :icon="Upload" @click="toggleUpload" />
        </el-tooltip>

        <el-tooltip content="清空对话" placement="top">
          <el-button circle type="danger" :icon="Delete" @click="handleClear" />
        </el-tooltip>

        <el-tooltip content="魔法棒（优化提示词）" placement="top">
          <el-button circle type="warning" :icon="MagicStick" :loading="isOptimizing" @click="optimizePrompt" />
        </el-tooltip>

        <el-button 
          :type="generating ? 'danger' : 'primary'" 
          :loading="loading && !generating" 
          :class="{ 'pulsing-button': generating }"
          @click="generating ? handleStop() : handleSend()">
          <template #icon>
            <el-icon>
              <component :is="generating ? VideoPlay : Position" />
            </el-icon>
          </template>
          {{ generating ? 'Stop' : 'Send' }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
// 聊天输入容器的样式
// 聊天输入容器的样式
.chat-input-container {
  padding: 1rem;
  background-color: transparent;
  border-top: none;
  position: relative; // added for absolute positioning of prompt-menu
}


.el-button--primary {
  border-radius: var(--border-radius); /* 调整为你想要的圆角大小 */
}


// 输入框和按钮组合的样式
.input-wrapper {
  display: flex;
  gap: 1rem;
  margin-bottom: 0;

  .el-input {
    flex: 1;

    :deep(.el-textarea__inner) {
      transition: all 0.3s;
      line-height: 1.6;
      padding: 12px 16px;
      overflow-y: auto;
      border: none;
      background: transparent;
      box-shadow: none;
      
      &:focus {
        box-shadow: none;
      }
    }
  }
}

// 按钮组的样式
.button-group {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  border-radius: var(--border-radius);
}

.upload-area {
  margin-bottom: 1rem;
  padding: 1rem;
  border: 2px dashed var(--border-color);
  border-radius: var(--border-radius);

  .preview-list {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;

    .preview-item {
      position: relative;
      width: 100px;
      height: 100px;

      .preview-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--border-radius);
      }

      .file-preview {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background-color: var(--bg-color-secondary);
        border-radius: var(--border-radius);

        .el-icon {
          font-size: 2rem;
          margin-bottom: 0.5rem;
        }

        span {
          font-size: 0.8rem;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          width: 90%;
        }
      }

      .delete-btn {
        position: absolute;
        top: -0.5rem;
        right: -0.5rem;
        padding: 0.25rem;
        transform: scale(0.8);
        border-radius: var(--border-radius);
      }
    }
  }
}

.pulsing-button {
  animation: pulse 1.5s infinite;
  border-radius: var(--border-radius);

}

@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
  100% {
    opacity: 1;
  }
}
</style>
<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { Fold, Expand, Plus, Delete, Edit, SwitchButton } from '@element-plus/icons-vue'
import { useChatStore } from '../stores/chat'
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'
import { ElMessageBox, ElInput } from 'element-plus'

const isCollapsed = ref(false)
const chatStore = useChatStore()
const authStore = useAuthStore()
const router = useRouter()

const conversations = computed(() => chatStore.conversations)
const activeId = computed(() => chatStore.activeConversationId)

const editingId = ref<string | null>(null)
const editTitle = ref('')
const editInputRef = ref<InstanceType<typeof ElInput>[] | null>(null)

// 初始化加载对话列表
chatStore.fetchConversations()

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
}

const createNewChat = () => {
  chatStore.createConversation()
}

const switchConversation = (id: string) => {
  chatStore.setActiveConversation(id)
}

const deleteConversation = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除这个会话吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    chatStore.deleteConversation(id)
  } catch {
    // 用户取消删除操作
  }
}

const startRename = async (conv: { _id: string, title: string }, event: Event) => {
  event.stopPropagation()
  editingId.value = conv._id
  editTitle.value = conv.title
  await nextTick()
  if (editInputRef.value && editInputRef.value.length > 0) {
    editInputRef.value[0]?.focus()
  }
}

const saveRename = async (conv: { _id: string }) => {
  if (editTitle.value.trim()) {
    await chatStore.updateConversationTitle(conv._id, editTitle.value.trim())
  }
  editingId.value = null
}

const cancelRename = () => {
  editingId.value = null
}

const handleRenameKeydown = (conv: { _id: string }, event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveRename(conv)
  } else if (event.key === 'Escape') {
    cancelRename()
  }
}

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    authStore.logout()
    router.push('/login')
  } catch {
    // 用户取消操作
  }
}
</script>

<template>
  <div class="sidebar" :class="{ 'collapsed': isCollapsed }">
    <div class="sidebar-header">
      <el-button v-if="!isCollapsed" type="primary" @click="createNewChat">
        <el-icon><Plus /></el-icon>新建会话
      </el-button>
      <el-button v-else circle type="primary" @click="createNewChat">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div class="conversations-list">
      <div v-for="conv in conversations" 
           :key="conv._id" 
           class="conversation-item"
           :class="{ 'active': conv._id === activeId }"
           @click="switchConversation(conv._id)">
        <div v-if="editingId === conv._id" class="conversation-edit" @click.stop>
          <el-input
            v-model="editTitle"
            size="small"
            @keydown="(e: any) => handleRenameKeydown(conv, e)"
            @blur="saveRename(conv)"
            ref="editInputRef"
          />
        </div>
        <div v-else class="conversation-title" :title="conv.title">
          {{ isCollapsed ? '💭' : conv.title }}
        </div>
        <div v-if="!isCollapsed" class="conversation-actions">
          <el-button link size="small" @click.stop="startRename(conv, $event)">
            <el-icon><Edit /></el-icon>
          </el-button>
          <el-button link size="small" type="danger" @click.stop="deleteConversation(conv._id)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <div class="sidebar-footer">
      <el-button v-if="!isCollapsed" type="danger" plain @click="handleLogout" class="logout-btn">
        <el-icon><SwitchButton /></el-icon>退出登录
      </el-button>
      <el-button v-else circle type="danger" plain @click="handleLogout" class="logout-btn-collapsed">
        <el-icon><SwitchButton /></el-icon>
      </el-button>
    </div>

    <div class="collapse-btn" @click="toggleSidebar">
      <el-icon>
        <Fold v-if="!isCollapsed" />
        <Expand v-else />
      </el-icon>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.sidebar {
  width: 260px;
  height: 100%;
  flex-shrink: 0; /* 防止侧边栏被压缩 */
  background-color: var(--bg-color);
  border-right: 1px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
  display: flex;
  flex-direction: column;
  
  &.collapsed {
    width: 60px;
  }
}

.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.conversations-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: center;

  .logout-btn {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem;
  margin-bottom: 0.5rem;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--bg-color-secondary);
    .conversation-actions {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--el-color-primary-light-9);
  }
}

.conversation-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-edit {
  flex: 1;
  margin-right: 0.5rem;
  
  :deep(.el-input__inner) {
    height: 24px;
    line-height: 24px;
  }
}

.conversation-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.edit-btn, .delete-btn {
  padding: 2px;
  height: 20px;
  
  .el-icon {
    font-size: 14px;
  }
}

/* 修改 el-button 的默认样式 */
.el-button {
  background-color: #2196F3; /* 背景颜色改为蓝色 */
  border-color: #2196F3; /* 边框颜色改为蓝色 */
  color: white; /* 文字颜色保持为白色 */
  border-radius: var(--border-radius); /* 使用自定义变量设置圆角大小 */

  &:hover {
    background-color: #1976D2; /* 鼠标悬停时的背景颜色改为深蓝色 */
  
  }

  &:active {
    background-color: white; /* 按下时的背景颜色反转为白色 */
  
    color: #2196F3; /* 按下时的文字颜色反转为蓝色 */
  }
}

/* 修改 el-button 的圆形样式 */
.el-button.is-circle {
  background-color: #2196F3; /* 背景颜色改为蓝色 */
  border-color: #2196F3; /* 边框颜色改为蓝色 */
  color: white; /* 文字颜色保持为白色 */
  border-radius: var(--border-radius); /* 使用自定义变量设置圆角大小 */
  width: 40px; /* 可选：设置圆形按钮的宽度 */
  height: 40px; /* 可选：设置圆形按钮的高度 */
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: #1976D2; /* 鼠标悬停时的背景颜色改为深蓝色 */
  
  }
}

.collapse-btn {
  position: absolute;
  right: -12px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  background-color: var(--bg-color);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 1;

  &:hover {
    background-color: var(--bg-color-secondary);
  }
}
</style>
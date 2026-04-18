<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { Fold, Expand, Plus, Delete, Edit, SwitchButton, Document, Message, Upload } from '@element-plus/icons-vue'
import { useChatStore } from '../stores/chat'
import { useNoteStore } from '../stores/note'
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'
import { ElMessageBox, ElInput, ElMessage } from 'element-plus'

const isCollapsed = ref(false)

// Note section collapse state
const isNotesCollapsed = ref(false)
const isChatsCollapsed = ref(false)

const chatStore = useChatStore()
const noteStore = useNoteStore()
const authStore = useAuthStore()
const router = useRouter()

const conversations = computed(() => chatStore.conversations)
const activeChatId = computed(() => chatStore.activeConversationId)
const notes = computed(() => noteStore.notes)
const activeNoteId = computed(() => noteStore.activeNoteId)

// Initialize - fetch both conversations and notes
onMounted(() => {
  chatStore.fetchConversations()
  noteStore.fetchNotes()
})

const toggleSidebar = () => {
  isCollapsed.value = !isCollapsed.value
}

// Note section methods
const toggleNotesSection = () => {
  isNotesCollapsed.value = !isNotesCollapsed.value
}

const createNewNote = async () => {
  const id = await noteStore.createNote()
  if (id) {
    router.push(`/notes/${id}`)
  }
}

const mdFileInputRef = ref<HTMLInputElement | null>(null)

const triggerImportMd = (event: Event) => {
  event.stopPropagation()
  mdFileInputRef.value?.click()
}

const parseTitleFromFileName = (fileName: string) => {
  return fileName.replace(/\.md$/i, '').trim() || '导入笔记'
}

const handleImportMdChange = async (event: Event) => {
  const input = event.target as HTMLInputElement | null
  const file = input?.files?.[0]
  if (!file) return

  try {
    const isMarkdown = /\.md$/i.test(file.name) || file.type === 'text/markdown'
    if (!isMarkdown) {
      ElMessage.warning('请选择 .md 文件')
      return
    }

    const content = await file.text()
    const title = parseTitleFromFileName(file.name)
    const id = await noteStore.createNote(title)
    if (!id) {
      ElMessage.error('导入失败，请稍后重试')
      return
    }

    await noteStore.updateNote(id, { title, content })
    await noteStore.setActiveNote(id)
    router.push(`/notes/${id}`)
    ElMessage.success('导入 Markdown 成功')
  } catch (error) {
    console.error('导入 Markdown 失败', error)
    ElMessage.error('导入失败，请稍后重试')
  } finally {
    if (input) {
      input.value = ''
    }
  }
}

const switchNote = async (id: string) => {
  await noteStore.setActiveNote(id)
  router.push(`/notes/${id}`)
}

const deleteNote = async (id: string, event: Event) => {
  event.stopPropagation()
  try {
    await ElMessageBox.confirm('确定要删除这个笔记吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    noteStore.deleteNote(id)
  } catch {
    // User cancelled
  }
}

// Chat section methods
const toggleChatsSection = () => {
  isChatsCollapsed.value = !isChatsCollapsed.value
}

const createNewChat = async () => {
  const id = await chatStore.createConversation()
  if (id) {
    router.push('/')
  }
}

const switchConversation = async (id: string) => {
  await chatStore.setActiveConversation(id)
  router.push('/')
}

const deleteConversation = async (id: string, event: Event) => {
  event.stopPropagation()
  try {
    await ElMessageBox.confirm('确定要删除这个会话吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    chatStore.deleteConversation(id)
  } catch {
    // User cancelled
  }
}

// Note title editing
const editingNoteId = ref<string | null>(null)
const editNoteTitle = ref('')
const editNoteInputRef = ref<InstanceType<typeof ElInput>[] | null>(null)

const startRenameNote = async (note: { _id: string, title: string }, event: Event) => {
  event.stopPropagation()
  editingNoteId.value = note._id
  editNoteTitle.value = note.title
  await nextTick()
  if (editNoteInputRef.value && editNoteInputRef.value.length > 0) {
    editNoteInputRef.value[0]?.focus()
  }
}

const saveRenameNote = async (note: { _id: string }) => {
  if (editNoteTitle.value.trim()) {
    await noteStore.updateNote(note._id, { title: editNoteTitle.value.trim() })
  }
  editingNoteId.value = null
}

const cancelRenameNote = () => {
  editingNoteId.value = null
}

const handleNoteRenameKeydown = (note: { _id: string }, event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveRenameNote(note)
  } else if (event.key === 'Escape') {
    cancelRenameNote()
  }
}

// Chat title editing
const editingChatId = ref<string | null>(null)
const editChatTitle = ref('')
const editChatInputRef = ref<InstanceType<typeof ElInput>[] | null>(null)

const startRenameChat = async (conv: { _id: string, title: string }, event: Event) => {
  event.stopPropagation()
  editingChatId.value = conv._id
  editChatTitle.value = conv.title
  await nextTick()
  if (editChatInputRef.value && editChatInputRef.value.length > 0) {
    editChatInputRef.value[0]?.focus()
  }
}

const saveRenameChat = async (conv: { _id: string }) => {
  if (editChatTitle.value.trim()) {
    await chatStore.updateConversationTitle(conv._id, editChatTitle.value.trim())
  }
  editingChatId.value = null
}

const cancelRenameChat = () => {
  editingChatId.value = null
}

const handleChatRenameKeydown = (conv: { _id: string }, event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    saveRenameChat(conv)
  } else if (event.key === 'Escape') {
    cancelRenameChat()
  }
}

// Logout
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
    // User cancelled
  }
}
</script>

<template>
  <div class="sidebar" :class="{ 'collapsed': isCollapsed }">
    <!-- Sidebar Header -->
    <div class="sidebar-header" v-if="!isCollapsed">
      <div class="sidebar-title">
        <span>LLM Chat</span>
      </div>
    </div>

    <!-- Main Content -->
    <div class="sidebar-content" v-if="!isCollapsed">
      <!-- Notes Section -->
      <div class="section notes-section">
        <div class="section-header" @click="toggleNotesSection">
          <div class="section-title">
            <el-icon class="section-icon">
              <Document />
            </el-icon>
            <span>笔记</span>
          </div>
          <div class="section-actions">
            <input
              ref="mdFileInputRef"
              type="file"
              accept=".md,text/markdown"
              class="hidden-file-input"
              @change="handleImportMdChange"
              @click.stop
            />
            <el-button link size="small" @click.stop="triggerImportMd" title="导入 Markdown">
              <el-icon><Upload /></el-icon>
            </el-button>
            <el-button link size="small" @click.stop="createNewNote">
              <el-icon><Plus /></el-icon>
            </el-button>
            <el-icon class="collapse-icon" :class="{ 'collapsed': isNotesCollapsed }">
              <Fold />
            </el-icon>
          </div>
        </div>

        <div class="section-list" v-show="!isNotesCollapsed">
          <div
            v-for="note in notes"
            :key="note._id"
            class="list-item"
            :class="{ 'active': note._id === activeNoteId }"
            @click="switchNote(note._id)"
          >
            <div v-if="editingNoteId === note._id" class="item-edit" @click.stop>
              <el-input
                v-model="editNoteTitle"
                size="small"
                @keydown="(e: any) => handleNoteRenameKeydown(note, e)"
                @blur="saveRenameNote(note)"
                ref="editNoteInputRef"
              />
            </div>
            <template v-else>
              <span class="item-title" :title="note.title">
                {{ note.isPinned ? '📌 ' : '' }}{{ note.title }}
              </span>
              <div class="item-actions">
                <el-button link size="small" @click.stop="startRenameNote(note, $event)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button link size="small" type="danger" @click.stop="deleteNote(note._id, $event)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </template>
          </div>

          <div v-if="notes.length === 0" class="empty-hint">
            暂无笔记
          </div>
        </div>
      </div>

      <!-- Chats Section -->
      <div class="section chats-section">
        <div class="section-header" @click="toggleChatsSection">
          <div class="section-title">
            <el-icon class="section-icon">
              <Message />
            </el-icon>
            <span>AI 会话</span>
          </div>
          <div class="section-actions">
            <el-button link size="small" @click.stop="createNewChat">
              <el-icon><Plus /></el-icon>
            </el-button>
            <el-icon class="collapse-icon" :class="{ 'collapsed': isChatsCollapsed }">
              <Fold />
            </el-icon>
          </div>
        </div>

        <div class="section-list" v-show="!isChatsCollapsed">
          <div
            v-for="conv in conversations"
            :key="conv._id"
            class="list-item"
            :class="{ 'active': conv._id === activeChatId }"
            @click="switchConversation(conv._id)"
          >
            <div v-if="editingChatId === conv._id" class="item-edit" @click.stop>
              <el-input
                v-model="editChatTitle"
                size="small"
                @keydown="(e: any) => handleChatRenameKeydown(conv, e)"
                @blur="saveRenameChat(conv)"
                ref="editChatInputRef"
              />
            </div>
            <template v-else>
              <span class="item-title" :title="conv.title">
                {{ conv.title }}
              </span>
              <div class="item-actions">
                <el-button link size="small" @click.stop="startRenameChat(conv, $event)">
                  <el-icon><Edit /></el-icon>
                </el-button>
                <el-button link size="small" type="danger" @click.stop="deleteConversation(conv._id, $event)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </template>
          </div>

          <div v-if="conversations.length === 0" class="empty-hint">
            暂无会话
          </div>
        </div>
      </div>
    </div>

    <!-- Sidebar Footer -->
    <div class="sidebar-footer">
      <el-button v-if="!isCollapsed" type="danger" plain @click="handleLogout" class="logout-btn">
        <el-icon><SwitchButton /></el-icon>退出登录
      </el-button>
      <el-button v-else circle type="danger" plain @click="handleLogout" class="logout-btn-collapsed">
        <el-icon><SwitchButton /></el-icon>
      </el-button>
    </div>

    <!-- Collapse Button -->
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
  flex-shrink: 0;
  background-color: var(--bg-color-secondary);
  border-right: 1px solid var(--border-color);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  display: flex;
  flex-direction: column;
  z-index: 20;

  &.collapsed {
    width: 60px;
  }
}

.sidebar-header {
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);

  .sidebar-title {
    font-weight: 600;
    font-size: 1.1rem;
    color: var(--text-color-primary);
  }
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.section {
  display: flex;
  flex-direction: column;

  &.notes-section {
    border-bottom: 1px solid var(--border-color);
  }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--bg-color);
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--text-color-secondary);

  .section-icon {
    font-size: 1rem;
  }
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;

  .collapse-icon {
    transition: transform 0.3s;
    font-size: 0.9rem;
    color: var(--text-color-secondary);

    &.collapsed {
      transform: rotate(90deg);
    }
  }
}

.hidden-file-input {
  display: none;
}

.section-list {
  max-height: 300px;
  overflow-y: auto;
  padding: 0 0.5rem 0.5rem;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.25rem;
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--bg-color);
    .item-actions {
      opacity: 1;
    }
  }

  &.active {
    background-color: var(--el-color-primary-light-9);
  }
}

.item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
}

.item-edit {
  flex: 1;

  :deep(.el-input__inner) {
    height: 24px;
    line-height: 24px;
  }
}

.item-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;

  .el-button {
    padding: 2px;
    height: 20px;

    .el-icon {
      font-size: 12px;
    }
  }
}

.empty-hint {
  padding: 0.75rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--text-color-secondary);
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
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--bg-color-secondary);
  }
}
</style>

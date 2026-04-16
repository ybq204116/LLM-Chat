<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import SideBar from '../components/SideBar.vue'
import { useNoteStore } from '../stores/note'
import { renderMarkdown } from '../utils/markdown'

const route = useRoute()
const router = useRouter()
const noteStore = useNoteStore()

const localTitle = ref('')
const localContent = ref('')
const isSaving = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)

const activeNote = computed(() => noteStore.activeNoteContent)
const renderedContent = computed(() => renderMarkdown(localContent.value))

const loadNoteFromRoute = async () => {
  const routeNoteId = route.params.noteId as string | undefined

  if (routeNoteId) {
    await noteStore.setActiveNote(routeNoteId)
    return
  }

  if (noteStore.activeNoteId) {
    await noteStore.setActiveNote(noteStore.activeNoteId)
    return
  }

  await noteStore.fetchNotes()
  if (noteStore.notes.length > 0) {
    const firstNoteId = noteStore.notes[0]._id
    await noteStore.setActiveNote(firstNoteId)
    router.replace(`/notes/${firstNoteId}`)
  }
}

watch(
  () => activeNote.value,
  (note) => {
    localTitle.value = note?.title ?? ''
    localContent.value = note?.content ?? ''
  },
  { immediate: true }
)

watch(
  () => route.params.noteId,
  async () => {
    await loadNoteFromRoute()
  }
)

onMounted(async () => {
  await loadNoteFromRoute()
})

const insertIntoEditor = async (text: string) => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start

  localContent.value = localContent.value.slice(0, start) + text + localContent.value.slice(end)

  await nextTick()
  editor.focus()
  const cursor = start + text.length
  editor.setSelectionRange(cursor, cursor)
}

const wrapSelection = async (prefix: string, suffix: string = prefix, placeholder: string = '文本') => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)
  const content = selected || placeholder
  const inserted = `${prefix}${content}${suffix}`

  localContent.value = localContent.value.slice(0, start) + inserted + localContent.value.slice(end)

  await nextTick()
  editor.focus()

  if (selected) {
    editor.setSelectionRange(start + inserted.length, start + inserted.length)
    return
  }

  const selectStart = start + prefix.length
  const selectEnd = selectStart + placeholder.length
  editor.setSelectionRange(selectStart, selectEnd)
}

const insertTitleSyntax = async (level: number) => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  const headingPrefix = `${'#'.repeat(level)} `
  await insertIntoEditor(needsNewline ? `\n${headingPrefix}` : headingPrefix)
}

const focusEditor = async () => {
  await nextTick()
  editorRef.value?.focus()
}

const handleTextStyleCommand = async (command: string) => {
  if (command === 'body') {
    await focusEditor()
    return
  }

  if (command.startsWith('h')) {
    const level = Number(command.slice(1))
    if (!Number.isNaN(level) && level >= 1 && level <= 6) {
      await insertTitleSyntax(level)
    }
  }
}

const insertBoldSyntax = async () => {
  await wrapSelection('**')
}

const insertItalicSyntax = async () => {
  await wrapSelection('*')
}

const insertUnderlineSyntax = async () => {
  await wrapSelection('<u>', '</u>')
}

const insertStrikethroughSyntax = async () => {
  await wrapSelection('~~')
}

const saveNote = async () => {
  if (!noteStore.activeNoteId) return

  isSaving.value = true
  try {
    await noteStore.updateNote(noteStore.activeNoteId, {
      title: localTitle.value.trim() || '无标题笔记',
      content: localContent.value
    })
    ElMessage.success('笔记已保存')
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="app-container">
    <SideBar />

    <div class="note-container">
      <div class="note-toolbar">
        <div class="toolbar-middle">
          <el-dropdown trigger="click" @command="handleTextStyleCommand" class="toolbar-dropdown">
            <span class="toolbar-btn dropdown-trigger">
              正文 / 标题
              <el-icon class="el-icon--right"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="body">正文</el-dropdown-item>
                <el-dropdown-item command="h1" class="h1-item">一级标题</el-dropdown-item>
                <el-dropdown-item command="h2" class="h2-item">二级标题</el-dropdown-item>
                <el-dropdown-item command="h3" class="h3-item">三级标题</el-dropdown-item>
                <el-dropdown-item command="h4" class="h4-item">四级标题</el-dropdown-item>
                <el-dropdown-item command="h5" class="h5-item">五级标题</el-dropdown-item>
                <el-dropdown-item command="h6" class="h6-item">六级标题</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          
          <div class="toolbar-divider"></div>
          
          <div class="toolbar-btn" @click="insertBoldSyntax" title="粗体">
            <span style="font-weight: bold">B</span>
          </div>
          <div class="toolbar-btn" @click="insertItalicSyntax" title="斜体">
            <span style="font-style: italic">I</span>
          </div>
          <div class="toolbar-btn" @click="insertUnderlineSyntax" title="下划线">
            <span style="text-decoration: underline">U</span>
          </div>
          <div class="toolbar-btn" @click="insertStrikethroughSyntax" title="删除线">
            <span style="text-decoration: line-through">S</span>
          </div>
        </div>

        <div class="toolbar-right">
          <el-button type="primary" :loading="isSaving" @click="saveNote" size="default">保存</el-button>
        </div>
      </div>

      <div class="note-main">
        <div class="editor-pane">
          <textarea
            v-model="localContent"
            ref="editorRef"
            class="editor"
            placeholder="在这里输入 Markdown 内容..."
          />
        </div>
        <div class="preview-pane">
          <div class="markdown-body" v-html="renderedContent" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-container {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-color: var(--bg-color-secondary);
}

.note-container {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--bg-color);
}

.note-toolbar {
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-color);
}

.toolbar-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.toolbar-middle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  min-width: 32px;
  padding: 0 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-color-primary);
  font-size: 14px;
  transition: all 0.2s ease;
  user-select: none;
}

.toolbar-btn:hover {
  background-color: var(--bg-color-secondary);
  color: var(--primary-color);
}

.dropdown-trigger {
  padding: 0 12px;
}

.toolbar-dropdown {
  outline: none;
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background-color: var(--border-color);
  margin: 0 6px;
}

/* 标题下拉菜单样式增强 */
.h1-item { font-size: 1.5em; font-weight: bold; }
.h2-item { font-size: 1.3em; font-weight: bold; }
.h3-item { font-size: 1.1em; font-weight: bold; }
.h4-item { font-size: 1em; font-weight: bold; }
.h5-item { font-size: 0.9em; font-weight: bold; }
.h6-item { font-size: 0.8em; font-weight: bold; }

.title-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-color-primary);
  padding: 10px 12px;
  outline: none;
}

.title-input:focus {
  border-color: var(--primary-color);
}

.note-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.editor-pane,
.preview-pane {
  min-height: 0;
  overflow: auto;
}

.editor-pane {
  border-right: 1px solid var(--border-color);
}

.editor {
  width: 100%;
  height: 100%;
  border: 0;
  resize: none;
  padding: 18px;
  outline: none;
  color: var(--text-color-primary);
  background-color: transparent;
  font-size: 14px;
  line-height: 1.7;
  font-family: Consolas, "Courier New", monospace;
}

.preview-pane {
  padding: 18px;
}
</style>

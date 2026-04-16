<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
const noteMainRef = ref<HTMLElement | null>(null)
const editorPaneWidth = ref(50)
const isResizing = ref(false)

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

const insertLinkSyntax = async () => {
  await wrapSelection('[', '](url)', '链接文本')
}

const insertQuoteSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)
  
  if (selected) {
    const quoted = selected.split('\n').map(line => `> ${line}`).join('\n')
    localContent.value = localContent.value.slice(0, start) + quoted + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start, start + quoted.length)
  } else {
    const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
    const prefix = needsNewline ? '\n> ' : '> '
    await insertIntoEditor(prefix)
  }
}

const insertDividerSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  const text = needsNewline ? '\n---\n' : '---\n'
  await insertIntoEditor(text)
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

const normalizeExternalUrl = (href: string): string => {
  const trimmed = href.trim()
  if (!trimmed) return ''

  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) {
    return trimmed
  }

  return `https://${trimmed}`
}

const handlePreviewLinkClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  const anchor = target?.closest('a') as HTMLAnchorElement | null
  if (!anchor) return

  const href = anchor.getAttribute('href')
  if (!href) return

  const url = normalizeExternalUrl(href)
  if (!url) return

  event.preventDefault()
  window.open(url, '_blank', 'noopener,noreferrer')
}

const handleResizeMove = (event: MouseEvent) => {
  if (!isResizing.value || !noteMainRef.value) return

  const rect = noteMainRef.value.getBoundingClientRect()
  if (!rect.width) return

  const rawPercent = ((event.clientX - rect.left) / rect.width) * 100
  editorPaneWidth.value = Math.min(75, Math.max(25, rawPercent))
}

const stopResize = () => {
  if (!isResizing.value) return

  isResizing.value = false
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  window.removeEventListener('mousemove', handleResizeMove)
  window.removeEventListener('mouseup', stopResize)
}

const startResize = (event: MouseEvent) => {
  event.preventDefault()
  isResizing.value = true
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', handleResizeMove)
  window.addEventListener('mouseup', stopResize)
}

onUnmounted(() => {
  stopResize()
})
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

          <div class="toolbar-divider"></div>

          <div class="toolbar-btn" @click="insertLinkSyntax" title="链接">
            <el-icon><Link /></el-icon>
          </div>
          <div class="toolbar-btn" @click="insertQuoteSyntax" title="引用">
            <span>"</span>
          </div>
          <div class="toolbar-btn" @click="insertDividerSyntax" title="分割线">
            <span>—</span>
          </div>
        </div>

        <div class="toolbar-right">
          <el-button type="primary" :loading="isSaving" @click="saveNote" size="default">保存</el-button>
        </div>
      </div>

      <div class="note-main" ref="noteMainRef">
        <div class="editor-pane" :style="{ width: `${editorPaneWidth}%` }">
          <textarea
            v-model="localContent"
            ref="editorRef"
            class="editor"
            placeholder="在这里输入 Markdown 内容..."
          />
        </div>
        <div class="resize-handle" @mousedown="startResize" />
        <div class="preview-pane" :style="{ width: `${100 - editorPaneWidth}%` }">
          <div class="markdown-body" v-html="renderedContent" @click="handlePreviewLinkClick" />
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
  display: flex;
}

.editor-pane,
.preview-pane {
  min-height: 0;
  overflow: auto;
}

.resize-handle {
  width: 8px;
  cursor: col-resize;
  background-color: transparent;
  border-left: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  transition: background-color 0.2s ease;
}

.resize-handle:hover {
  background-color: var(--bg-color-secondary);
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

  :deep(.markdown-body) {
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-color-primary);

    h1, h2, h3, h4, h5, h6 {
      margin: 1rem 0 0.5rem;
      font-weight: 600;
      line-height: 1.25;
    }

    p {
      margin: 0.5rem 0;
      white-space: pre-wrap;
    }

    a {
      color: var(--primary-color);
      
      &:hover {
        text-decoration: underline;
      }
    }

    blockquote {
      margin: 1rem 0;
      padding: 0.5rem 1rem;
      color: var(--text-color-regular);
      background-color: transparent;
      border-left: 4px solid var(--border-color);
      border-radius: 0 4px 4px 0;
      
      p {
        margin: 0;
        &::before {
          content: '"';
        }
        &::after {
          content: '"';
        }
      }
    }

    hr {
      height: 1px;
      padding: 0;
      margin: 1.5rem 0;
      background-color: #000;
      border: 0;
    }

    ul, ol {
      padding-left: 2em;
      margin: 0.5rem 0;
    }

    code {
      font-family: var(--code-font-family);
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 85%;
      background-color: var(--code-bg);
      border-radius: var(--border-radius);
      color: var(--code-text);
    }

    pre {
      padding: 1rem;
      overflow: auto;
      font-size: 85%;
      line-height: 1.45;
      background-color: var(--code-block-bg);
      border-radius: var(--border-radius);
      margin: 0.5rem 0;
      border: 1px solid var(--border-color);
      
      code {
        padding: 0;
        background-color: transparent;
      }
    }
  }
}
</style>

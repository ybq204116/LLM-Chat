<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import mermaid from 'mermaid'
import JSZip from 'jszip'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import SideBar from '../components/SideBar.vue'
import { useNoteStore } from '../stores/note'
import request from '../utils/request'
import { renderMarkdown } from '../utils/markdown'

const route = useRoute()
const router = useRouter()
const noteStore = useNoteStore()

const localTitle = ref('')
const localContent = ref('')
const isSaving = ref(false)
const isExportingNotes = ref(false)
const isAutoSaving = ref(false)
const editorRef = ref<HTMLTextAreaElement | null>(null)
const noteMainRef = ref<HTMLElement | null>(null)
const previewPaneRef = ref<HTMLElement | null>(null)
const previewBodyRef = ref<HTMLElement | null>(null)
const editorPaneWidth = ref(50)
const isResizing = ref(false)
let hasMermaidInitialized = false
let mermaidRenderTaskId = 0
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let isSyncingScroll = false
const lastSavedTitle = ref('无标题笔记')
const lastSavedContent = ref('')
const showEditorContextMenu = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const isSyncScrollEnabled = ref(false)

const activeNote = computed(() => noteStore.activeNoteContent)
const renderedContent = computed(() => renderMarkdown(localContent.value))
const normalizedTitle = computed(() => localTitle.value.trim() || '无标题笔记')
const hasUnsavedChanges = computed(() => {
  return normalizedTitle.value !== lastSavedTitle.value || localContent.value !== lastSavedContent.value
})
const syncedNoteId = ref<string | null>(null)

type EditorContextChartAction =
  | 'chart-flowchart'
  | 'chart-sequenceDiagram'
  | 'chart-classDiagram'
  | 'chart-mindmap'
  | 'chart-erDiagram'
  | 'chart-stateDiagram'
  | 'chart-journey'
  | 'chart-gantt'
  | 'chart-pie'
type EditorContextAction = 'ai-writing' | 'insert-chart' | 'insert-image' | 'insert-formula' | 'toggle-sync-scroll' | EditorContextChartAction
type EditorContextMenuItem = {
  key: EditorContextAction
  icon: string
  label: string
  children?: Array<{ key: EditorContextAction; icon: string; label: string }>
}

const chartContextChildren: Array<{ key: EditorContextChartAction; icon: string; label: string }> = [
  { key: 'chart-flowchart', icon: '🔀', label: '流程图' },
  { key: 'chart-sequenceDiagram', icon: '�', label: '时序图' },
  { key: 'chart-classDiagram', icon: '🏷', label: '类图' },
  { key: 'chart-mindmap', icon: '🧠', label: '思维导图' },
  { key: 'chart-erDiagram', icon: '🗂', label: 'ER 图' },
  { key: 'chart-stateDiagram', icon: '🔁', label: '状态图' },
  { key: 'chart-journey', icon: '�', label: '用户旅程图' },
  { key: 'chart-gantt', icon: '📅', label: '甘特图' },
  { key: 'chart-pie', icon: '🥧', label: '饼图' }
]

const editorContextMenuItems = computed<EditorContextMenuItem[]>(() => [
  { key: 'ai-writing', icon: '🤖', label: 'AI 智能写作' },
  { key: 'insert-chart', icon: '📊', label: '插入图表', children: chartContextChildren },
  { key: 'insert-image', icon: '🖼️', label: '插入图片' },
  { key: 'insert-formula', icon: '∑', label: '插入公式' },
  { key: 'toggle-sync-scroll', icon: '↕', label: isSyncScrollEnabled.value ? '关闭同步滚动' : '开启同步滚动' }
])

const ensureMermaidInitialized = () => {
  if (hasMermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose'
  })
  hasMermaidInitialized = true
}

const renderMermaidCharts = async () => {
  const currentTaskId = ++mermaidRenderTaskId
  await nextTick()
  if (currentTaskId !== mermaidRenderTaskId) return

  const previewBody = previewBodyRef.value
  if (!previewBody) return

  const mermaidBlocks = Array.from(previewBody.querySelectorAll('pre code.language-mermaid'))
  if (mermaidBlocks.length === 0) return

  ensureMermaidInitialized()

  for (let index = 0; index < mermaidBlocks.length; index++) {
    if (currentTaskId !== mermaidRenderTaskId) return

    const codeBlock = mermaidBlocks[index]
    const source = codeBlock.textContent?.trim()
    const pre = codeBlock.closest('pre')
    if (!source || !pre) continue

    try {
      const renderId = `note-mermaid-${Date.now()}-${index}`
      const { svg } = await mermaid.render(renderId, source)
      if (currentTaskId !== mermaidRenderTaskId) return

      const chart = document.createElement('div')
      chart.className = 'mermaid-chart'
      chart.innerHTML = svg
      pre.replaceWith(chart)
    } catch (error) {
      console.error('Mermaid 渲染失败:', error)
    }
  }
}

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
    if (!note) {
      localTitle.value = ''
      localContent.value = ''
      lastSavedTitle.value = '无标题笔记'
      lastSavedContent.value = ''
      syncedNoteId.value = null
      return
    }

    const noteId = note._id
    const title = note?.title ?? ''
    const content = note?.content ?? ''
    const normalizedIncomingTitle = title.trim() || '无标题笔记'

    // 同一笔记保存回写时仅更新“已保存快照”，避免重置输入框导致光标抖动
    if (syncedNoteId.value === noteId) {
      lastSavedTitle.value = normalizedIncomingTitle
      lastSavedContent.value = content
      return
    }

    syncedNoteId.value = noteId
    localTitle.value = title
    localContent.value = content
    lastSavedTitle.value = normalizedIncomingTitle
    lastSavedContent.value = content
  },
  { immediate: true }
)

watch(
  () => route.params.noteId,
  async () => {
    await loadNoteFromRoute()
  }
)

watch(
  () => renderedContent.value,
  () => {
    void renderMermaidCharts()
  },
  { immediate: true, flush: 'post' }
)

onMounted(async () => {
  await loadNoteFromRoute()
})

watch([localTitle, localContent], () => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }

  if (!noteStore.activeNoteId || !hasUnsavedChanges.value) return
  autoSaveTimer = setTimeout(() => {
    void saveNote({ silent: true })
  }, 1000)
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

type ChartCommand =
  | 'flowchart'
  | 'sequenceDiagram'
  | 'classDiagram'
  | 'mindmap'
  | 'erDiagram'
  | 'stateDiagram'
  | 'journey'
  | 'gantt'
  | 'pie'

const chartTemplates: Record<ChartCommand, string> = {
  flowchart: `\`\`\`mermaid
flowchart TD
    A[开始] --> B{条件判断}
    B -->|是| C[处理步骤]
    B -->|否| D[备用步骤]
    C --> E[结束]
    D --> E
\`\`\``,
  sequenceDiagram: `\`\`\`mermaid
sequenceDiagram
    participant U as 用户
    participant S as 系统
    U->>S: 发起请求
    S-->>U: 返回结果
\`\`\``,
  classDiagram: `\`\`\`mermaid
classDiagram
    class User {
      +String name
      +login()
    }
    class Note {
      +String title
      +save()
    }
    User --> Note : 创建
\`\`\``,
  mindmap: `\`\`\`mermaid
mindmap
  root((笔记体系))
    目标
      周目标
      月目标
    项目
      需求整理
      开发计划
    学习
      技术主题
      复盘总结
\`\`\``,
  erDiagram: `\`\`\`mermaid
erDiagram
    USER ||--o{ NOTE : creates
    USER {
      string id
      string name
      string email
    }
    NOTE {
      string id
      string title
      text content
    }
\`\`\``,
  stateDiagram: `\`\`\`mermaid
stateDiagram-v2
    [*] --> 待处理
    待处理 --> 进行中: 开始
    进行中 --> 已完成: 完成
    进行中 --> 待处理: 回退
    已完成 --> [*]
\`\`\``,
  journey: `\`\`\`mermaid
journey
    title 用户完成一条任务的体验
    section 创建任务
      打开笔记页: 5: 用户
      新增任务项: 4: 用户
    section 执行任务
      标记进行中: 4: 用户
      标记完成: 5: 用户
\`\`\``,
  gantt: `\`\`\`mermaid
gantt
    title 项目计划
    dateFormat YYYY-MM-DD
    section 阶段一
    需求分析 :done, a1, 2026-04-01, 3d
    原型设计 :active, a2, 2026-04-04, 4d
    section 阶段二
    开发实现 :a3, 2026-04-08, 7d
\`\`\``,
  pie: `\`\`\`mermaid
pie title 数据占比
    "分类 A" : 40
    "分类 B" : 35
    "分类 C" : 25
\`\`\``
}

const insertChartSyntax = async (command: ChartCommand) => {
  const editor = editorRef.value
  if (!editor) return

  const template = chartTemplates[command]
  if (!template) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  const text = needsNewline ? `\n${template}` : template

  localContent.value = localContent.value.slice(0, start) + text + localContent.value.slice(end)
  await nextTick()
  editor.focus()
  editor.setSelectionRange(start + text.length, start + text.length)
}

const handleChartCommand = async (command: string | number | object) => {
  if (typeof command !== 'string') return
  if (!(command in chartTemplates)) return
  await insertChartSyntax(command as ChartCommand)
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

const insertUnorderedListSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)

  if (selected) {
    const list = selected
      .split('\n')
      .map(line => (line.trim() ? `- ${line}` : '- '))
      .join('\n')
    localContent.value = localContent.value.slice(0, start) + list + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start, start + list.length)
    return
  }

  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  await insertIntoEditor(needsNewline ? '\n- ' : '- ')
}

const insertOrderedListSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)

  if (selected) {
    const list = selected
      .split('\n')
      .map((line, index) => (line.trim() ? `${index + 1}. ${line}` : `${index + 1}. `))
      .join('\n')
    localContent.value = localContent.value.slice(0, start) + list + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start, start + list.length)
    return
  }

  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  await insertIntoEditor(needsNewline ? '\n1. ' : '1. ')
}

const insertTaskListSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)

  if (selected) {
    const taskList = selected
      .split('\n')
      .map(line => (line.trim() ? `- [ ] ${line}` : '- [ ] '))
      .join('\n')
    localContent.value = localContent.value.slice(0, start) + taskList + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start, start + taskList.length)
    return
  }

  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  await insertIntoEditor(needsNewline ? '\n- [ ] ' : '- [ ] ')
}

const insertMathSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'

  if (selected) {
    const inlineMath = `$${selected}$`
    localContent.value = localContent.value.slice(0, start) + inlineMath + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start + inlineMath.length, start + inlineMath.length)
    return
  }

  const template = '$$\n公式\n$$'
  const text = needsNewline ? `\n${template}` : template
  localContent.value = localContent.value.slice(0, start) + text + localContent.value.slice(end)
  await nextTick()
  editor.focus()
  const placeholderStart = start + (needsNewline ? 4 : 3)
  const placeholderEnd = placeholderStart + '公式'.length
  editor.setSelectionRange(placeholderStart, placeholderEnd)
}

const insertTableSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  const table = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容1 | 内容2 | 内容3 |\n'
  await insertIntoEditor(needsNewline ? `\n${table}` : table)
}

const insertCodeBlockSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'

  if (selected) {
    const block = `\`\`\`\n${selected}\n\`\`\``
    localContent.value = localContent.value.slice(0, start) + block + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start + block.length, start + block.length)
    return
  }

  const template = '```\n代码内容\n```'
  const text = needsNewline ? `\n${template}` : template
  localContent.value = localContent.value.slice(0, start) + text + localContent.value.slice(end)
  await nextTick()
  editor.focus()
  const placeholderStart = start + (needsNewline ? 5 : 4)
  const placeholderEnd = placeholderStart + '代码内容'.length
  editor.setSelectionRange(placeholderStart, placeholderEnd)
}

const insertHtmlSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const selected = localContent.value.slice(start, end)
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'

  if (selected) {
    const html = `<div>\n${selected}\n</div>`
    localContent.value = localContent.value.slice(0, start) + html + localContent.value.slice(end)
    await nextTick()
    editor.focus()
    editor.setSelectionRange(start + html.length, start + html.length)
    return
  }

  const template = '<div>\nHTML 内容\n</div>'
  const text = needsNewline ? `\n${template}` : template
  localContent.value = localContent.value.slice(0, start) + text + localContent.value.slice(end)
  await nextTick()
  editor.focus()
  const placeholderStart = start + (needsNewline ? 6 : 5)
  const placeholderEnd = placeholderStart + 'HTML 内容'.length
  editor.setSelectionRange(placeholderStart, placeholderEnd)
}

const updateEditorContentAndSelection = async (
  newContent: string,
  selectionStart: number,
  selectionEnd: number = selectionStart
) => {
  localContent.value = newContent
  await nextTick()
  if (!editorRef.value) return
  editorRef.value.focus()
  editorRef.value.setSelectionRange(selectionStart, selectionEnd)
}

const handleListEnter = async (editor: HTMLTextAreaElement) => {
  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const beforeCursor = localContent.value.slice(0, start)
  const lineStart = beforeCursor.lastIndexOf('\n') + 1
  const currentLine = localContent.value.slice(lineStart, start)

  const taskMatch = currentLine.match(/^(\s*)([-*+])\s+\[( |x|X)\]\s+(.*)$/)
  const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s+(.*)$/)
  const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s+(.*)$/)
  if (!taskMatch && !unorderedMatch && !orderedMatch) return false

  let insertion = '\n'
  if (taskMatch) {
    insertion += `${taskMatch[1]}${taskMatch[2]} [ ] `
  } else if (unorderedMatch) {
    insertion += `${unorderedMatch[1]}${unorderedMatch[2]} `
  } else if (orderedMatch) {
    insertion += `${orderedMatch[1]}${Number(orderedMatch[2]) + 1}. `
  }

  const newContent = localContent.value.slice(0, start) + insertion + localContent.value.slice(end)
  const cursor = start + insertion.length
  await updateEditorContentAndSelection(newContent, cursor)
  return true
}

const handleListIndent = async (editor: HTMLTextAreaElement, unindent: boolean) => {
  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const full = localContent.value
  const lineStart = full.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const nextBreak = full.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? full.length : nextBreak
  const selectedBlock = full.slice(lineStart, lineEnd)
  const lines = selectedBlock.split('\n')
  const listLineRegex = /^\s*(?:[-*+]\s+|\d+\.\s+)/
  if (!lines.some(line => listLineRegex.test(line))) return false

  const transformed = lines.map(line => {
    if (!listLineRegex.test(line)) return line
    if (unindent) {
      return line.replace(/^ {1,2}/, '')
    }
    return `  ${line}`
  })

  const replaced = transformed.join('\n')
  const newContent = full.slice(0, lineStart) + replaced + full.slice(lineEnd)
  await updateEditorContentAndSelection(newContent, lineStart, lineStart + replaced.length)
  return true
}

const handlePlainTabIndent = async (editor: HTMLTextAreaElement, unindent: boolean) => {
  const start = editor.selectionStart ?? localContent.value.length
  const end = editor.selectionEnd ?? start
  const full = localContent.value

  if (start === end) {
    if (unindent) {
      const lineStart = full.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const beforeCursor = full.slice(lineStart, start)
      const removeSize = beforeCursor.endsWith('  ') ? 2 : beforeCursor.endsWith(' ') ? 1 : 0
      if (removeSize === 0) return
      const newStart = start - removeSize
      const newContent = full.slice(0, newStart) + full.slice(start)
      await updateEditorContentAndSelection(newContent, newStart)
      return
    }

    const newContent = full.slice(0, start) + '  ' + full.slice(end)
    await updateEditorContentAndSelection(newContent, start + 2)
    return
  }

  const lineStart = full.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const nextBreak = full.indexOf('\n', end)
  const lineEnd = nextBreak === -1 ? full.length : nextBreak
  const selectedBlock = full.slice(lineStart, lineEnd)
  const lines = selectedBlock.split('\n')

  const transformed = lines.map(line => {
    if (unindent) return line.replace(/^ {1,2}/, '')
    return `  ${line}`
  })

  const replaced = transformed.join('\n')
  const newContent = full.slice(0, lineStart) + replaced + full.slice(lineEnd)
  await updateEditorContentAndSelection(newContent, lineStart, lineStart + replaced.length)
}

const handleEditorKeydown = async (event: KeyboardEvent) => {
  const editor = editorRef.value
  if (!editor) return

  if (event.key === 'Enter') {
    const handled = await handleListEnter(editor)
    if (handled) {
      event.preventDefault()
    }
    return
  }

  if (event.key === 'Tab') {
    event.preventDefault()
    const handled = await handleListIndent(editor, event.shiftKey)
    if (!handled) {
      await handlePlainTabIndent(editor, event.shiftKey)
    }
  }
}

const saveNote = async (options: { silent?: boolean } = {}) => {
  const { silent = false } = options
  if (!noteStore.activeNoteId) return
  if (!hasUnsavedChanges.value) return
  if (isSaving.value || isAutoSaving.value) return

  if (silent) {
    isAutoSaving.value = true
  } else {
    isSaving.value = true
  }
  try {
    const result = await noteStore.updateNote(noteStore.activeNoteId, {
      title: normalizedTitle.value,
      content: localContent.value
    })
    if (result) {
      lastSavedTitle.value = normalizedTitle.value
      lastSavedContent.value = localContent.value
      if (!silent) {
        ElMessage.success('笔记已保存')
      }
      return
    }

    if (!silent) {
      ElMessage.error('保存失败，请稍后重试')
    }
  } catch (error) {
    console.error('保存笔记失败', error)
    if (!silent) {
      ElMessage.error('保存失败，请稍后重试')
    }
  } finally {
    if (silent) {
      isAutoSaving.value = false
    } else {
      isSaving.value = false
    }
  }
}

type DownloadFormat = 'md' | 'txt' | 'html' | 'pdf'

const sanitizeFileName = (name: string) => {
  const trimmed = name.trim() || '无标题笔记'
  return trimmed
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
}

const htmlToPlainText = (html: string) => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

const triggerDownload = (fileName: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  triggerBlobDownload(fileName, blob)
}

const triggerBlobDownload = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const exportPreviewAsPdf = async (title: string) => {
  const previewElement = previewBodyRef.value
  if (!previewElement) {
    ElMessage.error('预览区不可用，无法导出 PDF')
    return
  }

  const sandbox = document.createElement('div')
  sandbox.style.position = 'fixed'
  sandbox.style.left = '-100000px'
  sandbox.style.top = '0'
  sandbox.style.width = `${previewElement.clientWidth || 960}px`
  sandbox.style.padding = '20px'
  sandbox.style.backgroundColor = '#ffffff'
  sandbox.style.color = '#222'
  sandbox.style.boxSizing = 'border-box'

  const clonedPreview = previewElement.cloneNode(true) as HTMLElement
  sandbox.appendChild(clonedPreview)
  document.body.appendChild(sandbox)

  try {
    const canvas = await html2canvas(sandbox, {
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      backgroundColor: '#ffffff'
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pageWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
    heightLeft -= pageHeight

    while (heightLeft > 0) {
      position = heightLeft - imgHeight
      pdf.addPage()
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight)
      heightLeft -= pageHeight
    }

    pdf.save(`${title}.pdf`)
  } catch (error) {
    console.error('导出 PDF 失败', error)
    ElMessage.error('导出 PDF 失败，请稍后重试')
  } finally {
    sandbox.remove()
  }
}

const formatNoteMarkdown = (title: string, content: string) => {
  if (content.trim()) {
    return content
  }
  return `# ${title}\n`
}

const exportAllNotesZip = async () => {
  if (isExportingNotes.value) return
  isExportingNotes.value = true

  try {
    const notes = await request.get('/notes') as Array<{ title?: string; content?: string }>
    if (!notes || notes.length === 0) {
      ElMessage.warning('暂无可导出的笔记')
      return
    }

    const zip = new JSZip()
    const fileNameCounter = new Map<string, number>()

    for (const note of notes) {
      const title = (note.title || '无标题笔记').trim()
      const markdown = formatNoteMarkdown(title, note.content || '')
      const baseName = sanitizeFileName(title) || '无标题笔记'
      const currentCount = fileNameCounter.get(baseName) || 0
      fileNameCounter.set(baseName, currentCount + 1)
      const suffix = currentCount > 0 ? `_${currentCount + 1}` : ''
      zip.file(`${baseName}${suffix}.md`, markdown)
    }

    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    triggerBlobDownload(`全部笔记_${stamp}.zip`, zipBlob)
    ElMessage.success('笔记导出成功')
  } catch (error) {
    console.error('导出笔记失败', error)
    ElMessage.error('导出笔记失败，请稍后重试')
  } finally {
    isExportingNotes.value = false
  }
}

const downloadNote = async (format: DownloadFormat) => {
  const baseName = sanitizeFileName(localTitle.value)
  const previewHtml = previewBodyRef.value?.innerHTML?.trim() || renderedContent.value
  if (format === 'md') {
    triggerDownload(`${baseName}.md`, localContent.value, 'text/markdown')
    return
  }

  if (format === 'txt') {
    const plainText = htmlToPlainText(renderedContent.value)
    triggerDownload(`${baseName}.txt`, plainText, 'text/plain')
    return
  }

  if (format === 'pdf') {
    await exportPreviewAsPdf(baseName)
    return
  }

  const htmlDoc = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${baseName}</title>
</head>
<body>
  ${previewHtml}
</body>
</html>`
  triggerDownload(`${baseName}.html`, htmlDoc, 'text/html')
}

const handleDownloadCommand = (command: string | number | object) => {
  if (typeof command !== 'string') return
  if (command !== 'md' && command !== 'txt' && command !== 'html' && command !== 'pdf') return
  void downloadNote(command)
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

const syncScroll = (from: HTMLElement, to: HTMLElement) => {
  const fromScrollableHeight = from.scrollHeight - from.clientHeight
  const toScrollableHeight = to.scrollHeight - to.clientHeight
  if (fromScrollableHeight <= 0 || toScrollableHeight <= 0) return

  const ratio = from.scrollTop / fromScrollableHeight
  isSyncingScroll = true
  to.scrollTop = ratio * toScrollableHeight
  requestAnimationFrame(() => {
    isSyncingScroll = false
  })
}

const handleEditorScroll = () => {
  if (!isSyncScrollEnabled.value || isSyncingScroll) return
  const editor = editorRef.value
  const previewPane = previewPaneRef.value
  if (!editor || !previewPane) return
  syncScroll(editor, previewPane)
}

const closeEditorContextMenu = () => {
  showEditorContextMenu.value = false
}

const handleEditorContextMenu = (event: MouseEvent) => {
  event.preventDefault()
  contextMenuPosition.value = {
    x: event.clientX,
    y: event.clientY
  }
  showEditorContextMenu.value = true
}

const chartActionMap: Record<EditorContextChartAction, string> = {
  'chart-flowchart': 'flowchart',
  'chart-sequenceDiagram': 'sequenceDiagram',
  'chart-classDiagram': 'classDiagram',
  'chart-mindmap': 'mindmap',
  'chart-erDiagram': 'erDiagram',
  'chart-stateDiagram': 'stateDiagram',
  'chart-journey': 'journey',
  'chart-gantt': 'gantt',
  'chart-pie': 'pie'
}

const isChartContextAction = (action: EditorContextAction): action is EditorContextChartAction => {
  return action in chartActionMap
}

const handleEditorContextAction = async (action: EditorContextAction) => {
  if (isChartContextAction(action)) {
    await insertChartSyntax(chartActionMap[action] as ChartCommand)
    closeEditorContextMenu()
    return
  }

  if (action === 'toggle-sync-scroll') {
    isSyncScrollEnabled.value = !isSyncScrollEnabled.value
    if (isSyncScrollEnabled.value) {
      handleEditorScroll()
    }
    ElMessage.info(`同步滚动${isSyncScrollEnabled.value ? '已开启' : '已关闭'}`)
    closeEditorContextMenu()
    return
  }

  if (action === 'insert-formula') {
    await insertMathSyntax()
    closeEditorContextMenu()
    return
  }

  const actionLabelMap: Record<'ai-writing' | 'insert-chart' | 'insert-image' | 'insert-formula', string> = {
    'ai-writing': 'AI 智能写作',
    'insert-chart': '插入图表',
    'insert-image': '插入图片',
    'insert-formula': '插入公式'
  }
  ElMessage.info(`${actionLabelMap[action as 'ai-writing' | 'insert-chart' | 'insert-image' | 'insert-formula']}功能待实现`)
  closeEditorContextMenu()
}

const handleGlobalClickForContextMenu = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.editor-context-menu')) return
  closeEditorContextMenu()
}

const handleGlobalKeydownForContextMenu = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    closeEditorContextMenu()
  }
}

const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeRouteLeave((_to, _from, next) => {
  if (!hasUnsavedChanges.value) {
    next()
    return
  }

  const confirmed = window.confirm('当前笔记有未保存内容，确定离开吗？')
  next(confirmed)
})

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('click', handleGlobalClickForContextMenu)
  window.addEventListener('keydown', handleGlobalKeydownForContextMenu)
})

onUnmounted(() => {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('click', handleGlobalClickForContextMenu)
  window.removeEventListener('keydown', handleGlobalKeydownForContextMenu)
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
          <div class="toolbar-btn" @click="insertUnorderedListSyntax" title="无序列表">
            <el-icon><List /></el-icon>
          </div>
          <div class="toolbar-btn" @click="insertOrderedListSyntax" title="有序列表">
            <el-icon><Sort /></el-icon>
          </div>
          <div class="toolbar-btn" @click="insertTaskListSyntax" title="任务列表">
            <span>[ ]</span>
          </div>
          <div class="toolbar-btn" @click="insertMathSyntax" title="数学公式">
            <span>fx</span>
          </div>
          <el-dropdown trigger="click" @command="handleChartCommand" class="toolbar-dropdown">
            <span class="toolbar-btn dropdown-trigger">
              图表
              <el-icon class="el-icon--right"><arrow-down /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="flowchart">流程图</el-dropdown-item>
                <el-dropdown-item command="sequenceDiagram">时序图</el-dropdown-item>
                <el-dropdown-item command="classDiagram">类图</el-dropdown-item>
                <el-dropdown-item command="mindmap">思维导图</el-dropdown-item>
                <el-dropdown-item command="erDiagram">ER 图</el-dropdown-item>
                <el-dropdown-item command="stateDiagram">状态图</el-dropdown-item>
                <el-dropdown-item command="journey">用户旅程图</el-dropdown-item>
                <el-dropdown-item command="gantt">甘特图</el-dropdown-item>
                <el-dropdown-item command="pie">饼图</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <div class="toolbar-btn" @click="insertTableSyntax" title="表格">
            <el-icon><Grid /></el-icon>
          </div>
          <div class="toolbar-btn" @click="insertCodeBlockSyntax" title="代码块">
            <el-icon><Tickets /></el-icon>
          </div>
          <div class="toolbar-btn" @click="insertHtmlSyntax" title="HTML">
            <span>&lt;/&gt;</span>
          </div>
        </div>

        <div class="toolbar-right">
          <el-button :loading="isExportingNotes" size="default" @click="exportAllNotesZip">
            导出笔记
          </el-button>
          <el-dropdown trigger="click" @command="handleDownloadCommand">
            <el-button size="default">下载</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="md">Markdown (.md)</el-dropdown-item>
                <el-dropdown-item command="txt">文本 (.txt)</el-dropdown-item>
                <el-dropdown-item command="html">网页 (.html)</el-dropdown-item>
                <el-dropdown-item command="pdf">PDF (.pdf)</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
            @keydown="handleEditorKeydown"
            @scroll="handleEditorScroll"
            @contextmenu="handleEditorContextMenu"
          />
        </div>
        <div class="resize-handle" @mousedown="startResize" />
        <div ref="previewPaneRef" class="preview-pane" :style="{ width: `${100 - editorPaneWidth}%` }">
          <div ref="previewBodyRef" class="markdown-body" v-html="renderedContent" @click="handlePreviewLinkClick" />
        </div>
      </div>
    </div>
    <div
      v-show="showEditorContextMenu"
      class="editor-context-menu"
      :style="{ left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }"
    >
      <div
        v-for="item in editorContextMenuItems"
        :key="item.key"
        class="context-menu-item"
        :class="{ 'has-children': !!item.children?.length }"
        @click.stop="item.children?.length ? null : handleEditorContextAction(item.key)"
      >
        <span class="context-menu-icon">{{ item.icon }}</span>
        {{ item.label }}
        <span v-if="item.children?.length" class="context-menu-arrow">›</span>
        <div v-if="item.children?.length" class="context-submenu">
          <div
            v-for="child in item.children"
            :key="child.key"
            class="context-submenu-item"
            @click.stop="handleEditorContextAction(child.key)"
          >
            <span class="context-menu-icon">{{ child.icon }}</span>
            {{ child.label }}
          </div>
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
  gap: 8px;
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

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.75rem 0;
    }

    th,
    td {
      border: 1px solid var(--border-color);
      padding: 0.45rem 0.65rem;
      text-align: left;
    }

    th {
      background-color: var(--bg-color-secondary);
      font-weight: 600;
    }

    ul, ol {
      padding-left: 2em;
      margin: 0.5rem 0;
    }

    ul ul,
    ul ol,
    ol ul,
    ol ol {
      margin-top: 0.25rem;
      margin-bottom: 0.25rem;
    }

    code {
      font-family: var(--code-font-family);
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 92%;
      background-color: var(--code-bg);
      border-radius: var(--border-radius);
      color: var(--text-color-primary);
    }

    pre {
      padding: 1rem;
      overflow: auto;
      font-size: 14px;
      line-height: 1.45;
      background-color: #f0f0f0;
      border-radius: var(--border-radius);
      margin: 0.5rem 0;
      border: 1px solid var(--border-color);
      color: var(--text-color-primary);
      
      .code-header {
        margin-bottom: 0.4rem;
      }

      code {
        padding: 0;
        background-color: transparent;
        color: inherit;
      }
    }

    .mermaid-chart {
      margin: 0.75rem 0;
      overflow: auto;
    }

    .mermaid-chart svg {
      display: block;
      max-width: 100%;
      height: auto;
    }
  }
}

.editor-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-color);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
}

.context-menu-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text-color-primary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.context-menu-item.has-children {
  padding-right: 22px;
}

.context-menu-icon {
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.context-menu-arrow {
  margin-left: auto;
  color: var(--text-color-secondary);
  font-size: 14px;
}

.context-menu-item:hover {
  background-color: var(--bg-color-secondary);
  color: var(--primary-color);
}

.context-submenu {
  display: none;
  position: absolute;
  top: 0;
  left: 100%;
  min-width: 160px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background-color: var(--bg-color);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
}

.context-menu-item.has-children:hover .context-submenu {
  display: block;
}

.context-submenu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--text-color-primary);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.context-submenu-item:hover {
  background-color: var(--bg-color-secondary);
  color: var(--primary-color);
}
</style>

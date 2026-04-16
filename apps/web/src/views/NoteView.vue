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

const insertBodySyntax = async () => {
  await insertIntoEditor('')
}

const insertTitleSyntax = async () => {
  const editor = editorRef.value
  if (!editor) return

  const start = editor.selectionStart ?? localContent.value.length
  const needsNewline = start > 0 && localContent.value[start - 1] !== '\n'
  await insertIntoEditor(needsNewline ? '\n# ' : '# ')
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
        <div class="toolbar-right">
          <el-button @click="insertBodySyntax">正文</el-button>
          <el-button @click="insertTitleSyntax">标题</el-button>
        </div>
        <el-button type="primary" :loading="isSaving" @click="saveNote">保存</el-button>
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
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-backdrop-filter);
}


.toolbar-right {
  display: flex;
  gap: 10px;
  align-items: center;
}

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

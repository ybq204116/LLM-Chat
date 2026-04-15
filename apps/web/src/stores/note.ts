import { defineStore } from 'pinia'
import request from '../utils/request'
import { useAuthStore } from './auth'
import type { INote } from '@llm-chat/shared'

interface NoteState {
    notes: INote[]
    activeNoteId: string | null
    activeNoteContent: INote | null
    isLoading: boolean
}

export const useNoteStore = defineStore('note', {
    state: (): NoteState => ({
        notes: [],
        activeNoteId: null,
        activeNoteContent: null,
        isLoading: false
    }),

    actions: {
        async fetchNotes() {
            const authStore = useAuthStore()
            if (!authStore.isLoggedIn) return

            this.isLoading = true
            try {
                const res = await request.get('/notes') as INote[]
                this.notes = res
            } catch (error) {
                console.error('获取笔记列表失败', error)
            } finally {
                this.isLoading = false
            }
        },

        async setActiveNote(id: string) {
            this.activeNoteId = id
            this.isLoading = true

            try {
                const res = await request.get(`/notes/${id}`) as INote
                this.activeNoteContent = res
            } catch (error) {
                console.error('获取笔记详情失败', error)
            } finally {
                this.isLoading = false
            }
        },

        async createNote(title: string = '无标题笔记') {
            try {
                const res = await request.post('/notes', { title }) as INote
                this.notes.unshift(res)
                this.setActiveNote(res._id)
                return res._id
            } catch (error) {
                console.error('创建笔记失败', error)
            }
        },

        async updateNote(id: string, data: { title?: string; content?: string; isPinned?: boolean }) {
            try {
                const res = await request.patch(`/notes/${id}`, data) as INote

                const index = this.notes.findIndex(n => n._id === id)
                if (index !== -1) {
                    this.notes[index] = { ...this.notes[index], ...res }
                }

                if (this.activeNoteId === id) {
                    this.activeNoteContent = res
                }

                return res
            } catch (error) {
                console.error('更新笔记失败', error)
            }
        },

        async deleteNote(id: string) {
            try {
                await request.delete(`/notes/${id}`)

                const index = this.notes.findIndex(n => n._id === id)
                if (index !== -1) {
                    this.notes.splice(index, 1)
                }

                if (this.activeNoteId === id) {
                    this.activeNoteId = null
                    this.activeNoteContent = null

                    if (this.notes.length > 0) {
                        this.setActiveNote(this.notes[0]._id)
                    }
                }
            } catch (error) {
                console.error('删除笔记失败', error)
            }
        },

        async togglePin(id: string) {
            try {
                const res = await request.patch(`/notes/${id}/toggle-pin`) as INote

                const index = this.notes.findIndex(n => n._id === id)
                if (index !== -1) {
                    this.notes[index].isPinned = res.isPinned
                }

                await this.fetchNotes()
            } catch (error) {
                console.error('切换置顶状态失败', error)
            }
        }
    }
})
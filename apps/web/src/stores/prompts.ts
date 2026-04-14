import { defineStore } from 'pinia'

export interface Prompt {
  id: string
  command: string
  title: string
  content: string
  icon: string
}

export const usePromptsStore = defineStore('prompts', {
  state: () => ({
    prompts: [
      {
        id: '1',
        command: '翻译',
        title: '中英互译专家',
        content: '你现在是一名精通中英互译的资深翻译家。请帮我翻译以下内容，要求符合目标语言的地道表达方式：\n\n',
        icon: 'ChatLineSquare'
      },
      {
        id: '2',
        command: '前端专家',
        title: '资深前端工程师',
        content: '你是一个资深前端大厂技术专家。请以专业、严谨、同时通俗易懂的方式回答我的问题。在提供代码示例时，请注重性能、可复用性以及代码规范。\n\n问题：',
        icon: 'Monitor'
      },
      {
        id: '3',
        command: '代码审查',
        title: 'Code Review 助手',
        content: '请作为资深技术专家对下面的代码段进行 Code Review，点出潜在的 bug、性能瓶颈并提供重构建议：\n\n```',
        icon: 'DocumentChecked'
      },
      {
        id: '4',
        command: '润色',
        title: '长文本润色',
        content: '请帮我润色以下文本，使其读起来更加专业、流畅、连贯，修正所有语病和错别字：\n\n',
        icon: 'EditPen'
      },
      {
        id: '5',
        command: '周报',
        title: '周报生成器',
        content: '请帮我把以下本周零散的工作项整理成一份结构清晰、条理分明、重点突出的专业周报（包含核心产出、问题与下周计划）：\n\n',
        icon: 'Calendar'
      }
    ] as Prompt[]
  }),
  getters: {
    // 根据关键词搜索 prompt
    searchPrompts: (state) => {
      return (keyword: string) => {
        if (!keyword) return state.prompts
        const lowerKeyword = keyword.toLowerCase()
        return state.prompts.filter(
          p => p.command.includes(lowerKeyword) || p.title.toLowerCase().includes(lowerKeyword)
        )
      }
    }
  }
})

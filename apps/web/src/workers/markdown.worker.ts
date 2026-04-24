import { renderMarkdownAsync } from '../utils/markdownCore'

type MarkdownRenderRequest = {
  id: number
  content: string
}

type MarkdownRenderResponse =
  | { id: number; html: string }
  | { id: number; html: string; error: string }

self.onmessage = async (event: MessageEvent<MarkdownRenderRequest>) => {
  const { id, content } = event.data

  try {
    const html = await renderMarkdownAsync(content || '')
    const response: MarkdownRenderResponse = { id, html }
    self.postMessage(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Markdown 渲染失败'
    const response: MarkdownRenderResponse = { id, html: '', error: message }
    self.postMessage(response)
  }
}

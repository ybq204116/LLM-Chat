import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import katex from 'katex'
import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  // breaks: false,        
  // xhtmlOut: false,      
  highlight: function (str: string, lang: string): string {
    const language = (lang || '').trim().toLowerCase()
    const isDocument = language === 'document'
    const isMermaid = language === 'mermaid'
    const languageLabel = isDocument ? 'DOCUMENT' : language

    if (isMermaid) {
      return `<pre class="hljs mermaid-source"><div class="code-header"><span class="code-lang">mermaid</span></div><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`
    }

    if (language && !isDocument && hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(str, {
          language: language,
          ignoreIllegals: true
        }).value
        return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><div class="code-header"><span class="code-lang">${language}</span></div><code class="${language}">${highlighted}</code></pre>`
      } catch (error) {
        // 发生错误时返回转义后的代码
        console.error(error)
        return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><code>${md.utils.escapeHtml(str)}</code></pre>`
      }
    }

    if (!isDocument) {
      try {
        const auto = hljs.highlightAuto(str)
        const detectedLanguage = auto.language || ''
        if (detectedLanguage) {
          return `<pre class="hljs"><div class="code-header"><span class="code-lang">${detectedLanguage}</span></div><code class="${detectedLanguage}">${auto.value}</code></pre>`
        }
      } catch (error) {
        console.error(error)
      }
    }

    if (languageLabel) {
      return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><div class="code-header"><span class="code-lang">${languageLabel}</span></div><code>${md.utils.escapeHtml(str)}</code></pre>`
    }

    return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><code>${md.utils.escapeHtml(str)}</code></pre>`
  }
})

type MarkdownToken = {
  attrIndex: (name: string) => number
  attrPush: (attrData: [string, string]) => void
  attrs?: [string, string][] | null
}

const addClassToToken = (token: MarkdownToken, className: string) => {
  const classIndex = token.attrIndex('class')
  if (classIndex < 0) {
    token.attrPush(['class', className])
    return
  }

  if (!token.attrs || !token.attrs[classIndex]) return
  const currentClassName = token.attrs[classIndex][1] || ''
  if (currentClassName.split(/\s+/).includes(className)) return
  token.attrs[classIndex][1] = `${currentClassName} ${className}`.trim()
}

// 任务列表支持：将 - [ ] / - [x] 渲染为复选框
md.core.ruler.after('inline', 'task_list', state => {
  const tokens = state.tokens

  for (let i = 2; i < tokens.length; i++) {
    const inlineToken = tokens[i]
    const paragraphOpenToken = tokens[i - 1]
    const listItemOpenToken = tokens[i - 2]

    if (
      inlineToken.type !== 'inline' ||
      paragraphOpenToken.type !== 'paragraph_open' ||
      listItemOpenToken.type !== 'list_item_open'
    ) {
      continue
    }

    const match = inlineToken.content.match(/^\[( |x|X)\]\s+/)
    if (!match) continue

    const checked = /x/i.test(match[1])
    const markerLength = match[0].length
    inlineToken.content = inlineToken.content.slice(markerLength)
    inlineToken.meta = {
      ...(inlineToken.meta || {}),
      isTaskListItem: true,
      isTaskChecked: checked
    }

    if (inlineToken.children && inlineToken.children.length > 0) {
      const firstChild = inlineToken.children[0]
      if (firstChild.type === 'text') {
        firstChild.content = firstChild.content.slice(markerLength)
      }

      const checkboxToken = new state.Token('html_inline', '', 0)
      checkboxToken.content = `<input class="task-list-item-checkbox" type="checkbox"${checked ? ' checked' : ''} disabled> `
      inlineToken.children.unshift(checkboxToken)
    }

    addClassToToken(listItemOpenToken, 'task-list-item')
    for (let j = i - 3; j >= 0; j--) {
      const parentListToken = tokens[j]
      if (parentListToken.type === 'bullet_list_open' || parentListToken.type === 'ordered_list_open') {
        addClassToToken(parentListToken, 'task-list')
        break
      }
    }
  }
})

// 添加 LaTeX 支持
const renderLatex = (tex: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(tex, {
      displayMode: displayMode,
      throwOnError: false,
      output: 'html'
    })
  } catch (error) {
    console.error('LaTeX 渲染错误:', error)
    return tex
  }
}

// 定义公式格式正则表达式
const INLINE_MATH_RULES = [
  /\$([^$\n]+)\$/,        // $...$（行内，避免跨行）
  /\\\((.+?)\\\)/         // \(...\)
]

const BLOCK_MATH_RULES = [
  /\$\$([\s\S]+?)\$\$/,   // $$...$$
  /\\\[([\s\S]+?)\\\]/    // \[...\]
]

// 添加行内公式支持
md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
  const content = state.src.slice(state.pos)

  for (const rule of INLINE_MATH_RULES) {
    const match = content.match(rule)
    if (match && match.index === 0) {
      if (!silent) {
        const token = state.push('math_inline', '', 0)
        token.content = match[1].trim()
        token.markup = match[0][0] // 保存公式的起始标记
      }
      state.pos += match[0].length
      return true
    }
  }
  return false
})

// 添加块级公式支持
md.block.ruler.before('paragraph', 'math_block', (state, startLine, _endLine, silent) => {
  const content = state.src.slice(state.bMarks[startLine] + state.tShift[startLine])

  for (const rule of BLOCK_MATH_RULES) {
    const match = content.match(rule)
    if (match && match.index === 0) {
      if (!silent) {
        const token = state.push('math_block', '', 0)
        token.content = match[1].trim()
        token.markup = match[0].slice(0, 2) // 保存公式的起始标记
        token.map = [startLine, startLine + match[0].split('\n').length]
      }
      state.line = startLine + match[0].split('\n').length
      return true
    }
  }
  return false
})

// 渲染规则
md.renderer.rules.math_inline = (tokens, idx) => {
  return renderLatex(tokens[idx].content, false)
}

md.renderer.rules.math_block = (tokens, idx) => {
  return renderLatex(tokens[idx].content, true)
}

// 修改默认的链接渲染，添加 target="_blank"
const defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, _env, self) {
  return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const aIndex = tokens[idx].attrIndex('target')
  if (aIndex < 0) {
    tokens[idx].attrPush(['target', '_blank'])
  } else {
    if (tokens[idx].attrs && tokens[idx].attrs[aIndex]) {
      tokens[idx].attrs[aIndex][1] = '_blank'
    }
  }

  const relIndex = tokens[idx].attrIndex('rel')
  if (relIndex < 0) {
    tokens[idx].attrPush(['rel', 'noopener noreferrer'])
  } else {
    if (tokens[idx].attrs && tokens[idx].attrs[relIndex]) {
      tokens[idx].attrs[relIndex][1] = 'noopener noreferrer'
    }
  }

  return defaultRender(tokens, idx, options, env, self)
}

// 导出渲染函数
export const renderMarkdown = (content: string): string => {
  return md.render(content)
} 

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
    const languageLabel = isDocument ? 'DOCUMENT' : language

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

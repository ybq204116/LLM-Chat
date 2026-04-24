import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

type KatexRenderer = {
    renderToString: (tex: string, options?: Record<string, unknown>) => string
}

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('text', plaintext)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('vue', xml)

let katexModuleRef: KatexRenderer | null = null
let katexModuleLoader: Promise<KatexRenderer | null> | null = null

const resolveKatexRenderer = (module: unknown): KatexRenderer | null => {
    const candidate = (module as { default?: unknown })?.default ?? module
    if (candidate && typeof (candidate as KatexRenderer).renderToString === 'function') {
        return candidate as KatexRenderer
    }
    return null
}

export const setKatexModule = (module: unknown) => {
    const renderer = resolveKatexRenderer(module)
    if (renderer) {
        katexModuleRef = renderer
    }
}

const escapeHtmlAttribute = (value: string): string => {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

const getDocumentMeta = (rawText: string) => {
    const normalized = rawText.replace(/\r\n/g, '\n')
    const lines = normalized.split('\n')
    const firstLine = (lines[0] || '').trim()
    const prefix = '[文件] '
    const fileName = firstLine.startsWith(prefix)
        ? firstLine.slice(prefix.length).trim() || '未命名文件'
        : '文件预览'

    return {
        fileName,
        raw: normalized
    }
}

const containsMathSyntax = (content: string): boolean => {
    if (!content) return false
    return /\$\$[\s\S]+?\$\$/.test(content) || /\\\[[\s\S]+?\\\]/.test(content) || /\$[^$\n]+\$/.test(content) || /\\\(.+?\\\)/.test(content)
}

const ensureKatexModule = async (): Promise<KatexRenderer | null> => {
    if (katexModuleRef) return katexModuleRef
    if (!katexModuleLoader) {
        katexModuleLoader = import('katex')
            .then(module => {
                const renderer = resolveKatexRenderer(module)
                if (renderer) {
                    katexModuleRef = renderer
                }
                return renderer
            })
            .catch(error => {
                console.error('KaTeX 加载失败:', error)
                return null
            })
            .finally(() => {
                katexModuleLoader = null
            })
    }
    return katexModuleLoader
}

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight: function (str: string, lang: string): string {
        const language = (lang || '').trim().toLowerCase()
        const isDocument = language === 'document'
        const isMermaid = language === 'mermaid'
        const languageLabel = isDocument ? 'DOCUMENT' : language

        if (isMermaid) {
            return `<pre class="hljs mermaid-source"><div class="code-header"><span class="code-lang">mermaid</span></div><code class="language-mermaid">${md.utils.escapeHtml(str)}</code></pre>`
        }

        if (isDocument) {
            const { fileName, raw } = getDocumentMeta(str)
            return `<pre class="hljs is-document" data-file-name="${escapeHtmlAttribute(fileName)}"><div class="file-card"><div class="file-icon" aria-hidden="true">📄</div><div class="file-name">${md.utils.escapeHtml(fileName)}</div></div><code>${md.utils.escapeHtml(raw)}</code></pre>`
        }

        if (language && !isDocument && hljs.getLanguage(language)) {
            try {
                const highlighted = hljs.highlight(str, {
                    language: language,
                    ignoreIllegals: true
                }).value
                return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><div class="code-header"><span class="code-lang">${language}</span></div><code class="${language}">${highlighted}</code></pre>`
            } catch (error) {
                console.error(error)
                return `<pre class="hljs ${isDocument ? 'is-document' : ''}"><code>${md.utils.escapeHtml(str)}</code></pre>`
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

const renderLatex = (tex: string, displayMode: boolean): string => {
    if (!katexModuleRef) return tex
    try {
        return katexModuleRef.renderToString(tex, {
            displayMode: displayMode,
            throwOnError: false,
            output: 'html'
        })
    } catch (error) {
        console.error('LaTeX 渲染错误:', error)
        return tex
    }
}

const INLINE_MATH_RULES = [
    /\$([^$\n]+)\$/,
    /\\\((.+?)\\\)/
]

const BLOCK_MATH_RULES = [
    /\$\$([\s\S]+?)\$\$/,
    /\\\[([\s\S]+?)\\\]/
]

md.inline.ruler.before('escape', 'math_inline', (state, silent) => {
    const content = state.src.slice(state.pos)

    for (const rule of INLINE_MATH_RULES) {
        const match = content.match(rule)
        if (match && match.index === 0) {
            if (!silent) {
                const token = state.push('math_inline', '', 0)
                token.content = match[1].trim()
                token.markup = match[0][0]
            }
            state.pos += match[0].length
            return true
        }
    }
    return false
})

md.block.ruler.before('paragraph', 'math_block', (state, startLine, _endLine, silent) => {
    const content = state.src.slice(state.bMarks[startLine] + state.tShift[startLine])

    for (const rule of BLOCK_MATH_RULES) {
        const match = content.match(rule)
        if (match && match.index === 0) {
            if (!silent) {
                const token = state.push('math_block', '', 0)
                token.content = match[1].trim()
                token.markup = match[0].slice(0, 2)
                token.map = [startLine, startLine + match[0].split('\n').length]
            }
            state.line = startLine + match[0].split('\n').length
            return true
        }
    }
    return false
})

md.renderer.rules.math_inline = (tokens, idx) => {
    return renderLatex(tokens[idx].content, false)
}

md.renderer.rules.math_block = (tokens, idx) => {
    return renderLatex(tokens[idx].content, true)
}

const defaultRender = md.renderer.rules.link_open || function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
}

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const aIndex = tokens[idx].attrIndex('target')
    if (aIndex < 0) {
        tokens[idx].attrPush(['target', '_blank'])
    } else if (tokens[idx].attrs && tokens[idx].attrs[aIndex]) {
        tokens[idx].attrs[aIndex][1] = '_blank'
    }

    const relIndex = tokens[idx].attrIndex('rel')
    if (relIndex < 0) {
        tokens[idx].attrPush(['rel', 'noopener noreferrer'])
    } else if (tokens[idx].attrs && tokens[idx].attrs[relIndex]) {
        tokens[idx].attrs[relIndex][1] = 'noopener noreferrer'
    }

    return defaultRender(tokens, idx, options, env, self)
}

export const renderMarkdown = (content: string): string => {
    return md.render(content)
}

export const renderMarkdownAsync = async (content: string): Promise<string> => {
    if (containsMathSyntax(content)) {
        await ensureKatexModule()
    }
    return md.render(content)
}

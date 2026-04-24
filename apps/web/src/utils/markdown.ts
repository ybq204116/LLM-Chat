import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'
import katex from 'katex'
import { renderMarkdown, setKatexModule } from './markdownCore'

setKatexModule(katex)

export { renderMarkdown }

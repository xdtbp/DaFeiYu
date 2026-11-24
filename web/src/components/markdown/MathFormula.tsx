import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ensureKatex, type Katex } from '../../services/markdown/katex.js'

/** 正文是否仍在流式输出：流式中公式没写完时先占位，不把 LaTeX 原文摊到正文里 */
export const MathStreamingContext = createContext(false)

/** renderToString 外层包裹的标签，组件自己渲染外层，这里切掉 */
const KATEX_WRAPPER = {
  inline: ['<span class="katex">', '</span>'],
  display: ['<span class="katex-display"><span class="katex">', '</span></span>'],
} as const

type MathHtmlResult =
  | { renderMode: 'katex'; html: string }
  /** 流式中公式还没写完：占位，等写完再渲染 */
  | { renderMode: 'pending' }
  /** 流式已结束仍无法渲染：把原文摊开，并标记为源码 */
  | { renderMode: 'raw'; text: string }

const noop = () => {}

/**
 * KaTeX 渲染公式，三种结果：
 * - katex：渲染成功
 * - pending：流式输出中公式还没写完，先占位，避免几秒的源码闪烁
 * - raw：流式结束仍渲染失败，把 LaTeX 原文按源码样式展示
 *
 * 流式中途语法暂时不完整时优先复用上一次成功的结果，公式只会「越写越完整」。
 */
const useMathHtml = (input: string, isInline: boolean): MathHtmlResult => {
  const streaming = useContext(MathStreamingContext)
  // 上一次成功渲染的 innerHTML，流式中途暂时不完整时用它兜底
  const lastHtmlRef = useRef<string | null>(null)
  const katexRef = useRef(ensureKatex())
  const [katex, setKatex] = useState<Katex | null>(
    katexRef.current instanceof Promise ? null : katexRef.current
  )

  useEffect(() => {
    if (katexRef.current instanceof Promise) {
      katexRef.current.then(setKatex, noop)
    }
  }, [])

  return useMemo((): MathHtmlResult => {
    // KaTeX 还在加载：已写完的消息先把原文显示出来，流式中的先占位
    if (!katex) {
      return streaming ? { renderMode: 'pending' } : { renderMode: 'raw', text: input }
    }
    try {
      const [prefix, suffix] = KATEX_WRAPPER[isInline ? 'inline' : 'display']
      const html = katex
        .renderToString(input, { throwOnError: true, strict: false, displayMode: !isInline })
        .slice(prefix.length, -suffix.length)
      lastHtmlRef.current = html
      return { renderMode: 'katex', html }
    } catch {
      if (lastHtmlRef.current !== null) {
        return { renderMode: 'katex', html: lastHtmlRef.current }
      }
      return streaming ? { renderMode: 'pending' } : { renderMode: 'raw', text: input }
    }
  }, [input, isInline, katex, streaming])
}

export const MathBlock = memo(function MathBlock({ value }: { value: string }) {
  const result = useMathHtml(value, false)
  if (result.renderMode === 'pending') {
    // 还没写完：先占位，写完再替换成渲染结果
    return (
      <span className="ds-markdown-math" aria-hidden="true">
        <span className="ds-math-pending-block" />
      </span>
    )
  }
  if (result.renderMode === 'raw') {
    return <p className="ds-markdown-paragraph ds-math-raw">{result.text}</p>
  }
  return (
    <span className="katex-display ds-markdown-math">
      <span className="katex" dangerouslySetInnerHTML={{ __html: result.html }}></span>
    </span>
  )
})

export const InlineMath = memo(function InlineMath({ value }: { value: string }) {
  const result = useMathHtml(value, true)
  if (result.renderMode === 'pending') {
    return <span className="ds-math-pending" aria-hidden="true" />
  }
  if (result.renderMode === 'raw') {
    return <span className="ds-math-raw">{result.text}</span>
  }
  return <span className="katex" dangerouslySetInnerHTML={{ __html: result.html }}></span>
})

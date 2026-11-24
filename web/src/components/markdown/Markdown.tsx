import { memo, useMemo } from 'react'
import type { Source } from '../../services/chat/view.js'
import { toMdAst } from '../../services/markdown/parse.js'
import { splitOpenDisplayMath } from '../../services/markdown/splitOpenMath.js'
import { useScrollToBottom } from '../messages/scrollContext.js'
import { MarkdownAstRenderer } from './MarkdownAstRenderer.js'
import { useThrottleMarkdownRender } from './useThrottleMarkdownRender.js'
import './markdown.css'
import './highlight.css'

/**
 * 渲染链路：节流 → 解析 AST → 渲染。
 * 传入 sources 时把正文里的 [citation:N] 渲染为角标。
 */
export const Markdown = memo(function Markdown({
  content,
  loading,
  cacheKey,
  className,
  disableLink,
  sources,
}: {
  content: string
  loading: boolean
  cacheKey: string
  className?: string
  disableLink: boolean
  sources?: Source[]
}) {
  const scrollToBottom = useScrollToBottom()
  const throttledMarkdown = useThrottleMarkdownRender(content, loading)
  // 末尾没闭合的 $$：流式中先占位，写完再渲染；流式已结束则按源码样式收尾
  const pending = useMemo(() => splitOpenDisplayMath(throttledMarkdown), [throttledMarkdown])
  const ast = useMemo(
    () => (throttledMarkdown ? toMdAst(pending?.head ?? throttledMarkdown, { sources, disableLink }) : null),
    [throttledMarkdown, pending, sources, disableLink]
  )
  return ast ? (
    <MarkdownAstRenderer
      key={cacheKey}
      className={className}
      ast={ast}
      loading={loading}
      onUpdate={scrollToBottom}
      trailing={
        pending ? (
          loading ? (
            <span className="ds-markdown-math" aria-hidden="true">
              <span className="ds-math-pending-block" />
            </span>
          ) : (
            <p className="ds-markdown-paragraph ds-math-raw">{pending.tail}</p>
          )
        ) : null
      }
    />
  ) : null
})

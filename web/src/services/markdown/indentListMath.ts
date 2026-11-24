/**
 * 列表项里以 `$$` 结尾、公式正文却顶格写的块级公式，Markdown 会把正文当成列表外的普通段落，
 * 于是公式变成源码、后面还会被下一个 `$$` 吃掉一大段内容。典型模型输出：
 *
 * ```
 * 1. $$
 * \begin{vmatrix}
 * ...
 * \end{vmatrix}
 * $$
 * ```
 *
 * 这里按列表项的内容列（标记 + 一个空格）给公式正文补缩进，让它留在列表项里。
 * 找不到闭合 `$$` 时原样返回，交给流式占位逻辑处理。
 */
const LIST_MATH_HEAD = /^(\s*)((?:[-*+]|\d{1,9}[.)]))(\s+)\$\$\s*$/
const MATH_FENCE = /^\s*\$\$\s*$/

export const indentListBlockMath = (text: string): string => {
  if (!text.includes('$$')) {
    return text
  }
  const lines = text.split('\n')
  const out: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const head = LIST_MATH_HEAD.exec(line)
    if (!head) {
      out.push(line)
      continue
    }
    const [, lead, marker, gap] = head
    const indent = ' '.repeat(lead.length + marker.length + gap.length)
    // 先确认后面存在闭合的 $$，否则不动，避免把整篇正文都当公式
    let close = -1
    for (let scan = index + 1; scan < lines.length; scan += 1) {
      if (MATH_FENCE.test(lines[scan])) {
        close = scan
        break
      }
    }
    if (close < 0) {
      out.push(line)
      continue
    }
    out.push(line)
    for (let body = index + 1; body <= close; body += 1) {
      const current = lines[body]
      if (current.trim() === '') {
        out.push(current)
      } else if (current.startsWith(indent)) {
        out.push(current)
      } else {
        out.push(indent + current)
      }
    }
    index = close
  }
  return out.join('\n')
}

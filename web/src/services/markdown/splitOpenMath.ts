/** 未闭合块级公式的切分结果：head 正常渲染，tail 是还没写完的部分 */
export type OpenDisplayMath = {
  head: string
  tail: string
}

/** 尾部这段公式最多多长（字符）仍按「正在输出」处理，避免误判把大段正文吞掉 */
const MAX_OPEN_LENGTH = 1500

/** `$$` 之后必须出现 LaTeX 特征才算公式：反斜杠命令、上下标、花括号、对齐符、等号 */
const LATEX_SIGNAL = /\\[a-zA-Z]+|[\^_{}&=<>]/

/** 中文正文（`\text{中文}` 这类带反斜杠的不算） */
const CJK = /[\u4e00-\u9fa5]/

/**
 * 找出正文末尾还没闭合的块级公式（`$$`）。
 *
 * 流式输出里模型刚打出 `$$` 时，Markdown 只能把它当普通文本，整段 LaTeX 会直接
 * 铺在正文里，直到结尾的 `$$` 到达才变成公式。这里把这段未完成的内容切出来，
 * 交给调用方渲染成模糊占位，公式写完自然恢复。
 *
 * 保守起见以下情况一律返回 null（宁可显示原文，也不要吞掉正文）：
 * - `$$` 出现在未闭合的代码块里
 * - 前面已有未闭合的 `$$`（说明这次匹配到的是别的分隔符）
 * - 待定内容里出现代码围栏或长度超过上限
 * - `$$` 后面是一段自然语言（模型在正文里提到分隔符），不是公式
 */
export const splitOpenDisplayMath = (text: string): OpenDisplayMath | null => {
  const open = text.lastIndexOf('$$')
  if (open < 0) {
    return null
  }
  const head = text.slice(0, open)
  const tail = text.slice(open)
  if (!tail.startsWith('$$')) {
    return null
  }
  // 只有一个 `$$` 时说明这是闭合符而不是开头（正文刚好写完一个公式）
  if (tail.length <= 2) {
    return null
  }
  // 后面还有别的 `$$`：这次匹配到的是闭合符，真正的开头在更前面
  if (tail.indexOf('$$', 2) >= 0) {
    return null
  }
  // `$$` 之前必须已经成对出现
  if (((head.match(/\$\$/g) ?? []).length & 1) === 1) {
    return null
  }
  // 落在未闭合的代码块里
  if (((head.match(/```/g) ?? []).length & 1) === 1) {
    return null
  }
  if (tail.length > MAX_OPEN_LENGTH || tail.includes('```')) {
    return null
  }
  // 只有 `$$` 没有内容：还没开始写，不切
  const trimmed = tail.slice(2).trim()
  if (!trimmed) {
    return null
  }
  // 后面既没有 LaTeX 特征、又像自然语言（中文或多个词），说明模型只是在正文里
  // 提到「$$」这两个字符，不能把后面的正文一起模糊掉。
  if (!LATEX_SIGNAL.test(tail.slice(2))) {
    if (CJK.test(trimmed) || trimmed.split(/\s+/).length >= 3) {
      return null
    }
  }
  return { head, tail }
}

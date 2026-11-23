/** 设置项的线性图标：16×16，描边跟随 currentColor，与现有图标风格一致 */

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
} as const

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** 模型：芯片 */
export const IconSettingModel = () => (
  <svg {...base}>
    <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.6" {...stroke} />
    <path d="M6.2 1.4v2.8M9.8 1.4v2.8M6.2 11.8v2.8M9.8 11.8v2.8M1.4 6.2h2.8M1.4 9.8h2.8M11.8 6.2h2.8M11.8 9.8h2.8" {...stroke} />
  </svg>
)

/** 深色设置：月亮 */
export const IconSettingMoon = () => (
  <svg {...base}>
    <path d="M13.4 9.4A5.8 5.8 0 0 1 6.6 2.6a6 6 0 1 0 6.8 6.8Z" {...stroke} />
  </svg>
)

/** 字体大小：Aa */
export const IconSettingFont = () => (
  <svg {...base}>
    <path d="M1.6 12.4 4.7 3.6l3.1 8.8M2.7 9.4h4" {...stroke} />
    <path d="M12.9 12.4V7.9" {...stroke} />
    <path d="M12.9 9.2c1.4-.9 2.5.1 2.5 1.4 0 1.4-1.1 2.4-2.5 1.5" {...stroke} />
  </svg>
)

/** 推理强度：闪电 */
export const IconSettingBolt = () => (
  <svg {...base}>
    <path d="M9.2 1.4 4.1 8.9h3.4L6.8 14.6l5.1-7.5H8.5Z" {...stroke} />
  </svg>
)

/** 最大输出长度：双向箭头 */
export const IconSettingLength = () => (
  <svg {...base}>
    <path d="M2 8h12M2 8l2.6-2.6M2 8l2.6 2.6M14 8l-2.6-2.6M14 8l-2.6 2.6" {...stroke} />
  </svg>
)

/** 思考过程：对话气泡 */
export const IconSettingThinking = () => (
  <svg {...base}>
    <path
      d="M8 2C4.7 2 2 4.2 2 6.9c0 1.6.9 2.9 2.2 3.8v2.6l2.3-1.2c.5.1 1 .2 1.5.2 3.3 0 6-2.1 6-4.9S11.3 2 8 2Z"
      {...stroke}
    />
  </svg>
)

/** 语言：地球 */
export const IconSettingGlobe = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6.2" {...stroke} />
    <path d="M1.8 8h12.4M8 1.8c1.6 1.7 2.5 3.9 2.5 6.2S9.6 12.5 8 14.2c-1.6-1.7-2.5-3.9-2.5-6.2S6.4 3.5 8 1.8Z" {...stroke} />
  </svg>
)

/** 朗读音色：喇叭 */
export const IconSettingSpeaker = () => (
  <svg {...base}>
    <path d="M2.6 6.2h2.6L8.8 3.4v9.2L5.2 9.8H2.6Z" {...stroke} />
    <path d="M11.3 5.5a3.6 3.6 0 0 1 0 5.1" {...stroke} />
  </svg>
)

/** 位置信息：定位针 */
export const IconSettingLocation = () => (
  <svg {...base}>
    <path d="M8 14.2s4.6-4.4 4.6-7.7a4.6 4.6 0 0 0-9.2 0C3.4 9.8 8 14.2 8 14.2Z" {...stroke} />
    <circle cx="8" cy="6.4" r="1.6" {...stroke} />
  </svg>
)

/** 关于软件：信息 */
export const IconSettingInfo = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6.2" {...stroke} />
    <path d="M8 7.4v3.8" {...stroke} />
    <circle cx="8" cy="4.9" r="0.75" fill="currentColor" />
  </svg>
)

/** 充值：钱包 */
export const IconSettingWallet = () => (
  <svg {...base}>
    <path d="M2.2 5.4h11.6v7a1 1 0 0 1-1 1H3.2a1 1 0 0 1-1-1Z" {...stroke} />
    <path d="M2.2 5.4 10.6 2.6a.8.8 0 0 1 1 .5l.4 2.3" {...stroke} />
    <path d="M10.4 9.4h3.4" {...stroke} />
    <circle cx="6" cy="9.4" r="0.7" fill="currentColor" />
  </svg>
)

/** WebView 调试：代码括号 */
export const IconSettingDebug = () => (
  <svg {...base}>
    <path d="M5.6 4.4 2.2 8l3.4 3.6M10.4 4.4 13.8 8l-3.4 3.6" {...stroke} />
  </svg>
)

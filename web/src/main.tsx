// 必须第一个 import：老 WebView 缺的内置方法要在任何业务模块求值之前装好
import './services/compat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { logStartup } from './services/log.js'
import './app/theme.css'
import './app/global.css'

// 尽早装上日志钩子：后面任何一步出错都能被记下来
logStartup()
ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

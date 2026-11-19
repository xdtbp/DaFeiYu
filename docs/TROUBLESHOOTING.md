# 排错手册

## 白屏 / 一直加载

1. 确认 `ds-app/app/src/main/assets/www/index.html` 存在（先执行 `scripts/sync-assets.sh`）。
2. 连接 WebView 调试：`chrome://inspect` 或 `adb forward` 后用 CDP 看控制台报错。
3. 检查 `WebViewAssetLoader` 的路径处理器顺序：`/local/` 必须注册在 `/` 之前，
   否则 `/local/xxx` 会被兜底的 assets 处理器吃掉，返回 404。

## 文件 / 相册 / 拍照点了没反应

Android WebView 的 `<input type="file">` **必须由原生实现 `WebChromeClient.onShowFileChooser`**，
否则点击会被直接丢弃，也不会触发任何权限申请。

如果选择器能打开但多选无效：部分 WebView 版本的 `FileChooserParams.parseResult`
不解析 `ClipData`，多选会返回 `null`。本项目在 `onActivityResult` 里自行收齐
`clipData` 与 `data` 的 URI，可参考 `MainActivity.kt` 的 `REQ_FILE` 分支。

## 麦克风不可用

按错误文案对照：

| 提示 | 含义 | 处理 |
| --- | --- | --- |
| 无法使用麦克风，请在设置中允许访问 | 系统权限被拒 | 系统设置里给应用开启麦克风权限 |
| 未检测到麦克风 | 设备没有音频输入 | 换真机；模拟器需在设置里开启麦克风 |
| 麦克风被占用或暂不可用 | 被其他应用占用，或采集失败 | 关闭其他录音应用后重试 |
| 语音识别失败 | 接口错误 | 检查网络与账号 / API Key |

补充：本项目录音走原生 `AudioRecord`（不依赖 WebView 的 `getUserMedia`）。
若日志显示 `Input device: 0 (AUDIO_DEVICE_NONE)`（`dumpsys audio`），说明设备确实没有输入源，
任何实现都录不到声音。

## 键盘遮住输入框

- 已设置 `SOFT_INPUT_ADJUST_RESIZE`，并用 `WindowInsets` 把 `max(导航栏, 输入法)` 作为底部内边距。
- 模拟器常使用物理键盘而不弹软键盘，属正常现象，需真机验证。

## 状态栏重叠

WebView 会忽略自身 `setPadding`。必须把内边距加在父容器上，让 WebView 尺寸真正收缩。

## 导入历史失败

- 官方导出包格式为 `export_format_version: 3`（`manifest.json` + `user.json` + `chat_sessions/`）。
- 大包（上百兆）由原生 `ACTION_OPEN_DOCUMENT` 选中后复制到私有目录，再由前端通过
  `/local/import.zip` 读取；不要用 `<input type="file">` 直接读，部分机型会读不完整。
- 若提示「文件内容不完整」，通常是复制未完成或存储空间不足。

## 导出历史失败 / 应用崩溃

导出必须分块写入：整包读进内存（`arrayBuffer` + `btoa`）在百兆级历史下会直接 OOM。
本项目按 512KB 分块，由原生写入系统「下载」目录。

## 生成中途切后台被中断

- 已持有 `PARTIAL_WAKE_LOCK` 且 `onPause` 不暂停 WebView。
- 若仍被系统杀死（内存紧张），回前台后会自动续写一次。

## 侧边栏卡顿

会话列表默认增量渲染（首屏 40 条，滚动继续追加）。若改回全量渲染，上千条会话会拖慢抽屉动画。

## 左右滑动误触

滑动判定会跳过：输入框、横向可滚区域（长公式 / 宽表格 / 代码块）、图片编辑器，
以及带 `data-ds-no-swipe` 标记的元素。新增横向滚动组件时记得加上该标记或保证 `overflow-x` 可滚动。

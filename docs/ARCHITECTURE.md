# 架构说明

## 总体思路

不做「纯原生聊天界面」，而是把 **DeepSeek 官方前端（chat-demo）** 打进 APK，用 WebView 加载，
再通过一组原生桥补齐 Web 做不到的能力（相机、相册、文件、录音、账号登录、下载、保活）。

这样做的好处：

- 复用官方前端的完整功能与设计语言，避免重写流式渲染、Markdown、公式、工具调用等复杂逻辑；
- UI 改动集中在前端，迭代成本低；
- 原生层只保留「桥」，代码量小、边界清晰。

代价是：WebView 的能力边界（文件选择、麦克风、下载）必须逐项打通，否则按钮会「点了没反应」。

## 分层

### 1. 原生壳 `ds-app`

| 文件 | 职责 |
| --- | --- |
| `MainActivity.kt` | WebView 初始化、资源加载器、内边距适配、权限、文件选择、下载、相册/录音/电源桥 |
| `DshAuth.kt` | Harness 账号 OAuth：`auth_init` → 浏览器授权 → 本机回环收 code → `auth_exchange` → 拉资料与余额 |

关键实现点：

- **资源加载**：`WebViewAssetLoader` 把 `/` 映射到 `assets/www`，把 `/local/` 映射到应用私有目录
  （用于导入包与录音文件）。注册顺序很重要：`/local/` 必须在 `/` 之前，否则会被兜底处理器吃掉。
- **尺寸适配**：WebView 会忽略自身的 `setPadding`，因此把系统栏/输入法内边距加在父容器上，
  让 WebView 的实际尺寸收缩，页面按 100% 高度重排，输入框自然上移。
- **文件选择**：实现 `WebChromeClient.onShowFileChooser`，自行构造 `ACTION_OPEN_DOCUMENT`
  并支持多选；**不能直接用 `FileChooserParams.parseResult`**，部分 WebView 版本不解析
  `ClipData`，多选会返回 null，表现为「选了没反应」。
- **录音**：`AudioRecord` 采 16kHz 单声道 PCM，停止时补 WAV 头写入私有目录，
  前端用 `/local/voice.wav` 取回。相比 WebView 的 `getUserMedia`，不受 WebRTC 采集限制。
- **保活**：流式生成期间持有 `PARTIAL_WAKE_LOCK`，`onPause` 不暂停 WebView；回前台后若上一条
  回复因网络中断，前端会自动续写一次。

### 2. 前端 `web`

```
src/
├── app/                 应用外壳：布局、主题、手势、视口
├── components/
│   ├── chatInput/       输入框、附件面板、语音、图片编辑器
│   ├── messages/        消息渲染、操作栏、用量
│   ├── sider/           侧边栏、搜索、账号卡片
│   ├── settings/        设置弹窗、余额卡片、导入导出
│   └── markdown/        Markdown / 公式 / 代码
├── services/
│   ├── api/             接口客户端（鉴权头、流式解析、ASR/TTS）
│   ├── chat/            会话存储（IndexedDB）、草稿、导入导出
│   ├── speech/          网页录音与原生录音适配
│   └── account.ts       Harness 账号状态
└── i18n/                中文 / 英文
```

关键实现点：

- **鉴权**：`services/api/auth.ts` 统一出鉴权头。API Key 走 `x-api-key` / `Authorization`；
  Harness 账号走 `x-dsh-auth-token`。两条通道对 `/anthropic/v1/messages`、`/v1/tools/*`、
  `/user/balance` 都可用，因此「登录即用」不需要填 Key。
- **请求参数**：推理强度用 `output_config.effort`（`none/low/high/max`），
  输出上限用 `max_tokens`（含思考 token）。
- **手势**：侧边栏左右滑动前会判断目标是否属于横向可滚区域（长公式、宽表格、代码块、图片编辑器），
  命中则不抢手势；设置页也支持左右滑动切换分组。
- **导入导出**：导入时逐条容错并回报进度；导出按 512KB 分块 base64 交给原生写入，
  避免整包读入内存导致 OOM。
- **图片编辑**：笔画以矢量保存（颜色/粗细/点序列），撤销重做只重绘；
  第二根手指落下立即结束当前笔画，避免两指之间连出直线。

## 数据流

```
用户输入 → 草稿（state）→ 附件上传（attachments 服务）→ 组装请求
        → streamMessage / streamChatCompletions → 逐帧解析 → 增量渲染
        → 落库 IndexedDB（会话、消息、用量）
```

- 草稿与会话都按 `sessionId` 隔离，切换会话不丢输入。
- 消息落库是增量的，长回答流式过程中也会持续保存，退后台/重启后不丢。

## 安全与隐私

- API Key 与账号令牌只保存在设备本地（前端存储 + 原生 SharedPreferences），不上传到第三方。
- 账号登录使用 PKCE + 本机回环回调，令牌不经过外部服务器。
- 应用不收集任何遥测数据。

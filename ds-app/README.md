# DeepSeek Chat（DS Chat）

基于 DeepSeek 官方 API 的原生安卓 AI 聊天应用。采用 **WebView 路线**：复用 DeepSeek 官方开源的 chat-demo 前端
（自带 DS 官方设计语言与移动端布局），用原生 WebView 壳打包成 APK，并补齐原生能力与账号功能。

## 项目结构

```
├── web/          # 前端：DeepSeek 官方 chat-demo（React + rspack）+ 本项目扩展
│   └── src/
│       ├── components/settings/BalanceCard.tsx   # API Key 余额卡片
│       ├── components/sider/AccountFooter.tsx    # 侧边栏底部账号（头像/昵称/余额）
│       ├── components/chatInput/ImageEditor.tsx  # 拍照后圈画标注
│       └── services/account.ts                   # Harness 账号状态
└── ds-app/       # 原生 WebView 壳（Android 工程）
    └── app/src/main/
        ├── assets/www/                 # chat-demo 构建产物 dist/
        ├── java/.../MainActivity.kt    # WebView、系统栏/输入法内边距、文件选择、主题、下载
        └── java/.../DshAuth.kt         # DeepSeek Harness OAuth 登录 + 资料/余额
```

## 构建

### 1. 前端（web/）

```bash
cd web
corepack pnpm install
# Windows 下用 Git Bash 直接调 rspack，避免 NODE_ENV=production 的 cmd 兼容问题：
rm -rf dist && NODE_ENV=production node node_modules/@rspack/cli/bin/rspack.js build -c rspack.config.ts
```

### 2. 同步前端产物到壳

```bash
cd ds-app
rm -rf app/src/main/assets/www
cp -r ../web/dist app/src/main/assets/www
```

### 3. 打包 APK

环境要求：JDK 17、Android SDK（compileSdk 37，本机位于 `D:\Android\Sdk`）。

```bash
export ANDROID_HOME=/d/Android/Sdk
./gradlew assembleDebug        # 产物 app/build/outputs/apk/debug/app-debug.apk
```

> 注意：本机 SDK 的 platform 目录名为 `android-37.0`（非标准），已复制一份为 `android-37` 供 AGP 识别；
> Gradle wrapper 已指向腾讯云镜像加速下载。

## 原生壳负责的部分（WebView 做不到的）

| 能力 | 说明 |
|---|---|
| 系统栏 / 输入法内边距 | `WindowCompat.setDecorFitsSystemWindows(false)` + `WindowInsets`（systemBars ∪ ime）加在**父容器**上；WebView 自身 padding 不生效，必须由容器限制实际尺寸，视口才会真正收缩，输入框才会被顶到键盘上方 |
| 文件 / 相机 / 相册 | `WebChromeClient.onShowFileChooser` + FileProvider 全尺寸拍照 + 运行时权限（缺这段则点击完全无反应） |
| 返回键 | 先调 `window.__dsHandleBack()`（关图片预览 → 关设置 → 关侧边栏 → 关搜索面板），未处理才退出 |
| 字号缩放 | 设置里的字号 → `WebView.settings.textZoom`，只放大文字不缩放布局（用 CSS zoom 会让 100% 高度溢出、底部被裁掉） |
| 主题同步 | 前端把 `--dsw-alias-bg-base` 算出的颜色回传原生，设置状态栏/导航栏底色与图标明暗 |
| 最近照片 | `MediaStore` 查询 + 缩略图 data URI，供输入框快捷面板首屏预览 |
| 导入历史 | 原生 `ACTION_OPEN_DOCUMENT` 选包 → 复制到 `files/shared/import.zip` → 通过 `/local/` 前缀用 fetch 读回普通 Blob（绕开 WebView 读 content:// 大文件不完整的问题，响应带 `no-store` 且 URL 带时间戳防缓存） |
| 导出历史 | `blob:` 下载转 base64 **分块**写入系统「下载」目录（整包读成数组会 OOM） |
| Harness 登录 | OAuth PKCE + 本机回环回调 + `x-dsh-auth-token` 拉头像昵称与余额 |

## 功能

- 多会话、流式对话、深度思考、联网搜索、附件、语音、Markdown/KaTeX/Mermaid
- 浅色/深色/跟随系统、中英双语、字体大小、推理强度、最大输出长度
- 侧边栏搜索历史（区分「我 / AI」）、余额卡片、用量 token 显示
- 侧边栏会话列表增量渲染（首屏 40 条，滚动继续追加），上千条历史也不卡
- 默认折叠思考过程（设置里可切换「折叠 / 展开」）
- 拍照 / 相册 / 文件快捷面板（相册支持多选、选中即上传）+ 附件大图预览与就地编辑 + 全屏圈画标注（主题底色、顶部撤销重做裁切、双指缩放平移、右下角确认）
- **Harness 账号登录**：侧边栏底部显示头像、昵称、余额（¥ / $ + 赠送额度）
- 历史导入（容错：单条不兼容只跳过该条）/ 导出到「下载」

## 使用

1. 安装 APK，进入「设置 → 数据管理」填入 DeepSeek 开放平台 API Key 并保存（聊天用）。
2. 想查看账号余额，点侧边栏底部的「登录」，在浏览器完成 DeepSeek Harness 授权后自动回到应用。
3. 导入历史：设置 → 数据管理 → 上传，选择官方导出的 `deepseek_data-*.zip`。

## API 说明

- 聊天：`POST https://api.deepseek.com/anthropic/v1/messages`（`x-api-key`，SSE）
- API Key 余额：`GET https://api.deepseek.com/user/balance`
- Harness 登录：`POST https://platform.deepseek.com/auth-api/v0/dsh/auth_init` / `auth_exchange`
- Harness 资料与余额：`GET /auth-api/v0/users/current`、`GET /api/v0/users/get_user_summary`（`x-dsh-auth-token`）

> 平台对非浏览器 UA 会直接返回 WAF 拦截页，原生请求已带移动端 Chrome UA。

## 已知限制

- 账号 token 仅用于展示资料与余额，聊天仍走 API Key（官方未开放账号态直接推理的公开接口）。
- 超大历史（十万级条目 + 上百 MB 图片）在低内存设备上导出仍可能失败，导入不受影响。
- release 签名打包需要自己的 keystore。

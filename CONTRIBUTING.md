# 贡献指南

感谢你愿意改进这个项目。提交前请先读一遍下面几条。

## 开发环境

- Node.js 22+（前端）
- JDK 17 + Android SDK（安卓壳）
- 建议使用 Android Studio 打开 `ds-app/`，前端用 VS Code / WebStorm 打开 `web/`

## 本地联调

```bash
# 终端 1：前端热更新（浏览器里调 UI 最快）
cd web && corepack pnpm dev

# 终端 2：改完前端后同步到安卓工程并装到设备
bash scripts/sync-assets.sh
cd ds-app && ./gradlew installDebug
```

调 WebView 内的页面：

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
# 然后浏览器打开 http://localhost:9222 或 chrome://inspect
```

`<pid>` 可通过 `adb shell cat /proc/net/unix | grep webview_devtools` 获取。

## 代码约定

- 前端 TypeScript 严格模式，提交前跑 `corepack pnpm type`。
- 新增用户可见文案必须同时补 `src/i18n/zh.ts` 与 `src/i18n/en.ts`（类型会强制检查）。
- 样式只写在对应组件的 `*.module.css`，不要引入全局样式；主题色使用 `--dsw-*` / `--ds-*` 变量。
- 原生桥方法统一放在 `MainActivity` 的 `inner class XxxBridge` 中，并用 `@JavascriptInterface` 标注。
- 涉及手势的地方，请遵守「横向可滚区域不抢手势」的约定，必要时给元素加 `data-ds-no-swipe`。

## 提交信息

使用 Conventional Commits：

```
feat(editor): 支持裁切
fix(voice): 修复模拟器无麦克风时的崩溃
docs: 补充构建说明
```

## Pull Request

- 一个 PR 只做一件事，附上「改了什么 / 为什么 / 怎么验证」。
- UI 改动请附截图或录屏。
- 涉及原生的改动请说明测试机型与 Android 版本。

## 不要提交

- 任何 API Key、账号令牌、keystore
- `web/node_modules`、`web/dist`、`ds-app/build`、`assets/www`
- 从官方 App 提取的素材（图标、字体等），除非你确认版权可用

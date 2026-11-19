# 第三方组件与来源说明

本项目在实现过程中使用了以下第三方代码或服务，特此说明来源与许可。

## 前端基础

- **DeepSeek chat-demo**（`web/`）
  - 来源：DeepSeek 官方开源的静态聊天示例
  - 许可：MIT License，Copyright © 2026 DeepSeek
  - 说明：本项目在其基础上增加了移动端布局调整、圈画标注、账号通道、余额与用量展示、
    历史导入导出的容错与进度、设置项扩充等改动。原始许可证保留在 `web/LICENSE`。

## 前端依赖（节选）

| 依赖 | 用途 | 许可 |
| --- | --- | --- |
| React / React DOM | UI 框架 | MIT |
| rspack | 构建工具 | MIT |
| zustand | 轻量状态管理 | MIT |
| idb | IndexedDB 封装 | ISC |
| fflate | ZIP 读写 | MIT |
| katex | 数学公式渲染 | MIT |
| mermaid | 图表渲染 | MIT |
| prismjs | 代码高亮 | MIT |

完整依赖与版本见 `web/package.json` 与 `web/pnpm-lock.yaml`。

## 安卓侧

- AndroidX、Kotlin 标准库、Gradle 等均遵循各自的开源许可。
- 应用图标由项目维护者自行提供，发布前请确认素材版权。

## 服务与商标

- 「DeepSeek」及相关名称为其权利人的商标。
- 本项目通过 `api.deepseek.com` 与 `platform.deepseek.com` 提供的接口工作，
  与 DeepSeek 官方无隶属或背书关系。

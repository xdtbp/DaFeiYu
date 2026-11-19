# 构建与打包

## 环境要求

| 组件 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | 22+ | 前端构建 |
| pnpm | 通过 corepack | 无需全局安装 |
| JDK | 17 | Gradle 与 AGP 要求 |
| Android SDK | Platform 37 + Build-Tools 36 | 见下方说明 |
| Gradle | 8.14.x | 仓库自带 wrapper |

> **关于 compileSdk**：`ds-app/app/build.gradle.kts` 默认 `compileSdk = 37`、`targetSdk = 37`。
> 如果你的 SDK 里只有 36，把两者改成 36 即可（AGP 8.13 支持）。

## 一、构建前端

```bash
cd web
corepack pnpm install
corepack pnpm build
```

产物在 `web/dist/`。

### Windows 注意事项

`package.json` 的 build 脚本使用了 `NODE_ENV=production` 前缀，在 cmd/PowerShell 下会失败。
在 **Git Bash** 中直接调用 rspack：

```bash
cd web
NODE_ENV=production node node_modules/@rspack/cli/bin/rspack.js build -c rspack.config.ts
```

## 二、同步资源到安卓工程

```bash
bash scripts/sync-assets.sh
```

该脚本会把 `web/dist/` 复制到 `ds-app/app/src/main/assets/www/`，构建 APK 时被打进包内。
这个目录**不提交**（见 `.gitignore`）。

## 三、构建 APK

```bash
export ANDROID_HOME=/path/to/Android/Sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME

cd ds-app
./gradlew assembleDebug
```

产物：`ds-app/app/build/outputs/apk/debug/app-debug.apk`

### 国内网络

Gradle 发行包默认从 `services.gradle.org` 下载，国内可能很慢。可修改
`ds-app/gradle/wrapper/gradle-wrapper.properties`：

```properties
distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-bin.zip
```

### SDK 目录名不匹配

个别 SDK 安装器会把平台目录命名为 `android-37.0`，而 AGP 查找的是 `android-37`，
表现为 `Failed to find target 'android-37'`。复制一份标准命名即可：

```bash
cp -r "$ANDROID_HOME/platforms/android-37.0" "$ANDROID_HOME/platforms/android-37"
```

## 四、签名发布

1. 生成 keystore：

```bash
keytool -genkeypair -v -keystore release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias app
```

2. 在 `ds-app/app/build.gradle.kts` 中加入签名配置（示例）：

```kotlin
android {
    signingConfigs {
        create("release") {
            storeFile = file("../release.jks")
            storePassword = System.getenv("KS_PASS")
            keyAlias = "app"
            keyPassword = System.getenv("KEY_PASS")
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
}
```

3. 构建：

```bash
KS_PASS=xxx KEY_PASS=xxx ./gradlew assembleRelease
```

> 不要把 keystore 与密码提交到仓库；`.gitignore` 已排除 `*.jks`、`*.keystore`。

## 五、常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `Failed to find target 'android-37'` | SDK 平台目录名不是 `android-37`，见上文 |
| 构建时下载依赖卡住 | 配置国内镜像，或使用代理 |
| APK 打开白屏 | 未同步 `assets/www`，或 `WebViewAssetLoader` 路径被兜底处理器抢占 |
| 打包后 APK 很大 | 正常在 5MB 左右（含前端资源），若异常检查是否把 `node_modules` 打进去 |

更多运行时问题见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md)。

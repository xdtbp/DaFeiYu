package com.dschat.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * WebView 壳：加载打包在 assets/www 的 chat-demo 前端，
 * 并补齐 WebView 缺失的原生能力：
 *  - 系统栏 / 输入法内边距（内容不进入状态栏，输入框跟随键盘上移）
 *  - 文件、相机、相册选择与运行时权限
 *  - 返回键回退（先关网页弹层，再退出）
 *  - Harness 账号登录（OAuth PKCE + 头像昵称余额）
 *  - 字号缩放（WebView textZoom）与主题色同步
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var rootView: android.widget.FrameLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    /** 等待系统麦克风权限结果的网页授权请求 */
    private var pendingMicRequest: PermissionRequest? = null

    /** 引导页逐项申请时，记录当前等待结果的权限名 */
    private var pendingAppPermission: String? = null

    /** 防止返回被连点触发两次 finish */
    @Volatile
    private var backPending = false

    /** 原生录音（AudioRecord）：不依赖 WebView 的 getUserMedia，真机更稳 */
    private var audioRecord: android.media.AudioRecord? = null
    private var recordThread: Thread? = null
    private var recordPcm: File? = null
    @Volatile
    private var recording = false
    private var recordStartedAt = 0L
    private var cameraPhotoUri: Uri? = null
    private var cameraPhotoFile: File? = null
    private lateinit var auth: DshAuth
    private var lastImeBottom = -1

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // WebView 调试默认关闭，由「设置 → 关于软件 → WebView 调试」显式打开
        WebView.setWebContentsDebuggingEnabled(
            getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_WEBVIEW_DEBUG, false),
        )

        // 自己处理系统栏与输入法内边距，保证内容不会被状态栏或键盘遮挡
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)

        webView = WebView(this)
        webView.setBackgroundColor(Color.WHITE)
        // WebView 的渲染表面会忽略自身 padding，必须由父容器限制它的实际尺寸，
        // 视口才会真正收缩（状态栏、输入法都是靠这个避让的）。
        val root = android.widget.FrameLayout(this)
        root.setBackgroundColor(Color.WHITE)
        rootView = root
        root.addView(
            webView,
            android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)

        applyWindowInsets(root)

        auth = DshAuth(
            this,
            { json -> emitAuth(json) },
            { url ->
                runOnUiThread {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: Exception) {
                    }
                }
            },
        )

        webView.addJavascriptInterface(MediaBridge(), "AndroidMedia")
        webView.addJavascriptInterface(ThemeBridge(), "AndroidTheme")
        webView.addJavascriptInterface(AuthBridge(), "AndroidAuth")
        webView.addJavascriptInterface(FileBridge(), "AndroidFile")
        webView.addJavascriptInterface(PowerBridge(), "AndroidPower")
        webView.addJavascriptInterface(VoiceBridge(), "AndroidVoice")
        webView.addJavascriptInterface(AppBridge(), "AndroidApp")
        normalizeLauncher()

        // 注意顺序：路径前缀按注册顺序匹配，"/local/" 必须排在兜底的 "/" 之前
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/local/", SharedFileHandler())
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            javaScriptCanOpenWindowsAutomatically = false
            useWideViewPort = true
            loadWithOverviewMode = false
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                // 站内资源自己处理，外链交给系统浏览器，避免把 App 变成通用浏览器
                if (url.host == "appassets.androidplatform.net") {
                    return false
                }
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (_: Exception) {
                    true
                }
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                // 让前端启动时立刻拿到已缓存的账号信息
                view.evaluateJavascript(
                    "window.__dshAuth && window.__dshAuth(${auth.cached()})",
                    null
                )
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: WebChromeClient.FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = filePathCallback
                return try {
                    if (fileChooserParams.isCaptureEnabled && needsCamera()) {
                        // 拍照：系统相机 + FileProvider 输出全尺寸原图
                        val photo = createPhotoFile()
                        cameraPhotoFile = photo
                        cameraPhotoUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "$packageName.fileprovider",
                            photo,
                        )
                        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                            putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri)
                            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                        }
                        startActivityForResult(intent, REQ_CAMERA)
                    } else {
                        // 自己构造文档选择器：ACTION_GET_CONTENT 在部分机型上不接受多选，
                        // ACTION_OPEN_DOCUMENT + EXTRA_ALLOW_MULTIPLE 才能稳定多选
                        startActivityForResult(buildFilePickerIntent(fileChooserParams), REQ_FILE)
                    }
                    true
                } catch (e: Exception) {
                    fileCallback = null
                    false
                }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                val wantsMic = request.resources.any { it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
                if (wantsMic &&
                    ContextCompat.checkSelfPermission(
                        this@MainActivity,
                        Manifest.permission.RECORD_AUDIO
                    ) != PackageManager.PERMISSION_GRANTED
                ) {
                    // 先申请系统录音权限，用户同意后再放行网页的 getUserMedia
                    pendingMicRequest?.deny()
                    pendingMicRequest = request
                    ActivityCompat.requestPermissions(
                        this@MainActivity,
                        arrayOf(Manifest.permission.RECORD_AUDIO),
                        REQ_MIC
                    )
                    return
                }
                request.grant(request.resources)
            }
        }

        // 预测式返回：API 33+ 必须走 OnBackInvokedCallback，否则 onBackPressed 不会被调用
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                android.window.OnBackInvokedCallback { dispatchBack() },
            )
        }

        webView.loadUrl("https://appassets.androidplatform.net/www/index.html")

        // 「导出历史」是 blob: 下载，WebView 自己不会处理，需要转成 base64 交给原生保存。
        // 必须分块传输：整包读成数组在百兆级历史上会直接把渲染进程 OOM 掉。
        webView.setDownloadListener { url, _, contentDisposition, _, _ ->
            if (url.startsWith("blob:")) {
                val name = org.json.JSONObject.quote(guessFileName(contentDisposition))
                val target = org.json.JSONObject.quote(url)
                webView.evaluateJavascript(
                    "(async()=>{try{" +
                        "const blob=await (await fetch($target)).blob();" +
                        "if(!AndroidFile.begin($name)){return;}" +
                        "const CH=512*1024;" +
                        "for(let i=0;i<blob.size;i+=CH){" +
                        "const buf=new Uint8Array(await blob.slice(i,i+CH).arrayBuffer());" +
                        "let s='';for(let j=0;j<buf.length;j+=0x8000){" +
                        "s+=String.fromCharCode.apply(null,buf.subarray(j,j+0x8000));}" +
                        "AndroidFile.append(btoa(s));}" +
                        "AndroidFile.end();" +
                        "}catch(e){AndroidFile.abort();}})()",
                    null
                )
            }
        }

    }

    /**
     * 统一桌面入口：只保留 LauncherDafeiyu（官方图标 + DeepSeek 名称），
     * 关闭历史别名 LauncherOfficial。旧版本升级上来时可能残留启用的别名，这里兜底一次。
     */
    private fun normalizeLauncher() {
        try {
            val pm = packageManager
            val keep = android.content.ComponentName(this, "$packageName.LauncherDafeiyu")
            val legacy = android.content.ComponentName(this, "$packageName.LauncherOfficial")
            pm.setComponentEnabledSetting(
                keep,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                android.content.pm.PackageManager.DONT_KILL_APP,
            )
            pm.setComponentEnabledSetting(
                legacy,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                android.content.pm.PackageManager.DONT_KILL_APP,
            )
        } catch (_: Exception) {
        }
    }

    /** 引导页申请的三类权限映射到系统权限名 */
    private fun permissionOf(name: String): String? = when (name) {
        "mic" -> Manifest.permission.RECORD_AUDIO
        "camera" -> Manifest.permission.CAMERA
        "media" -> if (android.os.Build.VERSION.SDK_INT >= 33) {
            Manifest.permission.READ_MEDIA_IMAGES
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        else -> null
    }

    /**
     * 内容区 = 窗口 - 状态栏/刘海 - max(导航栏, 输入法)。
     * 内边距加在父容器上，WebView 尺寸随之变化，页面按 100% 高度布局，
     * 输入框自然被顶到键盘上方。
     */
    private fun applyWindowInsets(root: android.view.ViewGroup) {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = maxOf(bars.bottom, ime.bottom)
            view.setPadding(bars.left, bars.top, bars.right, bottom)
            if (ime.bottom != lastImeBottom) {
                lastImeBottom = ime.bottom
                val density = resources.displayMetrics.density
                val cssPx = if (density > 0) ime.bottom / density else 0f
                webView.post {
                    webView.evaluateJavascript(
                        "window.__dsIme && window.__dsIme($cssPx)",
                        null
                    )
                }
            }
            insets
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun emitAuth(json: String) {
        runOnUiThread {
            webView.evaluateJavascript("window.__dshAuth && window.__dshAuth($json)", null)
            if (json.contains("\"signed-in\"")) {
                // 浏览器里完成授权后把应用拉回前台
                try {
                    startActivity(
                        Intent(this, MainActivity::class.java).addFlags(
                            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_NEW_TASK
                        )
                    )
                } catch (_: Exception) {
                }
            }
        }
    }

    private fun needsCamera() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    /** 依据页面的 accept / multiple 构造系统文档选择器 */
    private fun buildFilePickerIntent(params: WebChromeClient.FileChooserParams): Intent {
        val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val accepts = params.acceptTypes.filter { it.isNotBlank() }
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            // 单一 MIME（如 image/*）直接作为 type；扩展名列表交给 EXTRA_MIME_TYPES，兜底 */*
            type = if (accepts.size == 1 && accepts[0].contains('/')) accepts[0] else "*/*"
            if (accepts.isNotEmpty()) {
                putExtra(Intent.EXTRA_MIME_TYPES, accepts.toTypedArray())
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun createPhotoFile(): File {
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        return File.createTempFile("capture_", ".jpg", dir)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_APP_PERMISSION) {
            val name = pendingAppPermission
            pendingAppPermission = null
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (name != null) {
                webView.post {
                    webView.evaluateJavascript(
                        "window.__dsPermission && window.__dsPermission('$name', $granted)",
                        null
                    )
                }
            }
            return
        }
        if (requestCode == REQ_MIC) {
            val request = pendingMicRequest
            pendingMicRequest = null
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            if (request == null) {
                return
            }
            runOnUiThread {
                if (granted) {
                    request.grant(request.resources)
                } else {
                    request.deny()
                }
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
            REQ_FILE -> {
                // 不能用 FileChooserParams.parseResult：部分 WebView 版本只读 data 里的单个 URI，
                // 多选时 data.getData() 为 null，会被判成“用户取消”。这里自己收齐 ClipData。
                val uris = mutableListOf<Uri>()
                if (resultCode == RESULT_OK && data != null) {
                    data.clipData?.let { clip ->
                        for (index in 0 until clip.itemCount) {
                            uris.add(clip.getItemAt(index).uri)
                        }
                    }
                    // 单选时只有 data.data
                    if (uris.isEmpty()) {
                        data.data?.let { uris.add(it) }
                    }
                }
                fileCallback?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
                fileCallback = null
            }

            REQ_PICK_ARCHIVE -> {
                val uri = data?.data
                if (resultCode == RESULT_OK && uri != null) {
                    importArchiveFromUri(uri)
                } else {
                    archiveState = org.json.JSONObject().put("state", "cancelled").toString()
                    emitJs("window.__dsArchiveBusy && window.__dsArchiveBusy(false)")
                }
            }

            REQ_CAMERA -> {
                val uri = cameraPhotoUri
                if (resultCode == RESULT_OK && uri != null) {
                    fileCallback?.onReceiveValue(arrayOf(uri))
                } else {
                    cameraPhotoFile?.delete()
                    fileCallback?.onReceiveValue(null)
                }
                fileCallback = null
                cameraPhotoUri = null
                cameraPhotoFile = null
            }
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    /** 返回键：先让网页处理（关弹窗/侧边栏/图片预览），网页未处理时才退出 */
    @Deprecated("Deprecated in Java")
    /**
     * 统一的返回分发：先交给前端逐级关闭浮层（预览 / 编辑器 / 面板 / 设置 / 侧边栏 / 搜索），
     * 前端返回 false 才真正退出。
     *
     * Android 13+ 的预测式返回不会走 onBackPressed（targetSdk 较新时尤其明显），
     * 因此额外注册 OnBackInvokedCallback，否则会出现「浮层里一返回就杀进程」。
     */
    private fun dispatchBack() {
        if (backPending) {
            return
        }
        backPending = true
        webView.evaluateJavascript(
            "(function(){try{return window.__dsHandleBack?window.__dsHandleBack():false}catch(e){return false}})()"
        ) { result ->
            backPending = false
            // evaluateJavascript 返回 JSON，true 是 "true"，false/null 都要退出
            if (result?.trim()?.trim('"') != "true") {
                finish()
            }
        }
    }

    @Deprecated("Android 13 起由 OnBackInvokedCallback 接管")
    override fun onBackPressed() {
        dispatchBack()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        ViewCompat.requestApplyInsets(webView)
    }

    /** 系统深色模式切换时通知网页，避免 Activity 重建（manifest 里已声明 uiMode） */
    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        if (!::webView.isInitialized) {
            return
        }
        val dark =
            newConfig.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK ==
                android.content.res.Configuration.UI_MODE_NIGHT_YES
        webView.evaluateJavascript(
            "window.__dsSystemDarkChange && window.__dsSystemDarkChange($dark)",
            null
        )
    }

    override fun onPause() {
        // 不调用 webView.onPause()：生成中的流要留在后台继续跑
        super.onPause()
    }

    override fun onDestroy() {
        auth.cancel()
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    /** 主题与字号：由网页在切换主题 / 字号时调用，保证状态栏与内容背景一致 */
    inner class ThemeBridge {
        /** 系统当前是否为深色模式，供网页的「跟随系统」读取 */
        @android.webkit.JavascriptInterface
        fun isSystemDark(): Boolean {
            val night =
                resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK
            return night == android.content.res.Configuration.UI_MODE_NIGHT_YES
        }

        @android.webkit.JavascriptInterface
        fun applyTheme(background: String, dark: Boolean) {
            runOnUiThread {
                val color = try {
                    Color.parseColor(background)
                } catch (_: Exception) {
                    if (dark) Color.parseColor("#171717") else Color.WHITE
                }
                window.setBackgroundDrawable(ColorDrawable(color))
                webView.setBackgroundColor(color)
                if (::rootView.isInitialized) rootView.setBackgroundColor(color)
                window.statusBarColor = Color.TRANSPARENT
                window.navigationBarColor = Color.TRANSPARENT
                val controller = WindowCompat.getInsetsController(window, window.decorView)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }
        }

        /** 字号缩放用 WebView 原生 textZoom，只放大文字，不缩放布局，避免底部被裁切 */
        @android.webkit.JavascriptInterface
        fun setTextZoom(percent: Int) {
            runOnUiThread {
                webView.settings.textZoom = percent.coerceIn(60, 200)
            }
        }
    }

    /** 应用元信息：版本号等，供「关于软件」展示 */
    inner class AppBridge {
        @android.webkit.JavascriptInterface
        fun version(): String = try {
            packageManager.getPackageInfo(packageName, 0).versionName ?: "0.0.0"
        } catch (_: Exception) {
            "0.0.0"
        }

        /** WebView 调试当前是否开启 */
        @android.webkit.JavascriptInterface
        fun webviewDebugEnabled(): Boolean =
            getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(KEY_WEBVIEW_DEBUG, false)

        /**
         * 切换 WebView 调试：写入偏好并立即生效。
         * 调试会暴露页面内容与网络请求，默认关闭。
         */
        @android.webkit.JavascriptInterface
        fun setWebviewDebug(enabled: Boolean): Boolean {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_WEBVIEW_DEBUG, enabled)
                .apply()
            runOnUiThread {
                WebView.setWebContentsDebuggingEnabled(enabled)
            }
            return enabled
        }

        /** 不同意免责声明时退出应用 */
        @android.webkit.JavascriptInterface
        fun exitApp() {
            runOnUiThread {
                finishAffinity()
            }
        }

        /** 逐项申请运行时权限（引导页使用）：mic / camera / media */
        @android.webkit.JavascriptInterface
        fun requestPermission(name: String) {
            val permission = permissionOf(name) ?: return
            pendingAppPermission = name
            runOnUiThread {
                androidx.core.app.ActivityCompat.requestPermissions(
                    this@MainActivity,
                    arrayOf(permission),
                    REQ_APP_PERMISSION,
                )
            }
        }

        /** 查询某项运行时权限当前状态：granted / denied */
        @android.webkit.JavascriptInterface
        fun permissionState(name: String): String {
            val permission = permissionOf(name) ?: return "granted"
            val granted = androidx.core.content.ContextCompat.checkSelfPermission(
                this@MainActivity,
                permission,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            return if (granted) "granted" else "denied"
        }

    }

    /** Harness 账号：登录 / 刷新 / 退出 */
    inner class AuthBridge {
        @android.webkit.JavascriptInterface
        fun cached(): String = auth.cached()

        /** 账号通道对话时，前端需要用它代替 API Key（x-dsh-auth-token） */
        @android.webkit.JavascriptInterface
        fun token(): String = auth.token()

        @android.webkit.JavascriptInterface
        fun signIn() {
            auth.signIn()
        }

        @android.webkit.JavascriptInterface
        fun refresh() {
            auth.refresh()
        }

        @android.webkit.JavascriptInterface
        fun signOut() {
            auth.signOut()
        }
    }

    /** 生成期间的唤醒锁：退到后台时保持网络与 CPU，避免回答被系统中断 */
    inner class PowerBridge {
        @android.webkit.JavascriptInterface
        fun begin() {
            runOnUiThread {
                try {
                    if (wakeLock == null) {
                        val power = getSystemService(POWER_SERVICE) as android.os.PowerManager
                        wakeLock = power.newWakeLock(
                            android.os.PowerManager.PARTIAL_WAKE_LOCK,
                            "dschat:stream"
                        ).apply { acquire(10 * 60 * 1000L) }
                    }
                } catch (_: Exception) {
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun end() {
            runOnUiThread {
                try {
                    wakeLock?.takeIf { it.isHeld }?.release()
                } catch (_: Exception) {
                }
                wakeLock = null
            }
        }
    }

    /** 保存网页生成的下载文件（历史记录 ZIP）到系统「下载」目录，按块写入以控制内存 */
    inner class FileBridge {
        /** 把网页传来的附件写入缓存目录，交给系统默认应用打开（预览已发送的照片 / 文件） */
        @android.webkit.JavascriptInterface
        fun openFile(base64: String, name: String, mime: String) {
            runOnUiThread {
                try {
                    val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                    val dir = File(cacheDir, "open").apply { mkdirs() }
                    val safeName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifEmpty { "file" }
                    val target = File(dir, safeName)
                    target.writeBytes(bytes)
                    val uri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "$packageName.fileprovider",
                        target,
                    )
                    val type = mime.ifBlank { "application/octet-stream" }
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, type)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(intent)
                } catch (_: Exception) {
                }
            }
        }

        /** 打开系统文件选择器挑选历史 ZIP，选完由原生复制并回调前端 */
        @android.webkit.JavascriptInterface
        fun pickArchive() {
            this@MainActivity.pickArchive()
        }

        /** 前端轮询导入包准备状态；拿到 ready 后自行 fetch /local/import.zip */
        @android.webkit.JavascriptInterface
        fun archiveState(): String = archiveState

        @android.webkit.JavascriptInterface
        fun resetArchiveState() {
            archiveState = org.json.JSONObject().put("state", "idle").toString()
        }

        @android.webkit.JavascriptInterface
        fun begin(name: String): Boolean {
            closeSaveStream()
            val safeName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifEmpty {
                "deepseek_data.zip"
            }
            return try {
                val mime =
                    if (safeName.endsWith(".zip")) "application/zip" else "application/octet-stream"
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime)
                        put(
                            android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                            android.os.Environment.DIRECTORY_DOWNLOADS
                        )
                    }
                    val uri = contentResolver.insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                        values,
                    ) ?: return false
                    saveStream = contentResolver.openOutputStream(uri)
                } else {
                    val dir = android.os.Environment.getExternalStoragePublicDirectory(
                        android.os.Environment.DIRECTORY_DOWNLOADS
                    )
                    dir.mkdirs()
                    saveStream = File(dir, safeName).outputStream()
                }
                saveName = safeName
                saveStream != null
            } catch (e: Exception) {
                closeSaveStream()
                false
            }
        }

        @android.webkit.JavascriptInterface
        fun append(base64: String): Boolean = try {
            val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            saveStream?.write(bytes)
            true
        } catch (_: Exception) {
            false
        }

        @android.webkit.JavascriptInterface
        fun end() {
            val name = saveName
            closeSaveStream()
            if (name != null) {
                runOnUiThread {
                    android.widget.Toast.makeText(
                        this@MainActivity,
                        "已保存到「下载」：$name",
                        android.widget.Toast.LENGTH_LONG,
                    ).show()
                }
            }
        }

        @android.webkit.JavascriptInterface
        fun abort() {
            closeSaveStream()
        }
    }

    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var saveStream: java.io.OutputStream? = null
    private var saveName: String? = null
    /** 导入包准备状态：idle / copying / ready / error / cancelled，前端通过轮询读取 */
    @Volatile
    private var archiveState: String =
        org.json.JSONObject().put("state", "idle").toString()

    private fun closeSaveStream() {
        try {
            saveStream?.close()
        } catch (_: Exception) {
        }
        saveStream = null
        saveName = null
    }

    /** 把 /local/ 前缀映射到应用私有目录，供网页用 fetch 读取原生准备的文件 */
    inner class SharedFileHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val root = File(filesDir, "shared").apply { mkdirs() }
            val file = File(root, path)
            if (!file.canonicalPath.startsWith(root.canonicalPath)) {
                return null
            }
            if (!file.isFile) {
                return WebResourceResponse(
                    "text/plain", "utf-8", 404, "Not Found", emptyMap(), null
                )
            }
            val mime = when (file.extension.lowercase()) {
                "wav" -> "audio/wav"
                "zip" -> "application/zip"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                else -> "application/octet-stream"
            }
            // 必须显式 no-store：否则 WebView 会按 URL 缓存上一次（可能是别的文件）的响应
            return WebResourceResponse(
                mime,
                null,
                200,
                "OK",
                mapOf(
                    "Cache-Control" to "no-store, no-cache, must-revalidate",
                    "Pragma" to "no-cache",
                ),
                file.inputStream()
            )
        }
    }

    /** 原生文件选择器：考的是「把选中文件复制到应用目录再交给网页」，绕开 WebView 读 content:// 大文件的问题 */
    private fun pickArchive() {
        runOnUiThread {
            try {
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    // 不同文件管理器给 ZIP 的 MIME 不一致，放开类型由我们自己做格式校验
                    type = "*/*"
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                archiveState = org.json.JSONObject().put("state", "idle").toString()
                startActivityForResult(intent, REQ_PICK_ARCHIVE)
            } catch (e: Exception) {
                emitJs("window.__dsArchiveError && window.__dsArchiveError('无法打开文件选择器')")
            }
        }
    }

    private fun importArchiveFromUri(uri: Uri) {
        archiveState = org.json.JSONObject().put("state", "copying").toString()
        emitJs("window.__dsArchiveBusy && window.__dsArchiveBusy(true)")
        Thread {
            try {
                val dir = File(filesDir, "shared").apply { mkdirs() }
                File(dir, "import.zip").delete()
                val target = File(dir, "import.zip")
                contentResolver.openInputStream(uri).use { input ->
                    if (input == null) {
                        throw IllegalStateException("无法读取所选文件")
                    }
                    target.outputStream().use { output -> input.copyTo(output, 128 * 1024) }
                }
                val name = displayName(uri) ?: "deepseek_data.zip"
                archiveState = org.json.JSONObject()
                    .put("state", "ready")
                    .put("name", name)
                    .put("size", target.length())
                    .toString()
                emitJs(
                    "window.__dsArchiveReady && window.__dsArchiveReady({" +
                        "url:'https://appassets.androidplatform.net/local/import.zip'," +
                        "name:${org.json.JSONObject.quote(name)}," +
                        "size:${target.length()}})"
                )
            } catch (e: Exception) {
                archiveState = org.json.JSONObject()
                    .put("state", "error")
                    .put("message", e.message ?: "读取文件失败")
                    .toString()
                emitJs(
                    "window.__dsArchiveError && window.__dsArchiveError(" +
                        "${org.json.JSONObject.quote(e.message ?: "读取文件失败")})"
                )
            } finally {
                emitJs("window.__dsArchiveBusy && window.__dsArchiveBusy(false)")
            }
        }.start()
    }

    private fun displayName(uri: Uri): String? {
        return try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun emitJs(script: String) {
        runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    /** 从 Content-Disposition 里取文件名，取不到时用带日期的默认名 */
    private fun guessFileName(contentDisposition: String?): String {
        val match = Regex("filename=\"?([^\";]+)\"?").find(contentDisposition ?: "")
        val fromHeader = match?.groupValues?.getOrNull(1)
        if (!fromHeader.isNullOrBlank()) {
            return fromHeader
        }
        val stamp = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
        return "deepseek_data-$stamp.zip"
    }


    /**
     * 原生录音：AudioRecord 采 16kHz 单声道 PCM，停止时拼成 WAV 放在应用目录，
     * 前端用 /local/voice.wav 取回。比 WebView 的 getUserMedia 在安卓上可靠。
     */
    inner class VoiceBridge {
        @android.webkit.JavascriptInterface
        fun hasPermission(): Boolean =
            ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED

        @android.webkit.JavascriptInterface
        fun requestPermission() {
            runOnUiThread {
                ActivityCompat.requestPermissions(
                    this@MainActivity,
                    arrayOf(Manifest.permission.RECORD_AUDIO),
                    REQ_MIC
                )
            }
        }

        /** 返回 {"ok":true} 或 {"ok":false,"reason":"permission|busy|no_device"} */
        @android.webkit.JavascriptInterface
        fun start(): String {
            if (!hasPermission()) {
                return """{"ok":false,"reason":"permission"}"""
            }
            if (recording) {
                return """{"ok":false,"reason":"busy"}"""
            }
            val minBuffer = android.media.AudioRecord.getMinBufferSize(
                RECORD_RATE,
                android.media.AudioFormat.CHANNEL_IN_MONO,
                android.media.AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuffer <= 0) {
                return """{"ok":false,"reason":"no_device"}"""
            }
            val recorder = try {
                android.media.AudioRecord(
                    android.media.MediaRecorder.AudioSource.MIC,
                    RECORD_RATE,
                    android.media.AudioFormat.CHANNEL_IN_MONO,
                    android.media.AudioFormat.ENCODING_PCM_16BIT,
                    maxOf(minBuffer * 2, 8192),
                )
            } catch (e: Exception) {
                return """{"ok":false,"reason":"no_device"}"""
            }
            if (recorder.state != android.media.AudioRecord.STATE_INITIALIZED) {
                recorder.release()
                return """{"ok":false,"reason":"no_device"}"""
            }
            val dir = File(filesDir, "shared").apply { mkdirs() }
            File(dir, "voice.wav").delete()
            val pcm = File(dir, "voice.pcm")
            pcm.delete()
            try {
                recorder.startRecording()
            } catch (e: Exception) {
                recorder.release()
                return """{"ok":false,"reason":"no_device"}"""
            }
            audioRecord = recorder
            recordPcm = pcm
            recording = true
            recordStartedAt = System.currentTimeMillis()
            recordThread = Thread {
                try {
                    java.io.BufferedOutputStream(pcm.outputStream(), 64 * 1024).use { out ->
                        val buffer = ShortArray(2048)
                        val bytes = ByteArray(buffer.size * 2)
                        while (recording) {
                            val read = recorder.read(buffer, 0, buffer.size)
                            if (read <= 0) {
                                continue
                            }
                            for (i in 0 until read) {
                                val sample = buffer[i].toInt()
                                bytes[i * 2] = (sample and 0xFF).toByte()
                                bytes[i * 2 + 1] = ((sample shr 8) and 0xFF).toByte()
                            }
                            out.write(bytes, 0, read * 2)
                            if (System.currentTimeMillis() - recordStartedAt >= MAX_RECORD_MS) {
                                recording = false
                                emitJs("window.__dsVoiceLimit && window.__dsVoiceLimit()")
                            }
                        }
                    }
                } catch (_: Exception) {
                }
            }.apply { isDaemon = true; start() }
            return """{"ok":true}"""
        }

        /** 停止并返回 {"ok":true,"url":"..."}；没采到数据时 ok=false */
        @android.webkit.JavascriptInterface
        fun stop(): String {
            val recorder = audioRecord
            recording = false
            try {
                recordThread?.join(1200)
            } catch (_: Exception) {
            }
            recordThread = null
            try {
                if (recorder != null && recorder.state == android.media.AudioRecord.STATE_INITIALIZED) {
                    recorder.stop()
                }
            } catch (_: Exception) {
            }
            try {
                recorder?.release()
            } catch (_: Exception) {
            }
            audioRecord = null
            val pcm = recordPcm
            recordPcm = null
            if (pcm == null || !pcm.isFile || pcm.length() < 2) {
                pcm?.delete()
                return """{"ok":false,"reason":"empty"}"""
            }
            return try {
                val target = File(pcm.parentFile, "voice.wav")
                writeWav(pcm, target)
                pcm.delete()
                """{"ok":true,"url":"https://appassets.androidplatform.net/local/voice.wav?v=${System.currentTimeMillis()}","size":${target.length()}}"""
            } catch (e: Exception) {
                """{"ok":false,"reason":"write"}"""
            }
        }

        @android.webkit.JavascriptInterface
        fun cancel() {
            recording = false
            try {
                recordThread?.join(600)
            } catch (_: Exception) {
            }
            recordThread = null
            try {
                audioRecord?.release()
            } catch (_: Exception) {
            }
            audioRecord = null
            recordPcm?.delete()
            recordPcm = null
        }
    }

    /** 给裸 PCM 加 44 字节 WAV 头（16kHz / 单声道 / 16-bit） */
    private fun writeWav(pcm: File, target: File) {
        val dataLength = pcm.length().toInt()
        java.io.BufferedOutputStream(target.outputStream(), 64 * 1024).use { out ->
            val header = java.nio.ByteBuffer.allocate(44).order(java.nio.ByteOrder.LITTLE_ENDIAN)
            header.put("RIFF".toByteArray())
            header.putInt(36 + dataLength)
            header.put("WAVE".toByteArray())
            header.put("fmt ".toByteArray())
            header.putInt(16)
            header.putShort(1)
            header.putShort(1)
            header.putInt(RECORD_RATE)
            header.putInt(RECORD_RATE * 2)
            header.putShort(2)
            header.putShort(16)
            header.put("data".toByteArray())
            header.putInt(dataLength)
            out.write(header.array())
            pcm.inputStream().use { it.copyTo(out, 64 * 1024) }
        }
    }

    /** 暴露少量原生能力给前端（最近照片等） */
    inner class MediaBridge {
        @android.webkit.JavascriptInterface
        fun ping(): String = "ok"

        /** 返回相册最近 N 张图片的缩略图（data URI），供快捷面板预览 */
        @android.webkit.JavascriptInterface
        fun getRecentPhotos(limit: Int): String {
            val result = org.json.JSONArray()
            val projection = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DATE_ADDED,
            )
            try {
                contentResolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    null,
                    null,
                    "${MediaStore.Images.Media.DATE_ADDED} DESC",
                )?.use { cursor ->
                    val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                    var count = 0
                    while (cursor.moveToNext() && count < limit) {
                        val id = cursor.getLong(idColumn)
                        val uri = android.content.ContentUris.withAppendedId(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                            id,
                        )
                        val thumb = loadThumbnail(uri)
                        if (!thumb.isNullOrEmpty()) {
                            result.put(
                                org.json.JSONObject().apply {
                                    put("id", id.toString())
                                    put("thumb", thumb)
                                }
                            )
                            count++
                        }
                    }
                }
            } catch (_: Exception) {
            }
            return result.toString()
        }

        /** 读取选中照片的原图（data URI），供上传 */
        @android.webkit.JavascriptInterface
        fun getPhotoData(id: String): String {
            return try {
                val uri = android.content.ContentUris.withAppendedId(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    id.toLong(),
                )
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return ""
                val mime = contentResolver.getType(uri) ?: "image/jpeg"
                "data:$mime;base64," + android.util.Base64.encodeToString(
                    bytes,
                    android.util.Base64.NO_WRAP,
                )
            } catch (_: Exception) {
                ""
            }
        }

        private fun loadThumbnail(uri: Uri): String? {
            return try {
                val bitmap = if (Build.VERSION.SDK_INT >= 29) {
                    contentResolver.loadThumbnail(uri, android.util.Size(240, 240), null)
                } else {
                    MediaStore.Images.Media.getBitmap(contentResolver, uri)
                }
                val stream = java.io.ByteArrayOutputStream()
                val scaled = android.graphics.Bitmap.createScaledBitmap(
                    bitmap,
                    minOf(240, bitmap.width),
                    minOf(240, bitmap.height),
                    true,
                )
                scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, stream)
                "data:image/jpeg;base64," + android.util.Base64.encodeToString(
                    stream.toByteArray(),
                    android.util.Base64.NO_WRAP,
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    companion object {
        private const val REQ_FILE = 1001
        private const val REQ_CAMERA = 1002
        private const val REQ_PERMISSION = 1003
        private const val REQ_MIC = 1005
        private const val PREFS = "ds_settings"
        private const val KEY_WEBVIEW_DEBUG = "webview_debug"
        private const val REQ_APP_PERMISSION = 1006
        private const val RECORD_RATE = 16000
        private const val MAX_RECORD_MS = 120_000L
        private const val REQ_PICK_ARCHIVE = 1004
    }
}

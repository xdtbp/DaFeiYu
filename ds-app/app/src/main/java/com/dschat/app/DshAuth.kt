package com.dschat.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * DeepSeek Harness 账号登录。
 *
 * 复用 harness 的 OAuth（PKCE）流程：
 *   1. POST /auth-api/v0/dsh/auth_init 换取 authorize_url + authorize_id
 *   2. 用系统浏览器打开 authorize_url，平台登录后重定向到本机回环地址
 *   3. 本机 ServerSocket 收到 /oauth/callback?code=...&state=... 校验 state
 *   4. POST /auth-api/v0/dsh/auth_exchange 用 code + code_verifier 换 token
 *   5. token 通过 x-dsh-auth-token 请求头像昵称与余额
 *
 * 浏览器与 WebView 之间无法直接跨域，因此全部请求都在原生侧完成，
 * 结果通过 evaluateJavascript 回调给前端。
 */
class DshAuth(
    private val context: Context,
    private val emit: (String) -> Unit,
    private val openBrowser: (String) -> Unit,
) {

    private val platform = "https://platform.deepseek.com"
    private val prefs = context.getSharedPreferences("dsh_account", Context.MODE_PRIVATE)
    // 多线程执行器：等待浏览器回调会长时间阻塞，不能占用刷新资料的线程
    private val worker = Executors.newCachedThreadPool()
    private var server: ServerSocket? = null
    @Volatile
    private var cancelled = false
    /** 每次登录递增；旧任务的回调和错误不再影响新一次登录 */
    @Volatile
    private var attemptSeq = 0

    /** 已缓存的账号信息，供前端启动时立即渲染，避免侧边栏空一下 */
    fun cached(): String {
        val token = prefs.getString(KEY_TOKEN, null)
        if (token.isNullOrEmpty()) {
            return JSONObject().put("status", "signed-out").toString()
        }
        return JSONObject()
            .put("status", "signed-in")
            .put("name", prefs.getString(KEY_NAME, "") ?: "")
            .put("avatar", prefs.getString(KEY_AVATAR, "") ?: "")
            .put("email", prefs.getString(KEY_EMAIL, "") ?: "")
            .put("balance", readWallets(KEY_BALANCE))
            .put("bonus", readWallets(KEY_BONUS))
            .toString()
    }

    /** 偏好里存的是 JSON 字符串，读出来必须还原成数组，前端按数组处理 */
    private fun readWallets(key: String): JSONArray = try {
        JSONArray(prefs.getString(key, "[]") ?: "[]")
    } catch (_: Exception) {
        JSONArray()
    }

    /** 供前端 account 通道做鉴权 */
    fun token(): String = prefs.getString(KEY_TOKEN, "") ?: ""

    fun signOut() {
        prefs.edit().clear().apply()
        emit(JSONObject().put("status", "signed-out").toString())
    }

    /** 刷新资料与余额（不重新登录） */
    fun refresh() {
        val token = prefs.getString(KEY_TOKEN, null)
        if (token.isNullOrEmpty()) {
            emit(JSONObject().put("status", "signed-out").toString())
            return
        }
        worker.execute {
            try {
                emit(loadAccount(token).toString())
            } catch (e: Exception) {
                emit(error("refresh", e))
            }
        }
    }

    fun signIn() {
        // 关掉上一次可能还在等待的回调，避免旧任务一直占着端口
        closeServer()
        cancelled = false
        val current = ++attemptSeq
        emit(JSONObject().put("status", "authorizing").toString())
        worker.execute {
            var socket: ServerSocket? = null
            try {
                val state = randomToken(32)
                val verifier = randomToken(48)
                val challenge = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(sha256(verifier.toByteArray()))

                socket = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
                socket.soTimeout = CALLBACK_TIMEOUT_MS
                server = socket
                val redirectUri = "http://127.0.0.1:${socket.localPort}/oauth/callback"

                val init = withRetry {
                    requestJson(
                    "$platform/auth-api/v0/dsh/auth_init",
                    "POST",
                    JSONObject()
                        .put("code_challenge", challenge)
                        .put("code_challenge_method", "S256")
                        .put("state", state)
                        .put("redirect_uri", redirectUri)
                        .put("locale", "zh_CN")
                        .put("login_source", "web"),
                    null,
                )
                }
                val authorizeUrl = init.getString("authorize_url")
                emit(
                    JSONObject()
                        .put("status", "authorizing")
                        .toString()
                )
                openBrowser(authorizeUrl)

                val code = awaitCallback(socket, state, current)
                if (code == null) {
                    if (current == attemptSeq) {
                        emit(error("login timeout", null))
                    }
                    return@execute
                }

                val exchanged = withRetry {
                    requestJson(
                    "$platform/auth-api/v0/dsh/auth_exchange",
                    "POST",
                    JSONObject()
                        .put("code", code)
                        .put("code_verifier", verifier)
                        .put("redirect_uri", redirectUri)
                        .put("device_id", deviceId())
                        .put("device_model", android.os.Build.MODEL ?: "android")
                        .put("os_version", "Android ${android.os.Build.VERSION.RELEASE}"),
                    null,
                )
                }
                val token = exchanged.getString("token")
                prefs.edit().putString(KEY_TOKEN, token).apply()

                val account = loadAccount(token, exchanged.optJSONObject("user"))
                if (current == attemptSeq) {
                    emit(account.toString())
                }
            } catch (e: Exception) {
                if (current == attemptSeq) {
                    emit(error("signin", e))
                }
            } finally {
                try {
                    socket?.close()
                } catch (_: Exception) {
                }
                server = null
            }
        }
    }

    /** 关闭进行中的回调服务（用户取消或页面销毁） */
    fun cancel() {
        cancelled = true
        attemptSeq++
        closeServer()
    }

    private fun loadAccount(token: String, exchangeUser: JSONObject? = null): JSONObject {
        val profile = try {
            withRetry { requestJson("$platform/auth-api/v0/users/current", "GET", null, token) }
        } catch (_: Exception) {
            exchangeUser
        }
        val summary = try {
            withRetry { requestJson("$platform/api/v0/users/get_user_summary", "GET", null, token) }
        } catch (_: Exception) {
            null
        }

        val identity = profile?.optJSONObject("id_profile")
        val name = identity?.optString("name").orEmpty()
        val avatar = identity?.optString("picture").orEmpty()
        val email = profile?.optString("email").orEmpty().ifEmpty {
            profile?.optString("mobile").orEmpty()
        }

        val balance = JSONArray()
        val bonus = JSONArray()
        summary?.optJSONArray("normal_wallets")?.let { wallets ->
            for (i in 0 until wallets.length()) {
                val wallet = wallets.optJSONObject(i) ?: continue
                balance.put(
                    JSONObject()
                        .put("currency", wallet.optString("currency", "CNY"))
                        .put("balance", wallet.optString("balance", "0"))
                )
            }
        }
        summary?.optJSONArray("bonus_wallets")?.let { wallets ->
            for (i in 0 until wallets.length()) {
                val wallet = wallets.optJSONObject(i) ?: continue
                bonus.put(
                    JSONObject()
                        .put("currency", wallet.optString("currency", "CNY"))
                        .put("balance", wallet.optString("balance", "0"))
                )
            }
        }

        prefs.edit()
            .putString(KEY_NAME, name)
            .putString(KEY_AVATAR, avatar)
            .putString(KEY_EMAIL, email)
            .putString(KEY_BALANCE, balance.toString())
            .putString(KEY_BONUS, bonus.toString())
            .apply()

        return JSONObject()
            .put("status", "signed-in")
            .put("name", name)
            .put("avatar", avatar)
            .put("email", email)
            .put("balance", balance)
            .put("bonus", bonus)
    }

    private fun closeServer() {
        try {
            server?.close()
        } catch (_: Exception) {
        }
        server = null
    }

    /** 等待浏览器回调，返回授权码；超时、取消或被新一次登录取代时返回 null */
    private fun awaitCallback(socket: ServerSocket, expectedState: String, attempt: Int): String? {
        while (!cancelled && attempt == attemptSeq) {
            val client: Socket = try {
                socket.accept()
            } catch (_: Exception) {
                return null
            }
            client.use { connection ->
                val reader = BufferedReader(InputStreamReader(connection.getInputStream()))
                val requestLine = reader.readLine() ?: return@use
                // 读取并丢弃请求头
                while (true) {
                    val line = reader.readLine() ?: break
                    if (line.isEmpty()) break
                }
                val target = requestLine.split(' ').getOrNull(1) ?: return@use
                val path = target.substringBefore('?')
                if (!path.contains("/oauth/callback")) {
                    respond(connection.getOutputStream(), 404, "Not Found")
                    return@use
                }
                val query = target.substringAfter('?', "")
                val params = query.split('&').filter { it.contains('=') }.associate {
                    it.substringBefore('=') to java.net.URLDecoder.decode(
                        it.substringAfter('='), "UTF-8"
                    )
                }
                val code = params["code"]
                val state = params["state"]
                if (code.isNullOrEmpty() || state != expectedState) {
                    respond(connection.getOutputStream(), 400, "State mismatch")
                    return@use
                }
                respond(connection.getOutputStream(), 200, SUCCESS_HTML)
                return code
            }
        }
        return null
    }

    private fun respond(out: OutputStream, code: Int, body: String) {
        val html = if (body.startsWith("<")) body else
            "<!doctype html><meta charset=\"utf-8\"><body style=\"font:16px/1.6 -apple-system,sans-serif;" +
                "padding:48px 24px;text-align:center;color:#333\">$body</body>"
        val bytes = html.toByteArray()
        val head = "HTTP/1.1 $code OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        out.write(head.toByteArray())
        out.write(bytes)
        out.flush()
    }

    /** 网络类失败（DNS/连接/超时）可以安全重试；业务错误重试没有意义 */
    private class Retryable(message: String) : Exception(message)

    private fun <T> withRetry(times: Int = 5, block: () -> T): T {
        var last: Exception? = null
        for (attempt in 0 until times) {
            try {
                return block()
            } catch (e: Retryable) {
                last = e
                if (attempt < times - 1) {
                    // DNS 抖动通常持续几秒，退避等待后再试
                    try {
                        Thread.sleep(600L * (attempt + 1) * (attempt + 1))
                    } catch (_: InterruptedException) {
                    }
                }
            }
        }
        throw last ?: IllegalStateException("network")
    }

    private fun requestJson(
        url: String,
        method: String,
        body: JSONObject?,
        token: String?,
    ): JSONObject {
        val connection = try {
            URL(url).openConnection() as HttpURLConnection
        } catch (e: Exception) {
            throw Retryable(e.message ?: "connect failed")
        }
        connection.requestMethod = method
        connection.connectTimeout = 20000
        connection.readTimeout = 20000
        connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Content-Type", "application/json")
        // 平台对非常规 UA 会直接返回 WAF 拦截页，必须伪装成移动端浏览器
        connection.setRequestProperty("User-Agent", USER_AGENT)
        connection.setRequestProperty("x-client-bundle-id", "")
        connection.setRequestProperty("x-client-platform", "web")
        connection.setRequestProperty("x-client-version", CLIENT_VERSION)
        connection.setRequestProperty("x-client-locale", "zh_CN")
        connection.setRequestProperty(
            "x-client-timezone-offset",
            (TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 1000).toString()
        )
        connection.setRequestProperty("Origin", platform)
        connection.setRequestProperty("Referer", "$platform/")
        if (token != null) {
            connection.setRequestProperty("x-dsh-auth-token", token)
        }
        if (body != null) {
            connection.doOutput = true
            try {
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
            } catch (e: Exception) {
                connection.disconnect()
                throw Retryable(e.message ?: "write failed")
            }
        }

        val status = try {
            connection.responseCode
        } catch (e: Exception) {
            connection.disconnect()
            throw Retryable(e.message ?: "no response")
        }
        val stream = if (status in 200..299) connection.inputStream else connection.errorStream
        val text = try {
            stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        } catch (e: Exception) {
            connection.disconnect()
            throw Retryable(e.message ?: "read failed")
        }
        connection.disconnect()
        if (status !in 200..299) {
            throw IllegalStateException("HTTP $status ${text.take(160)}")
        }
        val payload = JSONObject(text)
        if (payload.optInt("code", 0) != 0) {
            throw IllegalStateException("platform code ${payload.optInt("code")}")
        }
        val data = payload.optJSONObject("data")
        val bizCode = data?.optInt("biz_code", 0) ?: 0
        if (bizCode != 0) {
            throw IllegalStateException("biz code $bizCode")
        }
        return data?.optJSONObject("biz_data") ?: JSONObject()
    }

    private fun error(stage: String, e: Exception?): String {
        val raw = e?.message ?: ""
        android.util.Log.e("DshAuth", "stage=$stage error=$raw", e)
        val message = when {
            e == null && stage.contains("timeout") -> "登录已超时，请重试"
            e == null -> "已取消登录"
            raw.contains("resolve host", true) || raw.contains("connect", true) ->
                "网络不可用，请检查网络后重试"
            raw.contains("timeout", true) -> "请求超时，请重试"
            else -> "登录失败，请重试"
        }
        return JSONObject()
            .put("status", "error")
            .put("stage", stage)
            .put("message", message)
            .put("detail", raw.take(200))
            .toString()
    }

    private fun deviceId(): String {
        val existing = prefs.getString(KEY_DEVICE, null)
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE, created).apply()
        return created
    }

    private fun randomToken(bytes: Int): String {
        val buffer = ByteArray(bytes)
        SecureRandom().nextBytes(buffer)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buffer)
    }

    private fun sha256(input: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(input)

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_NAME = "name"
        private const val KEY_AVATAR = "avatar"
        private const val KEY_EMAIL = "email"
        private const val KEY_BALANCE = "balance"
        private const val KEY_BONUS = "bonus"
        private const val KEY_DEVICE = "device"
        private const val CLIENT_VERSION = "1.0.0"
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Mobile Safari/537.36"
        private const val CALLBACK_TIMEOUT_MS = 300_000
        private const val SUCCESS_HTML =
            "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<title>登录成功</title><body style=\"margin:0;display:flex;align-items:center;" +
                "justify-content:center;height:100vh;font:16px/1.6 -apple-system,sans-serif;" +
                "background:#f7f7f7;color:#1a1a1a\"><div style=\"text-align:center\">" +
                "<div style=\"font-size:44px\">&#10003;</div><p>登录成功，请返回 DeepSeek Chat</p>" +
                "<p style=\"color:#8a8a8a;font-size:14px\">可以关闭此页面</p></div></body></html>"
    }
}

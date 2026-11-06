package com.franklintiffinroom.app.core

import android.content.Context
import com.franklintiffinroom.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Error the server explained in words the customer can read. */
class ApiError(
    override val message: String,
    val code: String? = null,
    val status: Int = 0,
    val extra: Map<String, Double> = emptyMap(),
    val canAskChef: Boolean = false,
) : Exception(message) {
    companion object {
        fun offline() = ApiError("Can't reach Franklin Tiffin Room. Check your internet connection and try again.", "offline", 0)
    }
}

/** Talks to the FTR server's /api/v1 endpoints (src/appApi.js) - the same ones the iPhone app uses. */
object Api {
    val baseUrl: String = BuildConfig.API_BASE
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true; isLenient = true }

    private lateinit var prefs: android.content.SharedPreferences
    var onSignedOut: (() -> Unit)? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(90, TimeUnit.SECONDS)
        .build()

    fun init(context: Context) {
        prefs = context.getSharedPreferences("ftr.session", Context.MODE_PRIVATE)
    }

    var token: String?
        get() = prefs.getString("token", null)
        set(v) { prefs.edit().apply { if (v == null) remove("token") else putString("token", v) }.apply() }

    /** Absolute URL for a path the server returns (e.g. "/zelle-qr?v=123"). */
    fun absolute(path: String?): String? {
        if (path.isNullOrEmpty()) return null
        if (path.startsWith("http")) return path
        val u = baseUrl.toHttpUrl()
        return "${u.scheme}://${u.host}${if (u.port != 443 && u.port != 80) ":${u.port}" else ""}$path"
    }

    suspend inline fun <reified T> get(path: String, query: Map<String, String> = emptyMap()): T =
        decode(send("GET", path, query, null))

    suspend inline fun <reified T, reified B> post(path: String, body: B): T =
        decode(send("POST", path, emptyMap(), json.encodeToString(serializer<B>(), body).toRequestBody(JSON_TYPE)))

    suspend inline fun <reified T, reified B> put(path: String, body: B): T =
        decode(send("PUT", path, emptyMap(), json.encodeToString(serializer<B>(), body).toRequestBody(JSON_TYPE)))

    suspend inline fun <reified T> delete(path: String): T = decode(send("DELETE", path, emptyMap(), null))

    suspend inline fun <reified T> upload(path: String, data: ByteArray, contentType: String): T =
        decode(send("POST", path, emptyMap(), data.toRequestBody(contentType.toMediaType())))

    val JSON_TYPE = "application/json".toMediaType()

    inline fun <reified T> decode(text: String): T = try {
        json.decodeFromString(serializer<T>(), text)
    } catch (e: Exception) {
        throw ApiError("The app needs an update to read this. Please update from Google Play.", "decode", 200)
    }

    suspend fun send(method: String, path: String, query: Map<String, String>, body: RequestBody?): String {
        val url = (baseUrl.trimEnd('/') + "/" + path.trimStart('/')).toHttpUrl().newBuilder().apply {
            query.forEach { (k, v) -> addQueryParameter(k, v) }
        }.build()
        val req = Request.Builder().url(url)
            .header("Accept", "application/json")
            .header("User-Agent", "FTR-Android/${BuildConfig.VERSION_NAME}")
            .apply { token?.let { header("Authorization", "Bearer $it") } }
            .method(method, body ?: if (method == "POST" || method == "PUT") ByteArray(0).toRequestBody(JSON_TYPE) else null)
            .build()
        val (status, text) = try {
            client.newCall(req).await().use { r -> r.code to (r.body?.string() ?: "") }
        } catch (e: IOException) {
            android.util.Log.w("FTR", "Network error for $method $path", e)
            throw ApiError.offline()
        }
        if (status !in 200..299) {
            var err = ApiError("Something went wrong. Please try again.", null, status)
            try {
                val obj = json.parseToJsonElement(text).jsonObject
                val extra = obj.mapNotNull { (k, v) -> (v as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.let { k to it } }.toMap()
                err = ApiError(
                    (obj["error"] as? JsonPrimitive)?.content ?: err.message,
                    (obj["code"] as? JsonPrimitive)?.content,
                    status,
                    extra,
                    (obj["canAskChef"] as? JsonPrimitive)?.booleanOrNull ?: false,
                )
            } catch (_: Exception) {
                // HTML error page or empty body - keep the friendly message.
            }
            if (status == 401) {
                token = null
                withContext(Dispatchers.Main) { onSignedOut?.invoke() }
            }
            throw err
        }
        return text.ifEmpty { "{}" }
    }

    private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (!cont.isCancelled) cont.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) { cont.resume(response) }
        })
        cont.invokeOnCancellation { runCatching { cancel() } }
    }
}

fun Throwable.friendly(): String = (this as? ApiError)?.message ?: (message ?: "Something went wrong. Please try again.")

@kotlinx.serialization.Serializable
class Empty

@kotlinx.serialization.Serializable
data class OK(val ok: Boolean? = null)

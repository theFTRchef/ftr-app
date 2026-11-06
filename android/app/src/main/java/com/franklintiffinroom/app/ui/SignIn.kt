package com.franklintiffinroom.app.ui

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.Profile
import com.franklintiffinroom.app.core.SignInResult
import com.franklintiffinroom.app.core.friendly
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable private data class StartBody(val phone: String, val via: String)
@Serializable private data class StartResult(val via: String? = null)
@Serializable private data class VerifyBody(val phone: String, val code: String, val device: String)
@Serializable data class NameBody(val firstName: String, val lastName: String)

object PhoneFormat {
    fun digits(s: String): String {
        var d = s.filter { it.isDigit() }
        if (d.length == 11 && d.startsWith("1")) d = d.drop(1)
        return d.take(10)
    }
    /** "9085551234" -> "(908) 555-1234" while typing. */
    fun us(s: String): String {
        val d = digits(s)
        return when (d.length) {
            0 -> ""
            in 1..3 -> "($d"
            in 4..6 -> "(${d.take(3)}) ${d.drop(3)}"
            else -> "(${d.take(3)}) ${d.substring(3, 6)}-${d.drop(6)}"
        }
    }
}

private enum class Step { PHONE, CODE, NAME }

/** Phone number -> 6-digit code -> name (first time only). Same identity as WhatsApp. */
@Composable
fun SignInSheet(model: AppModel, onDismiss: () -> Unit, onDone: () -> Unit = onDismiss) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(Step.PHONE) }
    var phone by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var first by remember { mutableStateOf("") }
    var last by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var resendAt by remember { mutableLongStateOf(0L) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var sentVia by remember { mutableStateOf("sms") }
    val whatsApp = model.config?.signInByWhatsApp ?: false

    DisposableEffect(Unit) { model.signInOpen = true; onDispose { model.signInOpen = false } }
    LaunchedEffect(step) { while (step == Step.CODE) { now = System.currentTimeMillis(); delay(1000) } }

    fun sendCode(via: String) = scope.launch {
        busy = true; error = null
        try {
            val r = Api.post<StartResult, StartBody>("auth/start", StartBody(PhoneFormat.digits(phone), via))
            sentVia = r.via ?: via
            step = Step.CODE; code = ""
            resendAt = System.currentTimeMillis() + 30_000
        } catch (e: Exception) { error = e.friendly() } finally { busy = false }
    }
    fun verify() {
        if (busy) return
        scope.launch {
            busy = true; error = null
            try {
                val result = Api.post<SignInResult, VerifyBody>("auth/verify", VerifyBody(PhoneFormat.digits(phone), code, "${Build.MANUFACTURER} ${Build.MODEL}"))
                model.signedIn(result)
                if (result.profile.needsName) step = Step.NAME else onDone()
            } catch (e: Exception) { error = e.friendly(); code = "" } finally { busy = false }
        }
    }
    fun saveName() = scope.launch {
        busy = true; error = null
        try { model.updateProfile(Api.put<Profile, NameBody>("me", NameBody(first.trim(), last.trim()))); onDone() }
        catch (e: Exception) { error = e.friendly() } finally { busy = false }
    }

    FullSheet(onDismiss, closeLabel = if (step == Step.NAME) null else "Cancel", dismissable = step != Step.NAME) { pad ->
        ScrollBody(pad, spacing = 16) {
            FtrLogo(26)
            when (step) {
                Step.PHONE -> {
                    Text("Sign in to order", style = Type.display(30), color = P.ink)
                    MutedText(if (whatsApp) "We'll send a 6-digit code to your mobile on WhatsApp. Already order from us on WhatsApp? Use that number and we'll know it's you."
                    else "We'll text a 6-digit code to your mobile. Already order from us on WhatsApp? Use that number and we'll know it's you.", 16.0)
                    Field(phone, { phone = PhoneFormat.us(it) }, "(908) 555-1234", style = Type.semi(24.0), keyboard = KeyboardOptions(keyboardType = KeyboardType.Phone))
                    val ok = PhoneFormat.digits(phone).length == 10
                    PrimaryButton(if (whatsApp) "Send code on WhatsApp" else "Text me a code", enabled = ok, busy = busy) { sendCode(if (whatsApp) "whatsapp" else "sms") }
                    if (whatsApp) SecondaryButton("Text me a code instead", enabled = ok && !busy) { sendCode("sms") }
                    MutedText(if (whatsApp) "No WhatsApp? We'll send a text instead after 2 minutes. Message and data rates may apply." else "Message and data rates may apply.", 13.0)
                }
                Step.CODE -> {
                    Text("Enter your code", style = Type.display(30), color = P.ink)
                    MutedText(if (sentVia == "whatsapp") "Sent on WhatsApp to $phone. If it doesn't arrive, a text message follows in 2 minutes." else "Sent by text message to $phone.", 16.0)
                    Field(code, { v ->
                        code = v.filter { it.isDigit() }.take(6)
                        if (code.length == 6) verify()
                    }, "123456", style = Type.bold(30.0).copy(letterSpacing = 6.sp), keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword))
                    PrimaryButton("Sign in", enabled = code.length == 6, busy = busy) { verify() }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TextButton(onClick = { step = Step.PHONE; code = ""; error = null }) { Text("Change number", style = Type.semi(15.0), color = P.leaf) }
                        Spacer(Modifier.weight(1f))
                        val wait = ((resendAt - now + 999) / 1000).coerceAtLeast(0)
                        TextButton(onClick = { sendCode("sms") }, enabled = wait == 0L && !busy) {
                            Text(if (wait > 0) "Resend in ${wait}s" else if (sentVia == "whatsapp") "Send by text instead" else "Resend code", style = Type.semi(15.0), color = if (wait > 0) P.muted else P.leaf)
                        }
                    }
                }
                Step.NAME -> {
                    Text("Nice to meet you", style = Type.display(30), color = P.ink)
                    MutedText("What name should Chef put on your orders?", 16.0)
                    Field(first, { first = it }, "First name", style = Type.body(18.0))
                    Field(last, { last = it }, "Last name", style = Type.body(18.0))
                    PrimaryButton("Continue", enabled = first.isNotBlank() && last.isNotBlank(), busy = busy) { saveName() }
                }
            }
            error?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
        }
    }
}

/** Shows sign-in when needed, otherwise the content. */
@Composable
fun SignedInGate(model: AppModel, reason: String, pad: PaddingValues, content: @Composable () -> Unit) {
    var showSignIn by remember { mutableStateOf(false) }
    if (model.isSignedIn) content()
    else Column(Modifier.fillMaxSize().padding(pad).padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp, Alignment.CenterVertically)) {
        FtrLogo(30)
        Text(reason, style = Type.body(17.0), color = P.ink, textAlign = TextAlign.Center)
        PrimaryButton("Sign in with your phone number") { showSignIn = true }
    }
    if (showSignIn) SignInSheet(model, onDismiss = { showSignIn = false })
}

@Composable
fun EditNameSheet(model: AppModel, required: Boolean = false, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var first by remember { mutableStateOf(model.profile?.firstName ?: "") }
    var last by remember { mutableStateOf(model.profile?.lastName ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    FullSheet(onDismiss, title = if (required) "Add your name" else "Your name", closeLabel = if (required) null else "Cancel", dismissable = !required) { pad ->
        ScrollBody(pad, spacing = 14) {
            Field(first, { first = it }, "First name", style = Type.body(18.0))
            Field(last, { last = it }, "Last name", style = Type.body(18.0))
            error?.let { Text(it, style = Type.body(15.0), color = P.bad) }
            PrimaryButton("Save", enabled = first.isNotBlank() && last.isNotBlank(), busy = busy) {
                scope.launch {
                    busy = true
                    try { model.updateProfile(Api.put<Profile, NameBody>("me", NameBody(first.trim(), last.trim()))); onDismiss() }
                    catch (e: Exception) { error = e.friendly() } finally { busy = false }
                }
            }
        }
    }
}


package com.franklintiffinroom.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.ApiError
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

// Recipe QR codes. Two kinds open a recipe, and nothing shows without a scan:
//  - gift labels on FTR-BBB Powder packets: https://bot.franklintiffinroom.com/g/T50-017-XXXXXXXX
//    (single use: the first phone to open one keeps it; CHEF-TEST is Chef's reusable test code)
//  - recipe codes made in Chef's Kitchen: https://bot.franklintiffinroom.com/r/<token>
// Same as the iPhone app (RecipeScanView.swift).

@Serializable
data class Recipe(
    val title: String,
    val powder: String? = null,
    val intro: String? = null,
    val serves: String? = null,
    val time: String? = null,
    val ingredients: List<String> = emptyList(),
    val amounts: List<String>? = null,
    val steps: List<String> = emptyList(),
    val tip: String? = null,
)

@Serializable
data class GiftInfo(val code: String, val label: Int = 0, val title: String = "", val product: String = "", val test: Boolean = false)

@Serializable
data class SurveyQuestion(val key: String, val label: String, val options: List<String>? = null)

@Serializable
data class GiftSurvey(val questions: List<SurveyQuestion> = emptyList(), val answers: Map<String, String> = emptyMap(), val done: Boolean = false)

@Serializable
private data class RecipeResponse(val recipe: Recipe)

@Serializable
private data class GiftResponse(val gift: GiftInfo, val recipe: Recipe, val survey: GiftSurvey)

@Serializable
private data class SurveyBody(val answers: Map<String, String>)

@Serializable
private data class OkResponse(val ok: Boolean? = null)

data class OpenedRecipe(val recipe: Recipe, val gift: GiftInfo? = null, val survey: GiftSurvey? = null)

sealed class RecipeCode {
    data class ChefRecipe(val token: String) : RecipeCode()
    data class Gift(val code: String) : RecipeCode()

    companion object {
        private const val HOST = "bot.franklintiffinroom.com"
        private val GIFT = Regex("^[A-Z0-9]{2,8}-[0-9]{1,4}-[0-9A-Z]{8}$")
        private val TOKEN = Regex("^[a-z0-9-]{4,40}$")

        /** Set from a debug launch (adb ... --es ftrScanCode CHEF-TEST) for screenshots. */
        var pending: String? = null

        private fun isGift(s: String) = s.uppercase().let { it == "CHEF-TEST" || GIFT.matches(it) }

        /** What a scanned QR code points at, or null when it isn't an FTR code. */
        fun parse(payload: String): RecipeCode? {
            val s = payload.trim()
            if (!s.contains("/")) {
                if (isGift(s)) return Gift(s.uppercase())
                return if (TOKEN.matches(s.lowercase())) ChefRecipe(s.lowercase()) else null
            }
            val uri = runCatching { java.net.URI(s) }.getOrNull() ?: return null
            if (uri.host?.lowercase() != HOST) return null
            val parts = (uri.path ?: "").split("/").filter { it.isNotEmpty() }
            if (parts.size != 2) return null
            return when (parts[0]) {
                "g" -> if (isGift(parts[1])) Gift(parts[1].uppercase()) else null
                "r" -> parts[1].lowercase().let { if (TOKEN.matches(it)) ChefRecipe(it) else null }
                else -> null
            }
        }
    }
}

private suspend fun openCode(code: RecipeCode): OpenedRecipe = when (code) {
    is RecipeCode.ChefRecipe -> OpenedRecipe(Api.get<RecipeResponse>("recipes/scan/${code.token}").recipe)
    is RecipeCode.Gift -> Api.get<GiftResponse>("gift/${code.code}").let { OpenedRecipe(it.recipe, it.gift, it.survey) }
}

/** The Home-screen card that opens the scanner. */
@Composable
fun ScanRecipeCard() {
    val ctx = LocalContext.current
    var code by remember { mutableStateOf<RecipeCode?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        RecipeCode.pending?.let { p -> RecipeCode.pending = null; code = RecipeCode.parse(p) }
    }

    fun scan() {
        error = null
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build()
        GmsBarcodeScanning.getClient(ctx, options).startScan()
            .addOnSuccessListener { b ->
                val found = b.rawValue?.let { RecipeCode.parse(it) }
                if (found == null) error = "That code isn't an FTR recipe. Look for the QR code on your FTR masala packet."
                else code = found
            }
            .addOnFailureListener {
                error = "The scanner couldn't start. Make sure Google Play services is up to date, then try again."
            }
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth().card(P.surface, P.line, RoundedCornerShape(20.dp)).clickable(onClickLabel = "Open the QR scanner") { scan() }.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(Modifier.size(52.dp).background(P.leafSoft, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.QrCodeScanner, null, tint = P.red, modifier = Modifier.size(28.dp))
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("SCAN A RECIPE QR", style = Type.display(17), color = P.ink)
                Text("Got an FTR masala packet? Scan its code for Chef's recipe.", style = Type.body(13.0), color = P.muted)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = P.muted)
        }
        error?.let { Notice(it, Tone.WARN) }
    }

    code?.let { c -> RecipeSheet(c, onScanAnother = { code = null; scan() }) { code = null } }
}

@Composable
private fun RecipeSheet(code: RecipeCode, onScanAnother: () -> Unit, onDismiss: () -> Unit) {
    var opened by remember(code) { mutableStateOf<OpenedRecipe?>(null) }
    var error by remember(code) { mutableStateOf<String?>(null) }
    var showSurvey by remember { mutableStateOf(false) }

    LaunchedEffect(code) {
        try {
            opened = openCode(code)
        } catch (e: ApiError) {
            error = e.message
        }
    }

    FullSheet(
        onDismiss, title = if (opened == null) "Scan a recipe QR" else "",
        actions = { TextButton(onClick = onScanAnother) { Text("Scan another", style = Type.semi(16.0), color = P.leaf) } },
    ) { pad ->
        val o = opened
        when {
            error != null -> Column(Modifier.padding(pad).padding(20.dp)) { Notice(error!!, Tone.WARN) }
            o == null -> Box(Modifier.fillMaxSize().padding(pad), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = P.leaf)
                    Text("Opening Chef's recipe…", style = Type.body(15.0), color = P.muted)
                }
            }
            else -> RecipeBody(o, Modifier.padding(pad)) { showSurvey = true }
        }
    }

    val o = opened
    if (showSurvey && o?.gift != null && o.survey != null) {
        SurveySheet(o.gift, o.survey, onDismiss = { showSurvey = false }) { answers ->
            opened = o.copy(survey = o.survey.copy(answers = answers, done = true))
            showSurvey = false
        }
    }
}

@Composable
private fun RecipeBody(o: OpenedRecipe, modifier: Modifier, openSurvey: () -> Unit) {
    val r = o.recipe
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 680.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val kicker = o.gift?.let { if (it.test) "CHEF'S TEST CODE" else "FTR GIFT NO. ${it.label}" } ?: r.powder?.uppercase()
                kicker?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.bold(11.0).copy(letterSpacing = 1.sp), color = P.red) }
                Text(r.title.uppercase(), style = Type.display(30), color = P.ink)
                r.intro?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.tagline(16), color = P.muted) }
                val facts = listOfNotNull(r.serves?.takeIf { it.isNotEmpty() }?.let { "Serves $it" }, r.time?.takeIf { it.isNotEmpty() })
                if (facts.isNotEmpty()) Text(facts.joinToString("   "), style = Type.semi(14.0), color = P.ink, modifier = Modifier.padding(top = 4.dp))
            }

            if (r.ingredients.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().card(P.surface, P.line, RoundedCornerShape(18.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("INGREDIENTS", style = Type.display(18), color = P.ink)
                    r.ingredients.forEachIndexed { i, line ->
                        Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Box(Modifier.padding(top = 9.dp).size(6.dp).background(P.goldLine, CircleShape))
                            Text(line, style = Type.body(16.0), color = P.ink, modifier = Modifier.weight(1f))
                            r.amounts?.getOrNull(i)?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.semi(15.0), color = P.ink) }
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("METHOD", style = Type.display(18), color = P.ink)
                r.steps.forEachIndexed { i, step ->
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(28.dp).background(P.leaf, CircleShape).semantics { contentDescription = "Step ${i + 1}" }, contentAlignment = Alignment.Center) {
                            Text("${i + 1}", style = Type.bold(14.0), color = P.leafInk)
                        }
                        val cut = step.indexOf(": ")
                        Text(
                            buildAnnotatedString {
                                if (cut in 1..24) {
                                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(step.substring(0, cut + 2)) }
                                    append(step.substring(cut + 2))
                                } else append(step)
                            },
                            style = Type.body(16.0), color = P.ink, modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            r.tip?.takeIf { it.isNotEmpty() }?.let { tip ->
                Column(Modifier.fillMaxWidth().background(P.turmericSoft, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("CHEF'S TIP", style = Type.bold(11.0).copy(letterSpacing = 1.sp), color = P.turmericInk)
                    Text(tip, style = Type.body(15.0), color = P.ink)
                }
            }

            o.survey?.let { s ->
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("HOW WAS IT?", style = Type.display(18), color = P.ink)
                    Text(
                        if (s.done) "Thank you for your feedback! You can update it any time."
                        else "Once you've made it, tell Chef what was right and what was wrong. Every answer helps FTR get better.",
                        style = Type.body(15.0), color = P.muted,
                    )
                    PrimaryButton(if (s.done) "Update my feedback" else "Share my feedback", Modifier.fillMaxWidth(), onClick = openSurvey)
                }
            }
            Spacer(Modifier.size(12.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SurveySheet(gift: GiftInfo, survey: GiftSurvey, onDismiss: () -> Unit, saved: (Map<String, String>) -> Unit) {
    val answers = remember { mutableStateMapOf<String, String>().apply { putAll(survey.answers) } }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun send() {
        sending = true
        error = null
        scope.launch {
            try {
                Api.post<OkResponse, SurveyBody>("gift/${gift.code}/survey", SurveyBody(answers.toMap()))
                saved(answers.toMap())
            } catch (e: ApiError) {
                error = e.message
            }
            sending = false
        }
    }

    FullSheet(onDismiss, title = "How was your BBB?", closeLabel = "Cancel", actions = {
        if (sending) CircularProgressIndicator(Modifier.size(22.dp).padding(end = 4.dp), color = P.leaf, strokeWidth = 2.dp)
        else TextButton(onClick = ::send) { Text("Send", style = Type.bold(16.0), color = P.leaf) }
    }) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (gift.test) Notice("Chef's test code: answers aren't saved.")
            survey.questions.forEach { q ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(q.label, style = Type.semi(15.0), color = P.ink)
                    val opts = q.options
                    if (opts != null) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            opts.forEach { opt ->
                                val on = answers[q.key] == opt
                                FilterChip(
                                    selected = on, onClick = { answers[q.key] = if (on) "" else opt },
                                    label = { Text(opt, style = Type.body(15.0)) },
                                    colors = FilterChipDefaults.filterChipColors(selectedContainerColor = P.leafSoft, selectedLabelColor = P.ink, labelColor = P.ink),
                                )
                            }
                        }
                    } else {
                        OutlinedTextField(
                            answers[q.key] ?: "", { answers[q.key] = it.take(1500) }, Modifier.fillMaxWidth(),
                            textStyle = Type.body(16.0).copy(color = P.ink), minLines = 2, maxLines = 6,
                            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = P.leaf, unfocusedBorderColor = P.line),
                        )
                    }
                }
            }
            error?.let { Notice(it, Tone.WARN) }
            PrimaryButton("Send feedback", Modifier.fillMaxWidth(), enabled = !sending, busy = sending, onClick = ::send)
        }
    }
}

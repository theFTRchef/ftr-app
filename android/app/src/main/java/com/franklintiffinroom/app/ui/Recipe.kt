package com.franklintiffinroom.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.style.TextAlign
import com.franklintiffinroom.app.R
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
data class RecipeMeta(val label: String, val value: String)

@Serializable
data class Recipe(
    val title: String,
    val subtitle: String? = null,
    val meta: List<RecipeMeta>? = null,
    val notes: List<String>? = null,
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

/** Chef's standard customer recipe-card template (FTR Recipe Cards): Charcoal & Gold. Fixed colours, like the printed card. */
object CG {
    val charcoal = Color(0xFF2E2A26)
    val gold = Color(0xFFD4A84A)
    val sand = Color(0xFFF3EAD8)
    val strip = Color(0xFFE6D3A8)
    val card = Color(0xFFFFFCF5)
    val cardLine = Color(0xFFDCCBA6)
    val dots = Color(0xFFCDBB92)
    val noteLine = Color(0xFFB9954A)
    val stripInk = Color(0xFF5A4A2E)
    val cream = Color(0xFFFBF6EC)
    val creamSoft = Color(0xFFE8DCC2)
}

@Composable
private fun RecipeBody(o: OpenedRecipe, modifier: Modifier, openSurvey: () -> Unit) {
    val r = o.recipe
    val kicker = o.gift?.let { if (it.test) "CHEF'S TEST CODE · REUSABLE" else "FRANKLIN TIFFIN ROOM · GIFT NO. ${it.label}" } ?: "FRANKLIN TIFFIN ROOM · RECIPE"
    val meta = r.meta?.takeIf { it.isNotEmpty() } ?: listOfNotNull(
        r.time?.takeIf { it.isNotEmpty() }?.let { RecipeMeta("Time", it) },
        r.serves?.takeIf { it.isNotEmpty() }?.let { RecipeMeta("Serves", it) },
    )
    val notes = (r.notes ?: emptyList()) + listOfNotNull(r.tip?.takeIf { it.isNotEmpty() })

    BoxWithConstraints(modifier.fillMaxSize().background(CG.sand)) {
        val wide = maxWidth >= 700.dp
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            // Header: seal, kicker, title, italic subtitle, gold rule.
            Column(Modifier.fillMaxWidth().background(CG.charcoal)) {
                Row(Modifier.fillMaxWidth().padding(20.dp).semantics(mergeDescendants = true) { heading() }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Image(painterResource(R.drawable.seal), "Franklin Tiffin Room seal", Modifier.size(80.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(kicker, style = Type.semi(11.0).copy(letterSpacing = 2.5.sp), color = CG.gold)
                        Text(r.title, style = Type.serif(32), color = CG.cream)
                        (r.subtitle ?: r.intro)?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.tagline(16), color = CG.creamSoft) }
                    }
                }
                Box(Modifier.fillMaxWidth().height(5.dp).background(CG.gold))
            }
            if (meta.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().background(CG.strip).padding(horizontal = 14.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    meta.forEach { m ->
                        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(m.label.uppercase(), style = Type.body(11.0).copy(letterSpacing = 2.sp), color = CG.stripInk)
                            Text(m.value, style = Type.serif(17, bold = false), color = CG.charcoal, textAlign = TextAlign.Center)
                        }
                    }
                }
            }

            val ingredients: @Composable () -> Unit = {
                if (r.ingredients.isNotEmpty()) {
                    Column(Modifier.fillMaxWidth().background(CG.card, RoundedCornerShape(12.dp)).border(1.dp, CG.cardLine, RoundedCornerShape(12.dp)).padding(horizontal = 16.dp, vertical = 14.dp)) {
                        Text("Ingredients", style = Type.serif(20), color = CG.charcoal, modifier = Modifier.padding(bottom = 8.dp).semantics { heading() })
                        r.ingredients.forEachIndexed { i, line ->
                            Row(
                                Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}.drawBehind {
                                    drawLine(CG.dots, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f, 4f)))
                                }.padding(vertical = 6.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Text(line, style = Type.body(15.0), color = CG.charcoal, modifier = Modifier.weight(1f))
                                r.amounts?.getOrNull(i)?.takeIf { it.isNotEmpty() }?.let { Text(it, style = Type.bold(15.0), color = CG.charcoal, textAlign = TextAlign.End) }
                            }
                        }
                    }
                }
            }
            val notesBlock: @Composable () -> Unit = {
                if (notes.isNotEmpty()) {
                    Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Chef's notes", style = Type.serif(18), color = CG.charcoal, modifier = Modifier.semantics { heading() })
                        notes.forEach { n ->
                            Row(Modifier.height(IntrinsicSize.Min)) {
                                Box(Modifier.width(3.dp).fillMaxHeight().background(CG.noteLine))
                                Text(n, style = Type.body(15.0), color = CG.charcoal, modifier = Modifier.padding(start = 12.dp))
                            }
                        }
                    }
                }
            }
            val method: @Composable () -> Unit = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Method", style = Type.serif(20), color = CG.charcoal, modifier = Modifier.semantics { heading() })
                    r.steps.forEachIndexed { i, step ->
                        Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(28.dp).background(CG.charcoal, CircleShape).semantics { contentDescription = "Step ${i + 1}" }, contentAlignment = Alignment.Center) {
                                Text("${i + 1}", style = Type.bold(14.0), color = CG.gold)
                            }
                            val cut = step.indexOf(": ")
                            Text(
                                buildAnnotatedString {
                                    if (cut in 1..24) {
                                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(step.substring(0, cut) + ". ") }
                                        append(step.substring(cut + 2))
                                    } else append(step)
                                },
                                style = Type.body(16.0), color = CG.charcoal, modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
            val feedback: @Composable () -> Unit = {
                o.survey?.let { s ->
                    Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("How was it?", style = Type.serif(20), color = CG.charcoal, modifier = Modifier.semantics { heading() })
                        Text(
                            if (s.done) "Thank you for your feedback! You can update it any time."
                            else "Once you've made it, tell Chef what was right and what was wrong. Every answer helps FTR get better.",
                            style = Type.body(15.0), color = CG.stripInk,
                        )
                        androidx.compose.material3.Button(
                            onClick = openSurvey, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(50),
                            colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = CG.charcoal, contentColor = CG.gold),
                        ) { Text(if (s.done) "Update my feedback" else "Share my feedback", style = Type.bold(17.0)) }
                    }
                }
            }

            Box(Modifier.widthIn(max = 980.dp).fillMaxWidth().padding(horizontal = if (wide) 32.dp else 18.dp, vertical = 22.dp)) {
                if (wide) {
                    Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                        Column(Modifier.width(300.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) { ingredients(); notesBlock() }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(18.dp)) { method(); feedback() }
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(22.dp)) { ingredients(); notesBlock(); method(); feedback() }
                }
            }

            // Footer: charcoal bar with the phone number in gold.
            val ctx = LocalContext.current
            Row(Modifier.fillMaxWidth().background(CG.charcoal).padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("100% vegetarian · Somerset, NJ", style = Type.body(13.0), color = CG.cream, modifier = Modifier.weight(1f))
                Text(
                    "1-234-FTR-DOSE", style = Type.serif(17), color = CG.gold,
                    modifier = Modifier.clickable(onClickLabel = "Call FTR") { Intents.dial(ctx, "+12343873673") }.padding(4.dp),
                )
            }
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

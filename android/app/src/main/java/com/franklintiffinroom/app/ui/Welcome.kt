package com.franklintiffinroom.app.ui

import android.provider.Settings
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.R
import com.franklintiffinroom.app.core.AppModel
import kotlin.math.pow

/**
 * The first screen: the FTR seal draws itself in, a lotus opens under folded hands
 * ("Namaste, welcome to FTR"), then the Enter FTR button rises in. Plays once; tap to skip.
 * Static when the phone's animations are turned off. Same choreography as the iPhone app.
 */
@Composable
fun WelcomeScreen(model: AppModel, enter: () -> Unit) {
    // No connection yet (phone just woke up, weak signal): keep trying quietly.
    LaunchedEffect(model.loadError, model.config) {
        while (model.config == null && model.loadError != null) {
            kotlinx.coroutines.delay(5000)
            model.loadMenu()
        }
    }
    val ctx = LocalContext.current
    val still = remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
    var t by remember { mutableFloatStateOf(if (still) Welcome.END else 0f) }
    LaunchedEffect(Unit) {
        if (t >= Welcome.END) return@LaunchedEffect
        val start = withFrameNanos { it }
        while (t < Welcome.END) {
            val now = withFrameNanos { it }
            t = ((now - start) / 1e9f).coerceAtMost(Welcome.END)
        }
    }
    val tl = Welcome(t)

    BoxWithConstraints(
        Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, indication = null) { t = Welcome.END },
    ) {
        val seal = min(min(270.dp, maxWidth - 96.dp), maxHeight * 0.36f)
        Column(Modifier.fillMaxSize().padding(horizontal = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.weight(1f))
            Column(
                Modifier.graphicsLayer { alpha = tl.hello; translationY = (1 - tl.hello) * 8.dp.toPx() }
                    .semantics(mergeDescendants = true) { contentDescription = "Namaste, welcome to FTR" },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                LotusNamaste(tl, Modifier.size(92.dp, 87.dp))
                Text("Namaste", style = Type.tagline(30), color = P.ink)
                Text("WELCOME TO FTR", style = Type.body(13.0).copy(fontFamily = Type.josefin, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, letterSpacing = 3.sp), color = P.muted)
            }
            Spacer(Modifier.height(26.dp))
            AnimatedSeal(tl, Modifier.size(seal))
            Spacer(Modifier.height(28.dp))
            Text("Multi-cuisine personal chef in Somerset, NJ", style = Type.tagline(17), color = P.muted, textAlign = TextAlign.Center)
            Spacer(Modifier.height(10.dp))
            VegMark()
            Spacer(Modifier.weight(1f))
            Column(
                Modifier.graphicsLayer { alpha = tl.button; translationY = (1 - tl.button) * 10.dp.toPx() },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val err = model.loadError
                if (err != null && model.config == null) {
                    Text(err, style = Type.body(15.0), color = P.muted, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(12.dp))
                    SecondaryButton("Try again", enabled = tl.button > 0.5f) { model.reloadMenu() }
                } else {
                    PrimaryButton("Enter FTR", enabled = model.config != null && tl.button > 0.5f, busy = model.config == null, onClick = enter)
                }
            }
            Spacer(Modifier.height(48.dp))
        }
    }
}

/** Where each part of the welcome animation is at time [t] (seconds). */
class Welcome(private val t: Float) {
    companion object { const val END = 5.4f }

    private fun p(a: Float, b: Float): Float {
        val x = ((t - a) / (b - a)).coerceIn(0f, 1f)
        return 1 - (1 - x).pow(3)
    }
    private fun ease(a: Float, b: Float): Float {
        val x = ((t - a) / (b - a)).coerceIn(0f, 1f)
        return if (x < 0.5f) 4 * x * x * x else 1 - (-2 * x + 2).pow(3) / 2
    }

    val outlineDraw get() = ease(0f, 1.55f)
    val outlineOpacity get() = 1 - p(1.55f, 2.2f)
    val fill get() = p(1.45f, 2.2f)
    val words get() = p(2.1f, 2.85f)
    val ftrOpacity get() = p(2.75f, 3.2f)
    val ftrOffset get() = when {
        t < 2.75f -> 14f
        t < 3.25f -> 14f - 16f * p(2.75f, 3.25f)
        else -> -2f + 2f * p(3.25f, 3.6f)
    }
    val ftrScale get() = when {
        t < 2.75f -> 0.9f
        t < 3.25f -> 0.9f + 0.13f * p(2.75f, 3.25f)
        else -> 1.03f - 0.03f * p(3.25f, 3.6f)
    }
    val since get() = p(3.6f, 4.2f)
    val hello get() = p(3.3f, 3.65f)
    val petalCenter get() = p(3.4f, 3.75f)
    val petalSide get() = p(3.45f, 3.9f)
    val petalOuter get() = p(3.55f, 4.05f)
    val hands get() = ease(3.85f, 4.6f)
    val button get() = p(4.5f, 5.1f)
}

/** The seal, built from its layers so each part can arrive on its own. */
@Composable
fun AnimatedSeal(tl: Welcome, modifier: Modifier = Modifier) {
    val charcoal = P.forest
    Box(modifier.clearAndSetSemantics { contentDescription = "FTR seal: Franklin Tiffin Room, since 2025, NJ USA, bringing back the OG flavor of Masale Dose" }) {
        val layer = Modifier.fillMaxSize()
        Image(painterResource(R.drawable.seal_ring), null, layer.graphicsLayer { alpha = tl.fill })
        Image(painterResource(R.drawable.seal_words), null, layer.graphicsLayer { alpha = tl.words })
        Image(painterResource(R.drawable.seal_disc), null, layer.graphicsLayer { alpha = tl.fill })
        Image(painterResource(R.drawable.seal_ftr), null, layer.graphicsLayer {
            alpha = tl.ftrOpacity
            scaleX = tl.ftrScale; scaleY = tl.ftrScale
            transformOrigin = TransformOrigin(0.5f, 130f / 300f)
            translationY = tl.ftrOffset * size.width / 300f
        })
        Image(painterResource(R.drawable.seal_since), null, layer.graphicsLayer { alpha = tl.since })
        Canvas(layer) {
            val s = size.width / 300f
            if (tl.outlineOpacity > 0f && tl.outlineDraw > 0f) {
                drawArc(
                    charcoal.copy(alpha = tl.outlineOpacity), startAngle = 0f, sweepAngle = 360f * tl.outlineDraw, useCenter = false,
                    topLeft = Offset(4 * s, 4 * s), size = Size(292 * s, 292 * s), style = Stroke(width = 3 * s, cap = StrokeCap.Round),
                )
            }
        }
    }
}

private fun svg(d: String): Path = PathParser().parsePathString(d).toPath()

private val hands = listOf(
    "M32 6 C27 12 23 24 21 36 C20 44 21 50 24 56 L23 66",
    "M32 6 C37 12 41 24 43 36 C44 44 43 50 40 56 L41 66",
    "M32 9 V58",
    "M30 40 C26 42 24 46 25 52",
    "M34 40 C38 42 40 46 39 52",
).map(::svg)
private val petalC = svg("M55 100 C47 90 47 78 55 68 C63 78 63 90 55 100 Z")
private val petalL = svg("M55 100 C40 98 30 88 28 76 C40 78 50 86 55 100 Z")
private val petalR = svg("M55 100 C70 98 80 88 82 76 C70 78 60 86 55 100 Z")
private val petalLL = svg("M55 100 C36 102 18 96 10 86 C26 84 44 90 55 100 Z")
private val petalRR = svg("M55 100 C74 102 92 96 100 86 C84 84 66 90 55 100 Z")

/** Folded hands drawn in gold, rising from a lotus whose petals open. */
@Composable
fun LotusNamaste(tl: Welcome, modifier: Modifier = Modifier) {
    Canvas(modifier.clearAndSetSemantics { }) {
        val k = minOf(size.width / 110f, size.height / 104f)
        scale(k, k, pivot = Offset.Zero) {
            val origin = Offset(55f, 100f)
            fun petal(path: Path, color: Long, amount: Float, rotate: Float, scaleFrom: Float, alpha: Float) {
                if (amount <= 0f) return
                val sc = scaleFrom + (1 - scaleFrom) * amount
                rotate(rotate * (1 - amount), pivot = origin) {
                    scale(sc, sc, pivot = origin) {
                        drawPath(path, Color(0xFF000000 or color), alpha = amount * alpha)
                    }
                }
            }
            petal(petalLL, 0xA4483F, tl.petalOuter, 60f, 0.4f, 0.75f)
            petal(petalRR, 0xA4483F, tl.petalOuter, -60f, 0.4f, 0.75f)
            petal(petalL, 0xD9A99A, tl.petalSide, 40f, 0.4f, 1f)
            petal(petalR, 0xD9A99A, tl.petalSide, -40f, 0.4f, 1f)
            petal(petalC, 0xE7C9BD, tl.petalCenter, 0f, 0.2f, 1f)

            if (tl.hands > 0f) {
                translate(23f, 0f) {
                    val measure = PathMeasure()
                    for (h in hands) {
                        measure.setPath(h, false)
                        val part = Path()
                        measure.getSegment(0f, measure.length * tl.hands, part, true)
                        drawPath(part, Color(0xFF9C7220), style = Stroke(width = 2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    }
                }
            }
        }
    }
}

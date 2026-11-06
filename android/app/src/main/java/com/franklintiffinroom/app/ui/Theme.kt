package com.franklintiffinroom.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.R
import com.franklintiffinroom.app.core.Order

/** FTR brand palette - from the catering flyers: cream paper, forest green, chili red, marigold. Same as the iPhone app. */
data class FtrColors(
    val bg: Color, val surface: Color, val surface2: Color, val line: Color, val ink: Color, val muted: Color,
    val red: Color, val forest: Color, val cream: Color, val leaf: Color, val leafInk: Color, val leafSoft: Color,
    val turmeric: Color, val turmericSoft: Color, val turmericInk: Color, val goldLine: Color, val chili: Color,
    val chiliSoft: Color, val bad: Color, val veg: Color,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightColors = FtrColors(
    bg = c(0xFFFBF3), surface = c(0xFFFFFF), surface2 = c(0xF6EEDD), line = c(0xE8DCC4), ink = c(0x1E3A27), muted = c(0x4A5A4E),
    red = c(0xC8463F), forest = c(0x1E3A27), cream = c(0xFFF6E6), leaf = c(0x1E3A27), leafInk = c(0xFFF6E6), leafSoft = c(0xE6EDE4),
    turmeric = c(0xF2C14E), turmericSoft = c(0xFBEFD0), turmericInk = c(0x7A5200), goldLine = c(0xE3A72F), chili = c(0xC8463F),
    chiliSoft = c(0xF8DDD6), bad = c(0xB23A2C), veg = c(0x2E7D3A),
)
val DarkColors = FtrColors(
    bg = c(0x111A14), surface = c(0x18241C), surface2 = c(0x213027), line = c(0x2F3F34), ink = c(0xFFF6E6), muted = c(0xB3BCAF),
    red = c(0xE8675E), forest = c(0x1E3A27), cream = c(0xFFF6E6), leaf = c(0xF2C14E), leafInk = c(0x1E3A27), leafSoft = c(0x22362A),
    turmeric = c(0xF2C14E), turmericSoft = c(0x3A2F14), turmericInk = c(0xF6D38A), goldLine = c(0xE3A72F), chili = c(0xE8675E),
    chiliSoft = c(0x43231D), bad = c(0xF08A7C), veg = c(0x6CC196),
)

val LocalFtr = staticCompositionLocalOf { LightColors }
val P: FtrColors @Composable get() = LocalFtr.current

/** The flyer type: Fraunces for headings, Outfit for reading, Josefin Sans for the logo. */
object Type {
    val fraunces = FontFamily(Font(R.font.fraunces_bold, FontWeight.Bold), Font(R.font.fraunces_semibolditalic, FontWeight.SemiBold, FontStyle.Italic))
    val outfit = FontFamily(
        Font(R.font.outfit_regular, FontWeight.Normal), Font(R.font.outfit_medium, FontWeight.Medium),
        Font(R.font.outfit_semibold, FontWeight.SemiBold), Font(R.font.outfit_bold, FontWeight.Bold),
    )
    val josefin = FontFamily(Font(R.font.josefinsans_semibold, FontWeight.SemiBold), Font(R.font.josefinsans_bold, FontWeight.Bold))

    fun display(size: Int) = TextStyle(fontFamily = fraunces, fontWeight = FontWeight.Bold, fontSize = size.sp, lineHeight = (size * 1.18).sp)
    fun tagline(size: Int) = TextStyle(fontFamily = fraunces, fontWeight = FontWeight.SemiBold, fontStyle = FontStyle.Italic, fontSize = size.sp)
    fun body(size: Double = 16.0, weight: FontWeight = FontWeight.Normal) = TextStyle(fontFamily = outfit, fontWeight = weight, fontSize = size.sp, lineHeight = (size * 1.35).sp)
    fun semi(size: Double = 16.0) = body(size, FontWeight.SemiBold)
    fun bold(size: Double = 16.0) = body(size, FontWeight.Bold)
}

@Composable
fun FtrTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) DarkColors else LightColors
    val scheme = if (dark) darkColorScheme(primary = colors.leaf, onPrimary = colors.leafInk, background = colors.bg, surface = colors.surface, onSurface = colors.ink, onBackground = colors.ink, secondaryContainer = colors.leafSoft, surfaceVariant = colors.surface2, outline = colors.line, error = colors.bad)
    else lightColorScheme(primary = colors.leaf, onPrimary = colors.leafInk, background = colors.bg, surface = colors.surface, onSurface = colors.ink, onBackground = colors.ink, secondaryContainer = colors.leafSoft, surfaceVariant = colors.surface2, outline = colors.line, error = colors.bad)
    CompositionLocalProvider(LocalFtr provides colors) {
        MaterialTheme(colorScheme = scheme, typography = MaterialTheme.typography.copy(
            bodyLarge = Type.body(16.0), bodyMedium = Type.body(15.0), labelLarge = Type.semi(15.0), titleMedium = Type.semi(17.0),
        ), content = content)
    }
}

// MARK: buttons

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled && !busy,
        modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = P.leaf, contentColor = P.leafInk, disabledContainerColor = P.leaf.copy(alpha = 0.4f), disabledContentColor = P.leafInk),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = P.leafInk, strokeWidth = 2.dp)
        else Text(text, style = Type.bold(17.0))
    }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color? = null, icon: ImageVector? = null, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = P.leafSoft, contentColor = color ?: P.leaf, disabledContainerColor = P.leafSoft.copy(alpha = 0.5f), disabledContentColor = (color ?: P.leaf).copy(alpha = 0.5f)),
        contentPadding = PaddingValues(horizontal = 14.dp),
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = Type.semi(16.0))
    }
}

// MARK: brand pieces

/** The FTR logo as on the flyers: "FRANKLIN" in red under a red corner bracket, "TIFFIN ROOM" on a forest-green pill. */
@Composable
fun FtrLogo(size: Int = 32) {
    val s = size.toFloat()
    val red = P.red
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy((s * 0.13f).dp),
        modifier = Modifier.semantics { contentDescription = "Franklin Tiffin Room" }) {
        Box(Modifier.drawBracket(red, s).padding(top = (s * 0.13f).dp, end = (s * 0.26f).dp)) {
            Text("FRANKLIN", style = TextStyle(fontFamily = Type.josefin, fontWeight = FontWeight.SemiBold, fontSize = s.sp, letterSpacing = 0.065.em), color = red)
        }
        Box(Modifier.background(P.forest, RoundedCornerShape((s * 0.22f).dp)).padding(start = (s * 0.39f).dp, end = (s * 0.39f).dp, top = (s * 0.15f).dp, bottom = (s * 0.09f).dp)) {
            Text("TIFFIN ROOM", style = TextStyle(fontFamily = Type.josefin, fontWeight = FontWeight.Bold, fontSize = (s * 0.48f).sp, letterSpacing = 0.09.em), color = P.cream)
        }
    }
}

/** Top edge and right edge, like the flyer's border-top + border-right. */
private fun Modifier.drawBracket(color: Color, s: Float): Modifier = this.drawBehind {
    val sw = maxOf(1.5.dp.toPx(), (s * 0.11f).dp.toPx())
    val w = size.width
    val h = size.height
    drawLine(color, Offset(0f, sw / 2), Offset(w - sw / 2, sw / 2), sw, StrokeCap.Square)
    drawLine(color, Offset(w - sw / 2, sw / 2), Offset(w - sw / 2, h * 0.92f), sw, StrokeCap.Square)
}

@Composable
fun BrandMark(size: Int = 34) {
    val cream = P.cream
    Box(Modifier.size(size.dp).background(P.forest, RoundedCornerShape((size * 0.24f).dp)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
        Text("FTR", style = TextStyle(fontFamily = Type.josefin, fontWeight = FontWeight.Bold, fontSize = (size * 0.38f).sp), color = cream, modifier = Modifier.padding(top = (size * 0.12f).dp))
        Canvas(Modifier.size(size.dp)) {
            val w = this.size.width
            val stroke = maxOf(1.5f, w * 0.07f)
            val col = Color(0xFFE8675E)
            drawLine(col, Offset(w * 0.56f, w * 0.16f), Offset(w * 0.85f, w * 0.16f), stroke, StrokeCap.Square)
            drawLine(col, Offset(w * 0.85f, w * 0.16f), Offset(w * 0.85f, w * 0.34f), stroke, StrokeCap.Square)
        }
    }
}

/** The flyers' "100% Vegetarian" mark. */
@Composable
fun VegMark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(18.dp).border(2.dp, P.veg, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) {
            Box(Modifier.size(8.dp).background(P.veg, CircleShape))
        }
        Text("100% Vegetarian", style = Type.semi(13.0), color = P.ink)
    }
}

@Composable
fun Panel(modifier: Modifier = Modifier, padding: Dp = 16.dp, borderColor: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxWidth().background(P.surface, RoundedCornerShape(18.dp)).border(1.dp, borderColor ?: P.line, RoundedCornerShape(18.dp)).padding(padding),
        verticalArrangement = Arrangement.spacedBy(12.dp), content = content,
    )
}

enum class Tone { INFO, WARN, BAD }

@Composable
fun Notice(text: String, tone: Tone = Tone.INFO, icon: ImageVector = Icons.Outlined.Info, modifier: Modifier = Modifier) {
    val fg = when (tone) { Tone.INFO -> P.leaf; Tone.WARN -> P.turmericInk; Tone.BAD -> P.bad }
    val bg = when (tone) { Tone.INFO -> P.leafSoft; Tone.WARN -> P.turmericSoft; Tone.BAD -> P.chiliSoft }
    Row(modifier.fillMaxWidth().background(bg, RoundedCornerShape(12.dp)).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(20.dp))
        Text(text, style = Type.body(15.0), color = P.ink)
    }
}

@Composable
fun Pill(text: String, fg: Color, bg: Color, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Row(modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = fg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp)) }
        Text(text, style = Type.semi(13.0), color = fg, maxLines = 1)
    }
}

@Composable
fun StatusPill(order: Order) {
    val label = when (order.stage) {
        "deposit_due" -> "Deposit due"
        "quote_ready" -> "Quote ready"
        "deposit_review" -> "Checking deposit"
        "confirmed" -> if (order.isPast) "Past order" else "Confirmed"
        "closed" -> if ("Released" in order.status) "Released" else if ("Cancelled" in order.status) "Cancelled" else "Not booked"
        "quote_requested" -> "Awaiting quote"
        else -> "With Chef"
    }
    val (fg, bg) = when (order.stage) {
        "deposit_due", "quote_ready" -> P.turmericInk to P.turmericSoft
        "confirmed" -> P.leaf to P.leafSoft
        "closed" -> P.bad to P.chiliSoft
        else -> P.muted to P.surface2
    }
    Pill(label, fg, bg)
}

/** Text field in the FTR style (white card, cream border). */
@Composable
fun Field(
    value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier,
    minLines: Int = 1, maxLines: Int = 1, style: TextStyle = Type.body(16.0), keyboard: KeyboardOptions = KeyboardOptions.Default,
    enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value, onValueChange = onChange, modifier = modifier.fillMaxWidth(), enabled = enabled,
        placeholder = { Text(placeholder, style = style, color = P.muted) }, textStyle = style.copy(color = P.ink),
        minLines = minLines, maxLines = maxOf(minLines, maxLines), singleLine = maxLines == 1 && minLines == 1,
        keyboardOptions = keyboard, shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = P.surface, unfocusedContainerColor = P.surface, disabledContainerColor = P.surface2,
            focusedBorderColor = P.leaf, unfocusedBorderColor = P.line, cursorColor = P.leaf,
        ),
    )
}

@Composable
fun SectionTitle(text: String, color: Color = P.ink, size: Int = 22) {
    Text(text, style = Type.display(size), color = color)
}

val CardShape = RoundedCornerShape(16.dp)
fun Modifier.card(bg: Color, line: Color, shape: RoundedCornerShape = CardShape) = this.background(bg, shape).border(BorderStroke(1.dp, line), shape)

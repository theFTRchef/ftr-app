package com.franklintiffinroom.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
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

/** FTR brand palette - "Warm Sand": sand paper, cocoa ink, soft brick buttons, with the charcoal + gold of the FTR seal. Same as the iPhone app. */
data class FtrColors(
    val bg: Color, val surface: Color, val surface2: Color, val photo: Color, val line: Color, val ink: Color, val muted: Color,
    val red: Color, val forest: Color, val cream: Color, val beige: Color, val leaf: Color, val leafInk: Color, val leafSoft: Color,
    val sage: Color, val sageSoft: Color,
    val turmeric: Color, val turmericSoft: Color, val turmericInk: Color, val gold: Color, val deepGold: Color, val goldLine: Color, val chili: Color,
    val chiliSoft: Color, val bad: Color, val veg: Color,
)

private fun c(hex: Long) = Color(0xFF000000 or hex)

val LightColors = FtrColors(
    bg = c(0xF7F1E8), surface = c(0xFFFDF9), surface2 = c(0xEEE6D8), photo = c(0xE9DFCF), line = c(0xE4D8C6), ink = c(0x3E2C28), muted = c(0x6E5D55),
    red = c(0xA4483F), forest = c(0x2E2A26), cream = c(0xF3EBDD), beige = c(0xEFE3CC), leaf = c(0xA4483F), leafInk = c(0xFFFFFF), leafSoft = c(0xF3DED9),
    sage = c(0x4F6B57), sageSoft = c(0xE3EADF),
    turmeric = c(0xB9954A), turmericSoft = c(0xF1E2C4), turmericInk = c(0x6B4A1E), gold = c(0xE9C77B), deepGold = c(0x9C7220), goldLine = c(0xB9954A), chili = c(0xA4483F),
    chiliSoft = c(0xF3DED9), bad = c(0x9E3A2E), veg = c(0x4F6B57),
)
val DarkColors = FtrColors(
    bg = c(0x1F1B18), surface = c(0x2A2521), surface2 = c(0x35302B), photo = c(0x3A342E), line = c(0x433C35), ink = c(0xF3EBDD), muted = c(0xBFB2A3),
    red = c(0xE08A7E), forest = c(0x2E2A26), cream = c(0xF3EBDD), beige = c(0xEFE3CC), leaf = c(0xE08A7E), leafInk = c(0x2E2A26), leafSoft = c(0x432823),
    sage = c(0x9CC0A6), sageSoft = c(0x26332A),
    turmeric = c(0xD9B76A), turmericSoft = c(0x3A2F1A), turmericInk = c(0xE9C77B), gold = c(0xE9C77B), deepGold = c(0x9C7220), goldLine = c(0xB9954A), chili = c(0xE08A7E),
    chiliSoft = c(0x43231D), bad = c(0xF08A7C), veg = c(0x9CC0A6),
)

val LocalFtr = staticCompositionLocalOf { LightColors }
val P: FtrColors @Composable get() = LocalFtr.current

/** Warm Sand type: Oswald Medium headlines, Archivo for reading, Fraunces italic slogan, Josefin Sans brand lettering. */
object Type {
    val oswald = FontFamily(Font(R.font.oswald_medium, FontWeight.Medium))
    val fraunces = FontFamily(Font(R.font.fraunces_mediumitalic, FontWeight.Medium, FontStyle.Italic))
    /** Fraunces upright, for Chef's Charcoal & Gold recipe cards. */
    val serif = FontFamily(Font(R.font.fraunces_semibold, FontWeight.SemiBold), Font(R.font.fraunces_bold, FontWeight.Bold))
    fun serif(size: Int, bold: Boolean = true) = TextStyle(fontFamily = serif, fontWeight = if (bold) FontWeight.Bold else FontWeight.SemiBold, fontSize = size.sp, lineHeight = (size * 1.15).sp)
    /** Softer than before: Bold maps to Archivo SemiBold, SemiBold to Archivo Medium. */
    val archivo = FontFamily(
        Font(R.font.archivo_regular, FontWeight.Normal), Font(R.font.archivo_medium, FontWeight.Medium),
        Font(R.font.archivo_medium, FontWeight.SemiBold), Font(R.font.archivo_semibold, FontWeight.Bold),
    )
    val josefin = FontFamily(Font(R.font.josefinsans_semibold, FontWeight.SemiBold), Font(R.font.josefinsans_bold, FontWeight.Bold))

    fun display(size: Int) = TextStyle(fontFamily = oswald, fontWeight = FontWeight.Medium, fontSize = size.sp, lineHeight = (size * 1.15).sp)
    fun tagline(size: Int) = TextStyle(fontFamily = fraunces, fontWeight = FontWeight.Medium, fontStyle = FontStyle.Italic, fontSize = size.sp)
    fun body(size: Double = 16.0, weight: FontWeight = FontWeight.Normal) = TextStyle(fontFamily = archivo, fontWeight = weight, fontSize = size.sp, lineHeight = (size * 1.4).sp)
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
        shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = P.leaf, contentColor = P.leafInk, disabledContainerColor = P.leaf.copy(alpha = 0.4f), disabledContentColor = P.leafInk),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(22.dp), color = P.leafInk, strokeWidth = 2.dp)
        else Text(text, style = Type.bold(16.0))
    }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color? = null, icon: ImageVector? = null, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled,
        modifier = modifier.fillMaxWidth().heightIn(min = 48.dp),
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.dp, P.line),
        colors = ButtonDefaults.buttonColors(containerColor = P.surface, contentColor = color ?: P.ink, disabledContainerColor = P.surface.copy(alpha = 0.5f), disabledContentColor = (color ?: P.ink).copy(alpha = 0.5f)),
        contentPadding = PaddingValues(horizontal = 14.dp),
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
        Text(text, style = Type.semi(16.0))
    }
}

// MARK: brand pieces

/** The FTR kitchen seal. `size` is kept from the old wordmark (its letter height); the seal is about 3x that wide. */
@Composable
fun FtrLogo(size: Int = 32) {
    Image(
        painterResource(R.drawable.seal), "Franklin Tiffin Room seal, since 2025, NJ USA",
        Modifier.size((size * 3.1f).dp), contentScale = ContentScale.Fit,
    )
}

/** Header lockup from the new design: small seal, name, slogan. */
@Composable
fun FtrHeader(modifier: Modifier = Modifier) {
    Row(modifier.semantics(mergeDescendants = true) { contentDescription = "Franklin Tiffin Room, bringing back the OG flavor of Masale Dose" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BrandMark(54)
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("FRANKLIN TIFFIN ROOM", style = Type.display(17).copy(letterSpacing = 1.2.sp, lineHeight = 18.sp), color = P.ink)
            Text("bringing back the OG flavor of Masale Dose", style = Type.tagline(13), color = P.muted)
        }
    }
}

/** Small FTR seal for tight spots (toolbar, message avatars). */
@Composable
fun BrandMark(size: Int = 34) {
    Image(painterResource(R.drawable.seal_badge), null, Modifier.size(size.dp).clearAndSetSemantics { })
}

/** The flyers' "100% Vegetarian" mark. */
@Composable
fun VegMark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(18.dp).border(2.dp, P.veg, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) {
            Box(Modifier.size(8.dp).background(P.veg, CircleShape))
        }
        Text("100% Vegetarian", style = Type.semi(13.0), color = P.sage)
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
    val fg = when (tone) { Tone.INFO -> P.sage; Tone.WARN -> P.turmericInk; Tone.BAD -> P.bad }
    val bg = when (tone) { Tone.INFO -> P.sageSoft; Tone.WARN -> P.turmericSoft; Tone.BAD -> P.chiliSoft }
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
        "confirmed" -> P.sage to P.sageSoft
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

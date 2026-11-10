package com.franklintiffinroom.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.Dish
import com.franklintiffinroom.app.core.Money

// Chef's picks and limited availability. Chef promotes dishes in Chef's Kitchen
// (Menu › Promote dishes); they show at the top of Home and every dish row shows a
// "Chef's pick" or "Limited" tag. Same as the iPhone app (ChefPicks.swift).

/** "★ CHEF'S PICK" and "LIMITED · Only 10 trays" tags on a dish. */
@Composable
fun DishTags(dish: Dish) {
    Row(Modifier.semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (dish.promoted) Tag("★ CHEF'S PICK", P.turmericInk, P.turmericSoft)
        if (dish.limited) Tag(dish.limitedNote?.let { "LIMITED · $it" } ?: "LIMITED", P.bad, P.bad.copy(alpha = 0.12f))
    }
}

@Composable
private fun Tag(text: String, fg: androidx.compose.ui.graphics.Color, bg: androidx.compose.ui.graphics.Color) {
    Text(
        text, style = Type.bold(11.0).copy(letterSpacing = 0.5.sp), color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis,
        modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

private data class Pick(val dish: Dish, val categoryId: String, val section: String)

/** Chef's picks on Home: a card per promoted dish; tapping opens its menu section. */
@Composable
fun ChefPicksCard(model: AppModel, open: (String) -> Unit) {
    val picks = model.categories.filter { it.isCatering }.flatMap { c -> c.items.filter { it.promoted }.map { Pick(it, c.id, c.title) } }
    if (picks.isEmpty()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("CHEF'S PICKS", style = Type.display(20), color = P.ink, modifier = Modifier.semantics { heading() })
        picks.firstNotNullOfOrNull { it.dish.promoNote?.takeIf { n -> n.isNotEmpty() } }?.let { Text(it, style = Type.tagline(15), color = P.muted) }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            picks.forEach { p ->
                Column(
                    Modifier.width(190.dp).height(150.dp)
                        .background(P.surface, RoundedCornerShape(18.dp)).border(1.5.dp, P.goldLine, RoundedCornerShape(18.dp))
                        .clickable(onClickLabel = "Open ${p.section}") { open(p.categoryId) }.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("★ CHEF'S PICK", style = Type.bold(11.0).copy(letterSpacing = 0.5.sp), color = P.turmericInk)
                    Text(p.dish.title.uppercase(), style = Type.display(17), color = P.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(p.section, style = Type.body(13.0), color = P.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Spacer(Modifier.weight(1f))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(Money.text(p.dish.price), style = Type.bold(15.0), color = P.ink, modifier = Modifier.weight(1f))
                        if (p.dish.limited) Tag("LIMITED", P.bad, P.bad.copy(alpha = 0.12f))
                    }
                    if (p.dish.limited) p.dish.limitedNote?.let { Text(it, style = Type.semi(12.0), color = P.bad, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                }
            }
        }
    }
}

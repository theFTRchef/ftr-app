package com.franklintiffinroom.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Comment
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.ShoppingBasket
import androidx.compose.material.icons.filled.TakeoutDining
import androidx.compose.material.icons.filled.WineBar
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.TakeoutDining
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.franklintiffinroom.app.R
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.Image
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.AvailabilityResponse
import com.franklintiffinroom.app.core.Dish
import com.franklintiffinroom.app.core.MenuCategory
import com.franklintiffinroom.app.core.Money
import com.franklintiffinroom.app.core.OpenDate
import com.franklintiffinroom.app.core.PreorderDay
import com.franklintiffinroom.app.core.Qty
import com.franklintiffinroom.app.core.Tab

// MARK: home

/** Which Home button a menu section sits under (same rule as the iPhone app). */
enum class MenuGroup(val title: String, val empty: String) {
    CATERING("Catering Items", "Chef is updating the menu. Please check back soon."),
    SPECIALS("Chef's Weekly Specials", "Chef's Weekly Specials are coming soon."),
    FESTIVAL("Festival Specials", "No festival specials right now. Chef will announce the next festival menu in Notifications."),
    DRY("Dry Products", "Chef's masala powders and other dry products are coming soon.");

    fun sections(all: List<MenuCategory>): List<MenuCategory> = all.filter { c ->
        if (!c.isCatering || c.preorder?.flagship == true) return@filter false
        when (this) {
            FESTIVAL -> c.section == "festival"
            DRY -> c.section == "dry"
            SPECIALS -> c.section == null && c.preorder != null
            CATERING -> c.section == null && c.preorder == null && c.items.isNotEmpty()
        }
    }
}

@Composable
fun HomeScreen(model: AppModel, nav: Nav) {
    val ctx = LocalContext.current
    var showLiveDose by remember { mutableStateOf(false) }
    var showCustom by remember { mutableStateOf(false) }
    var showCart by remember { mutableStateOf(false) }
    var showFeedback by remember { mutableStateOf(false) }
    var comingSoon by remember { mutableStateOf<String?>(null) }

    val cats = model.categories
    val lds = cats.firstOrNull { it.isLds }
    val dib = cats.firstOrNull { it.preorder?.flagship == true }
    val specials = MenuGroup.SPECIALS.sections(cats)
    val festival = MenuGroup.FESTIVAL.sections(cats)
    val dry = MenuGroup.DRY.sections(cats)

    fun subtitle(list: List<MenuCategory>, filled: String): String {
        if (list.none { it.items.isNotEmpty() }) return "Coming soon"
        list.firstNotNullOfOrNull { it.preorder?.next }?.let { return "Order by ${it.orderByLabel} · pickup ${it.label}" }
        return if (list.size == 1) list[0].subtitle.ifEmpty { filled } else filled
    }
    fun open(group: MenuGroup, list: List<MenuCategory>) = nav.push(if (list.size == 1) Screen.Category(list[0].id) else Screen.Sections(group))

    TabScreen(
        title = "",
        navigationIcon = { IconButton(onClick = { Intents.share(ctx, "Franklin Tiffin Room", shareMessage(model.config?.phoneDisplay, model.config?.phoneDial)) }) { Icon(Icons.Outlined.Share, "Share FTR", tint = P.leaf) } },
        actions = { model.config?.phoneDial?.let { dial -> IconButton(onClick = { Intents.dial(ctx, dial) }) { Icon(Icons.Outlined.Phone, "Call Chef", tint = P.leaf) } } },
        bottomBar = { if (!model.cart.isEmpty) CartBar(model) { showCart = true } },
    ) { pad ->
        RefreshColumn(pad, onRefresh = { model.loadMenu() }, spacing = 18) {
            FtrHeader()

            // Flagship first, full width.
            Column(
                Modifier.fillMaxWidth().card(P.surface, P.line, RoundedCornerShape(24.dp)).clip(RoundedCornerShape(24.dp))
                    .clickable(enabled = lds != null) { showLiveDose = true },
            ) {
                Box(Modifier.fillMaxWidth().aspectRatio(4f / 3f).background(P.photo)) {
                    Image(
                        painterResource(R.drawable.flagship_dose), "Chef cooking Mysore Masala Dose on the griddle at a party",
                        Modifier.fillMaxSize(), contentScale = ContentScale.Crop,
                    )
                    Text("OUR FLAGSHIP", style = Type.bold(11.0).copy(letterSpacing = 0.8.sp), color = P.turmericInk,
                        modifier = Modifier.padding(12.dp).background(P.turmericSoft, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 5.dp))
                }
                Column(Modifier.padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("THE OG MYSORE MASALA DOSE", style = Type.display(28), color = P.ink)
                    Text(if (lds?.open == false) "No LIVE Dose dates open right now" else "Cooked live at your party by Chef's crew. 100% vegetarian.", style = Type.body(14.0), color = P.muted)
                    Text("Book the LIVE Dose Station", style = Type.bold(14.0), color = P.leafInk,
                        modifier = Modifier.padding(top = 4.dp).background(P.leaf, RoundedCornerShape(50)).padding(horizontal = 18.dp, vertical = 12.dp))
                }
            }

            ChefPicksCard(model) { nav.push(Screen.Category(it)) }

            if (dib != null) {
                Row(
                    Modifier.fillMaxWidth().background(P.surface2, RoundedCornerShape(22.dp)).clip(RoundedCornerShape(22.dp))
                        .clickable { nav.push(Screen.Category(dib.id)) }.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Box(Modifier.size(86.dp).background(P.photo, RoundedCornerShape(16.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Inventory2, null, tint = P.muted, modifier = Modifier.size(30.dp))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("TAKE-HOME · SERVES 4", style = Type.bold(11.0).copy(letterSpacing = 1.sp), color = P.red)
                        Text(dib.title.uppercase(), style = Type.display(22), color = P.ink)
                        val sub = if (dib.items.isEmpty()) "Take-home Masala Dose kit · coming soon"
                        else dib.preorder?.next?.let { "Order by ${it.orderByLabel} · pickup ${it.pickupLabel}" } ?: "Next pickup day coming soon"
                        Text(sub, style = Type.body(13.0), color = P.muted)
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = P.ink)
                }
            }

            val tiles = listOf<@Composable (Modifier) -> Unit>(
                { m -> HomeTile("Catering Items", "Trays for your gathering", Icons.Filled.TakeoutDining, m) { nav.push(Screen.Sections(MenuGroup.CATERING)) } },
                { m ->
                    val specialsSub = when {
                        specials.none { it.items.isNotEmpty() } -> "Coming soon"
                        else -> specials.firstNotNullOfOrNull { it.preorder?.next }?.let { "Order by ${it.orderByLabel} · pickup ${it.label}" } ?: "Single-serve takeout · next pickup soon"
                    }
                    HomeTile(if (specials.size == 1) specials[0].title else "Chef's Weekly Specials", specialsSub, Icons.Filled.Restaurant, m) { open(MenuGroup.SPECIALS, specials) }
                },
                { m -> HomeTile("Festival Specials", subtitle(festival, "For the festivals coming up"), Icons.Filled.AutoAwesome, m) { open(MenuGroup.FESTIVAL, festival) } },
                { m -> HomeTile("Dry Products", subtitle(dry, "Chef's masala powders and more"), Icons.Filled.ShoppingBasket, m) { open(MenuGroup.DRY, dry) } },
                { m -> HomeTile("Chef's Availability", "Open dates and times", Icons.Filled.CalendarMonth, m) { nav.push(Screen.Availability) } },
                { m -> HomeTile("My Account", if (model.isSignedIn) (model.profile?.firstName?.ifEmpty { null } ?: "Signed in") else "Sign in with your phone", Icons.Filled.AccountCircle, m) { model.selectedTab = Tab.ACCOUNT } },
                { m -> HomeTile("Custom Quote", "Tell Chef what you need", Icons.Filled.EditNote, m) { showCustom = true } },
                { m -> HomeTile("Comments & Ideas", "Tell us how we did", Icons.Filled.Comment, m) { showFeedback = true } },
                { m -> HomeTile("At-Home Chef!", "Coming soon", Icons.Filled.Home, m, soon = true) { comingSoon = "At-Home Chef!" } },
                { m -> HomeTile("Supper Club", "Coming soon", Icons.Filled.WineBar, m, soon = true) { comingSoon = "Supper Club" } },
            )
            tiles.chunked(2).forEach { row ->
                Row(Modifier.fillMaxWidth().height(androidx.compose.foundation.layout.IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { it(Modifier.weight(1f).fillMaxSize()) }
                }
            }

            ScanRecipeCard()
        }
    }

    if (showLiveDose && lds != null) LiveDoseSheet(model, lds) { showLiveDose = false }
    if (showCustom) CustomRequestSheet(model) { showCustom = false }
    if (showFeedback) FeedbackSheet(model, null) { showFeedback = false }
    if (showCart) CartSheet(model) { showCart = false }
    comingSoon?.let { name ->
        InfoDialog(name, "Coming soon. Ask Chef about it with a custom quote, or call ${model.config?.phoneDisplay ?: "us"}.") { comingSoon = null }
    }
}

@Composable
fun HomeTile(title: String, subtitle: String, icon: ImageVector, modifier: Modifier = Modifier, soon: Boolean = false, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 128.dp).background(if (soon) P.surface2 else P.surface, RoundedCornerShape(18.dp)).border(1.dp, P.line, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = if (soon) P.muted else P.red, modifier = Modifier.size(24.dp))
        Spacer(Modifier.weight(1f))
        Text(title.uppercase(), style = Type.display(16), color = if (soon) P.muted else P.ink)
        Text(subtitle, style = if (soon) Type.semi(13.0) else Type.body(13.0), color = if (soon) P.turmericInk else P.muted)
    }
}

@Composable
fun CartBar(model: AppModel, open: () -> Unit) {
    BottomBar {
        val label = if (model.cart.isLiveDose) "LIVE Dose Station" else "${model.cart.count} dish${if (model.cart.count == 1) "" else "es"}"
        androidx.compose.material3.Button(
            onClick = open, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(50),
            colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = P.leaf, contentColor = P.leafInk),
        ) {
            Text(label, style = Type.bold(17.0))
            Spacer(Modifier.weight(1f))
            Text("View order · ${Money.text(model.cart.subtotal)}", style = Type.bold(17.0))
        }
    }
}

// MARK: sections

@Composable
fun SectionsScreen(model: AppModel, nav: Nav, group: MenuGroup) {
    var showCart by remember { mutableStateOf(false) }
    val sections = group.sections(model.categories)
    TabScreen("", onBack = { nav.pop() }, bottomBar = { if (!model.cart.isEmpty) CartBar(model) { showCart = true } }) { pad ->
        RefreshColumn(pad, onRefresh = { model.loadMenu() }) {
            Text(group.title, style = Type.display(30), color = P.red)
            when (group) {
                MenuGroup.SPECIALS -> MutedText("Single-serve takeout, ordered ahead and picked up on Chef's pickup day.")
                MenuGroup.FESTIVAL -> MutedText("Chef's menus for the festivals coming up.")
                MenuGroup.DRY -> MutedText("Chef's own masala powders and pantry staples.")
                MenuGroup.CATERING -> if (model.config?.cateringPickupOnly == true) MutedText("Trays for pickup from our kitchen · ${if (model.config?.halfTrays == true) "full or half trays" else "full trays"}")
            }
            if (group == MenuGroup.CATERING && sections.firstOrNull { it.preorder == null }?.open == false) {
                Notice("Chef has no catering dates open right now. You can still browse, or ask for a custom quote.", Tone.WARN, Icons.Outlined.EventBusy)
            }
            sections.forEach { c ->
                Row(
                    Modifier.fillMaxWidth().card(P.surface, P.line).clickable { nav.push(Screen.Category(c.id)) }.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(c.title, style = Type.display(21), color = P.ink)
                        c.preorder?.let { p ->
                            Pill(p.next?.let { "Pre-order · pickup ${it.pickupLabel}" } ?: "Pre-order · next pickup coming soon", P.turmericInk, P.turmericSoft)
                        }
                        MutedText(c.subtitle.ifEmpty { "${c.items.size} dish${if (c.items.size == 1) "" else "es"}" })
                    }
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = P.muted)
                }
            }
            if (sections.isEmpty()) MutedText(group.empty, 15.0)
        }
    }
    if (showCart) CartSheet(model) { showCart = false }
}

/** One section's dishes, to add to the order (one at a time or several at once). */
@Composable
fun CategoryScreen(model: AppModel, nav: Nav, categoryId: String) {
    val cat = model.categories.firstOrNull { it.id == categoryId }
    var selected by remember { mutableStateOf<Dish?>(null) }
    var showCart by remember { mutableStateOf(false) }
    var search by remember { mutableStateOf("") }
    var selecting by remember { mutableStateOf(false) }
    val picked = remember { mutableStateListOf<String>() }
    var showMulti by remember { mutableStateOf(false) }

    TabScreen(
        "", onBack = { nav.pop() },
        actions = {
            TextButton(onClick = { selecting = !selecting; picked.clear() }) {
                Text(if (selecting) "Cancel" else "Select dishes", style = Type.semi(16.0), color = P.leaf)
            }
        },
        bottomBar = {
            if (selecting) BottomBar {
                PrimaryButton(if (picked.isEmpty()) "Tap dishes to select them" else "${picked.size} selected · Choose quantities", enabled = picked.isNotEmpty()) { showMulti = true }
            } else if (!model.cart.isEmpty) CartBar(model) { showCart = true }
        },
    ) { pad ->
        RefreshColumn(pad, onRefresh = { model.loadMenu() }, contentPadding = 0, spacing = 0) {
            if (cat == null) {
                MutedText("This section isn't on the menu any more.", 15.0, Modifier.padding(20.dp))
                return@RefreshColumn
            }
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(cat.title, style = Type.display(28), color = P.red)
                if (cat.subtitle.isNotEmpty()) MutedText(cat.subtitle, 15.0)
            }
            if (cat.items.size > 6) {
                Field(search, { search = it }, "Search ${cat.title}", Modifier.padding(horizontal = 16.dp).padding(bottom = 10.dp))
            }
            val p = cat.preorder
            if (p != null) {
                Panel(Modifier.padding(horizontal = 16.dp).padding(bottom = 10.dp)) {
                    LabelRow(Icons.Outlined.ShoppingBag, "Pre-order · pickup only", P.ink, 15.0, androidx.compose.ui.text.font.FontWeight.Bold)
                    if (p.days.isEmpty() || cat.items.isEmpty()) MutedText("Chef hasn't opened the next pickup day yet. Check back soon - or tap Share to tell a friend.")
                    p.days.take(3).forEach { d ->
                        MutedText("Pickup ${d.pickupLabel} · order by ${d.orderByLabel}")
                        d.items.orEmpty().forEach { st ->
                            Text("${st.title}: ${st.summary}", style = Type.semi(13.0), color = if (st.min > 0 && st.ordered < st.min) P.turmericInk else P.veg)
                        }
                    }
                }
            } else if (!cat.open) {
                Notice("Chef has no catering dates open right now. You can still browse, or ask for a custom quote.", Tone.WARN, Icons.Outlined.EventBusy, Modifier.padding(horizontal = 20.dp).padding(bottom = 8.dp))
            }
            val q = search.trim()
            val dishes = if (q.isEmpty()) cat.items else cat.items.filter { it.title.contains(q, true) || it.description.contains(q, true) }
            dishes.forEach { dish ->
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !(selecting && !cat.open)) {
                        if (selecting) { if (dish.id in picked) picked.remove(dish.id) else picked.add(dish.id) } else selected = dish
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (selecting) {
                        Icon(if (dish.id in picked) Icons.Filled.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null,
                            tint = if (dish.id in picked) P.leaf else P.muted, modifier = Modifier.padding(start = 18.dp).size(24.dp))
                    }
                    DishRow(dish, model.cart.lines.filter { it.itemId == dish.id }.sumOf { it.qty }, Modifier.weight(1f))
                }
                Divider()
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    selected?.let { DishSheet(model, it, cat) { selected = null } }
    if (showMulti) MultiAddSheet(model, picked.mapNotNull { model.dish(it) }, onAdded = { selecting = false; picked.clear() }) { showMulti = false }
    if (showCart) CartSheet(model) { showCart = false }
}

@Composable
fun DishRow(dish: Dish, inCart: Double, modifier: Modifier = Modifier) {
    Row(modifier.padding(horizontal = 20.dp, vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(dish.title, style = Type.display(19), color = P.ink)
            if (dish.promoted || dish.limited) DishTags(dish)
            if (dish.meta.isNotEmpty()) MutedText(dish.meta)
            if (dish.description.isNotEmpty()) Text(dish.description, style = Type.body(14.0), color = P.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(Money.text(dish.price), style = Type.bold(17.0), color = P.ink)
            if (inCart > 0) Pill("${Qty.text(inCart)} in order", P.leaf, P.leafSoft)
        }
    }
}

// MARK: availability

@Composable
fun AvailabilityScreen(nav: Nav) {
    var dates by remember { mutableStateOf<List<OpenDate>>(emptyList()) }
    var preDays by remember { mutableStateOf<List<PreorderDay>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    suspend fun load() {
        runCatching { Api.get<AvailabilityResponse>("availability") }.getOrNull()?.let { dates = it.dates; preDays = it.preorderDays.orEmpty() }
        loading = false
    }
    LaunchedEffect(Unit) { load() }
    TabScreen("", onBack = { nav.pop() }) { pad ->
        RefreshColumn(pad, onRefresh = { load() }) {
            Text("Chef's Availability", style = Type.display(30), color = P.red)
            MutedText("Open dates for catering pickup and the LIVE Dose Station. Pick your date and time when you check out.", 15.0)
            if (loading) CircularProgressIndicator(color = P.leaf, modifier = Modifier.padding(top = 20.dp))
            else if (dates.isEmpty()) Notice("No open dates right now. Ask for a custom quote or call Chef about your event.", Tone.WARN, Icons.Outlined.CalendarMonth)
            if (preDays.isNotEmpty()) {
                SectionTitle("Dose-in-a-Box & takeout pickups", size = 20)
                preDays.forEach { p ->
                    Row(Modifier.fillMaxWidth().card(P.turmericSoft, P.line).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        DateBadge(p.date)
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(p.label, style = Type.bold(17.0), color = P.ink)
                            LabelRow(Icons.Outlined.Inventory2, "Pickup at ${p.pickupTime}", P.muted, 14.0)
                            LabelRow(Icons.Outlined.Schedule, "Order by ${p.orderByLabel}", P.turmericInk, 14.0)
                        }
                    }
                }
                SectionTitle("Catering & LIVE Dose", size = 20)
            }
            dates.forEach { d ->
                Row(Modifier.fillMaxWidth().card(P.surface, P.line).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    DateBadge(d.date)
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(d.label, style = Type.bold(17.0), color = P.ink)
                        d.summary.split(" · ").filter { it.isNotBlank() }.forEach { part ->
                            LabelRow(if ("LIVE" in part) Icons.Outlined.LocalFireDepartment else Icons.Outlined.TakeoutDining, part, P.muted, 14.0)
                        }
                    }
                }
            }
        }
    }
}

/** A simple drawn dose: a golden crêpe on a beige plate (stand-in until Chef adds photos). */
@Composable
fun DoseGlyph(modifier: Modifier = Modifier) {
    val plate = P.beige
    val rim = P.goldLine
    Canvas(modifier.clearAndSetSemantics { }) {
        val w = size.width
        val h = size.height
        drawOval(plate, topLeft = Offset(0f, h * 0.18f), size = Size(w, h * 0.72f))
        drawOval(rim, topLeft = Offset(1f, h * 0.18f + 1f), size = Size(w - 2f, h * 0.72f - 2f), style = Stroke(width = 1.5.dp.toPx()))
        val cone = Path().apply {
            moveTo(w * 0.12f, h * 0.56f)
            quadraticTo(w * 0.5f, h * 0.08f, w * 0.9f, h * 0.36f)
            lineTo(w * 0.84f, h * 0.62f)
            quadraticTo(w * 0.48f, h * 0.78f, w * 0.12f, h * 0.56f)
            close()
        }
        drawPath(cone, Color(0xFFF7D27A))
        val fold = Path().apply {
            moveTo(w * 0.2f, h * 0.55f)
            quadraticTo(w * 0.5f, h * 0.3f, w * 0.84f, h * 0.42f)
        }
        drawPath(fold, Color(0xFFA86F00), style = Stroke(width = 1.5.dp.toPx()))
    }
}


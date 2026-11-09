package com.franklintiffinroom.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.EditNote
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.PrivacyTip
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material.icons.outlined.QuestionAnswer
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.franklintiffinroom.app.BuildConfig
import com.franklintiffinroom.app.core.Api
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.FeedbackComment
import com.franklintiffinroom.app.core.FeedbackList
import com.franklintiffinroom.app.core.Iso
import com.franklintiffinroom.app.core.OK
import com.franklintiffinroom.app.core.friendly
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun AccountScreen(model: AppModel) {
    val ctx = LocalContext.current
    var showSignIn by remember { mutableStateOf(false) }
    var showCustom by remember { mutableStateOf(false) }
    var showQuestion by remember { mutableStateOf(false) }
    var showFeedback by remember { mutableStateOf(false) }
    var editingName by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var showKitchen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val config = model.config
    fun require(then: () -> Unit) { if (model.isSignedIn) then() else showSignIn = true }

    TabScreen("Account") { pad ->
        RefreshColumn(pad, onRefresh = { model.loadMenu(); model.refreshAccountData() }, spacing = 16) {
            if (model.profile?.isAdmin == true) {
                Panel(Modifier.clickable { showKitchen = true }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        BrandMark(40)
                        Column(Modifier.weight(1f)) {
                            Text("Chef's Kitchen", style = Type.display(19), color = P.ink)
                            MutedText("Orders, approvals, menu, calendar and Setup - your admin page")
                        }
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = P.muted)
                    }
                }
                MutedText("Only shows on Chef's phone. Changes here are the same as on the admin website and the WhatsApp bot.", 13.0)
            }
            val p = model.profile
            if (p != null) Panel {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${p.firstName} ${p.lastName}", style = Type.display(22), color = P.ink)
                    MutedText(p.phoneDisplay, 15.0)
                }
                TextButton(onClick = { editingName = true }) { Text("Edit name", style = Type.semi(16.0), color = P.leaf) }
                Divider()
                ToggleRow("Alerts for new dishes & announcements", p.announcementAlerts == true,
                    "Festival menus, new items and news from Chef. They always show in Notifications; this also alerts your phone.") { model.setAnnouncementAlerts(it) }
                p.savedAddress?.let { Column { MutedText("Saved address", 13.0); Text(it, style = Type.body(15.0), color = P.ink) } }
            } else Panel {
                Text("Order with your phone number", style = Type.display(20), color = P.ink)
                MutedText("Signing in lets you send orders, follow them and get Chef's replies.", 15.0)
                PrimaryButton("Sign in") { showSignIn = true }
            }

            SectionTitle("Talk to Chef", size = 20)
            Panel(padding = 6.dp) {
                Column {
                    LinkRow(Icons.Outlined.EditNote, "Request a custom quote") { require { showCustom = true } }
                    LinkRow(Icons.Outlined.QuestionAnswer, "Ask a question") { require { showQuestion = true } }
                    LinkRow(Icons.Outlined.ChatBubbleOutline, "Comments & suggestions") { showFeedback = true }
                    LinkRow(Icons.Outlined.Share, "Share FTR with a friend") { Intents.share(ctx, "Franklin Tiffin Room", shareMessage(config?.phoneDisplay, config?.phoneDial)) }
                    config?.phoneDial?.let { dial -> LinkRow(Icons.Outlined.Phone, "Call ${config.phoneDisplay}") { Intents.dial(ctx, dial) } }
                    val email = config?.supportEmail ?: "thechef@franklintiffinroom.com"
                    LinkRow(Icons.Outlined.Email, email) { Intents.email(ctx, email) }
                    config?.instagram?.let { ig -> LinkRow(Icons.Outlined.CameraAlt, "@$ig") { Intents.url(ctx, "https://instagram.com/$ig") } }
                    config?.zelle?.let { z -> LinkRow(Icons.Outlined.AttachMoney, "Zelle: ${z.to}" + (z.name?.let { " ($it)" } ?: ""), null) }
                    LinkRow(Icons.Outlined.HelpOutline, "Help & support") { Intents.url(ctx, "https://bot.franklintiffinroom.com/support") }
                    LinkRow(Icons.Outlined.PrivacyTip, "Privacy policy") { Intents.url(ctx, "https://bot.franklintiffinroom.com/privacy") }
                }
            }

            if (config != null) {
                SectionTitle("How ordering works", size = 20)
                Panel {
                    Text("Chef reviews every order and replies here. ${config.paymentSentence}", style = Type.body(15.0), color = P.ink)
                    if (config.cateringPickupOnly) Text("Catering trays are picked up from our kitchen. The LIVE Dose Station comes to you.", style = Type.body(15.0), color = P.ink)
                }
            }

            if (model.isSignedIn) {
                Panel(padding = 6.dp) {
                    Column {
                        TextButton(onClick = { model.signOut() }) { Text("Sign out", style = Type.semi(16.0), color = P.leaf) }
                        TextButton(onClick = { confirmDelete = true }) { Text("Delete my account", style = Type.semi(16.0), color = P.bad) }
                    }
                }
                MutedText("Deleting removes your sign-in, saved name, address and messages. Records of orders you placed are kept by Franklin Tiffin Room for its business records.", 13.0)
            }
            MutedText("Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})", 13.0)
        }
    }

    if (showSignIn) SignInSheet(model, onDismiss = { showSignIn = false })
    if (showCustom) CustomRequestSheet(model) { showCustom = false }
    if (showQuestion) QuestionSheet(model) { showQuestion = false }
    if (showFeedback) FeedbackSheet(model, null) { showFeedback = false }
    if (editingName) EditNameSheet(model) { editingName = false }
    if (showKitchen) KitchenSheet { showKitchen = false; model.reloadMenu(); model.refreshAll() }
    if (confirmDelete) Confirm("Delete your account?", "You'll be signed out on this phone and your saved details will be removed.", "Delete account", onConfirm = {
        scope.launch { try { model.deleteAccount() } catch (e: Exception) { deleteError = e.friendly() } }
    }, onDismiss = { confirmDelete = false })
    deleteError?.let { InfoDialog("Couldn't delete", it) { deleteError = null } }
}

@Composable
private fun LinkRow(icon: ImageVector, text: String, onClick: (() -> Unit)?) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 10.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, null, tint = if (onClick != null) P.leaf else P.muted, modifier = Modifier.size(22.dp))
        Text(text, style = Type.body(16.0), color = if (onClick != null) P.leaf else P.ink)
    }
}

// MARK: messages to Chef

@Serializable private data class TextBody(val text: String)
@Serializable private data class FeedbackBody(val text: String, val orderId: String? = null)

/** Free-text message to Chef: a custom quote request or a question. */
@Composable
private fun ComposeToChef(model: AppModel, title: String, intro: String, placeholder: String, sendTitle: String, path: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sent by remember { mutableStateOf(false) }
    var showSignIn by remember { mutableStateOf(false) }
    FullSheet(onDismiss) { pad ->
        ScrollBody(pad, spacing = 16) {
            Text(title, style = Type.display(28), color = P.ink)
            if (sent) {
                Notice("Sent to Chef. You'll get the reply in Notifications.", Tone.INFO, Icons.Outlined.CheckCircle)
                PrimaryButton("Done") { onDismiss() }
            } else {
                MutedText(intro, 16.0)
                Field(text, { text = it }, placeholder, minLines = 5, maxLines = 12)
                error?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
                if (!model.isSignedIn) MutedText("You'll sign in with your phone number so Chef can reply.")
                PrimaryButton(sendTitle, enabled = text.trim().length >= 3, busy = sending) {
                    if (!model.isSignedIn) { showSignIn = true; return@PrimaryButton }
                    scope.launch {
                        sending = true
                        try { Api.post<OK, TextBody>(path, TextBody(text)); sent = true; model.refreshAccountData() }
                        catch (e: Exception) { error = e.friendly() } finally { sending = false }
                    }
                }
            }
        }
    }
    if (showSignIn) SignInSheet(model, onDismiss = { showSignIn = false })
}

@Composable
fun CustomRequestSheet(model: AppModel, onDismiss: () -> Unit) = ComposeToChef(
    model, "Custom quote",
    "Tell Chef the dishes, how many people, the date and time, and pickup or delivery (with the address). Chef replies with a price you can accept here.",
    "e.g. North Indian lunch for 60 on Nov 21 - paneer, dal, jeera rice, rotis. Pickup around noon.",
    "Send request", "custom-requests", onDismiss,
)

@Composable
fun QuestionSheet(model: AppModel, onDismiss: () -> Unit) = ComposeToChef(
    model, "Ask Chef", "Allergies, ingredients, sizes, timing - ask anything. Chef will get back to you.",
    "Your question", "Send question", "questions", onDismiss,
)

private val commentDate = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US)

/** Comments and suggestions for Chef, optionally about one of the customer's orders. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedbackSheet(model: AppModel, orderId: String?, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var about by remember { mutableStateOf(orderId ?: "") }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var mine by remember { mutableStateOf<List<FeedbackComment>>(emptyList()) }
    var showSignIn by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    LaunchedEffect(model.isSignedIn) {
        if (model.isSignedIn) runCatching { Api.get<FeedbackList>("feedback") }.getOrNull()?.let { mine = it.comments }
    }
    FullSheet(onDismiss) { pad ->
        ScrollBody(pad, spacing = 16) {
            Text("Comments & suggestions", style = Type.display(28), color = P.ink)
            if (sent) {
                Notice("Thank you! Chef reads every comment.", Tone.INFO, Icons.Outlined.CheckCircle)
                PrimaryButton("Done") { onDismiss() }
            } else {
                MutedText("Tell us how we did, or what you'd like to see next. Chef reads every comment.", 16.0)
                val choices = model.orders.filter { !it.isClosed || it.orderId == orderId }
                if (model.isSignedIn && choices.isNotEmpty()) {
                    val label = choices.firstOrNull { it.orderId == about }?.let { "${it.orderId} · ${it.title}" } ?: "Not about a specific order"
                    ExposedDropdownMenuBox(expanded = menuOpen, onExpandedChange = { menuOpen = it }) {
                        OutlinedTextField(label, {}, readOnly = true, label = { Text("About an order") }, textStyle = Type.body(15.0),
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(menuOpen) },
                            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable))
                        ExposedDropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Not about a specific order") }, onClick = { about = ""; menuOpen = false })
                            choices.forEach { o -> DropdownMenuItem(text = { Text("${o.orderId} · ${o.title}") }, onClick = { about = o.orderId; menuOpen = false }) }
                        }
                    }
                }
                Field(text, { text = it }, "Your comment or idea", minLines = 4, maxLines = 12)
                error?.let { Notice(it, Tone.BAD, Icons.Outlined.ErrorOutline) }
                if (!model.isSignedIn) MutedText("You'll sign in with your phone number so we can keep your comments together.")
                PrimaryButton("Send comment", enabled = text.trim().length >= 2, busy = sending) {
                    if (!model.isSignedIn) { showSignIn = true; return@PrimaryButton }
                    scope.launch {
                        sending = true; error = null
                        try { mine = listOf(Api.post<FeedbackComment, FeedbackBody>("feedback", FeedbackBody(text, about.ifEmpty { null }))) + mine; sent = true }
                        catch (e: Exception) { error = e.friendly() } finally { sending = false }
                    }
                }
            }
            if (mine.isNotEmpty()) {
                SectionTitle("Your earlier comments", size = 20)
                mine.forEach { c ->
                    Column(Modifier.fillMaxWidth().card(P.surface, P.line).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(c.text, style = Type.body(15.0), color = P.ink)
                        val d = Iso.parse(c.at)?.atZone(ZoneId.systemDefault())?.format(commentDate)
                        MutedText(listOfNotNull(d, c.orderId).joinToString(" · "), 13.0)
                    }
                }
            }
        }
    }
    if (showSignIn) SignInSheet(model, onDismiss = { showSignIn = false })
}

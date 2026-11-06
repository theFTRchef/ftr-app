package com.franklintiffinroom.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.franklintiffinroom.app.core.AppModel
import com.franklintiffinroom.app.core.Tab
import kotlinx.coroutines.delay

/** Where each tab is (a small back stack per tab). */
sealed interface Screen {
    data object Home : Screen
    data class Sections(val group: MenuGroup) : Screen
    data class Category(val id: String) : Screen
    data object Availability : Screen
    data object Orders : Screen
    data class OrderDetail(val id: String) : Screen
}

class Nav(val stack: SnapshotStateList<Screen>) {
    fun push(s: Screen) { stack.add(s) }
    fun pop() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    fun reset(s: Screen) { stack.clear(); stack.add(s) }
    val top: Screen get() = stack.last()
    val canPop get() = stack.size > 1
}

@Composable
fun Root(model: AppModel) {
    var entered by rememberSaveable { mutableStateOf(false) }
    val homeNav = remember { Nav(mutableStateListOf(Screen.Home)) }
    val ordersNav = remember { Nav(mutableStateListOf(Screen.Orders)) }

    LaunchedEffect(model.openOrderId) {
        model.openOrderId?.let { id ->
            entered = true
            ordersNav.reset(Screen.Orders)
            ordersNav.push(Screen.OrderDetail(id))
            model.openOrderId = null
        }
    }
    LaunchedEffect(model.selectedTab) { if (model.selectedTab != Tab.MENU) entered = true }
    // While the app is open, pick up admin-page changes every 2 minutes.
    LaunchedEffect(Unit) {
        while (true) { delay(120_000); model.loadMenu() }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        model.reloadMenu(); model.refreshAll()
    }

    if (!entered) {
        WelcomeScreen(model) { entered = true }
        return
    }
    if (model.needsAppUpdate) {
        UpdateRequired()
        return
    }

    val nav = when (model.selectedTab) { Tab.MENU -> homeNav; Tab.ORDERS -> ordersNav; else -> null }
    BackHandler(enabled = nav?.canPop == true || model.selectedTab != Tab.MENU) {
        if (nav?.canPop == true) nav.pop() else model.selectedTab = Tab.MENU
    }

    Scaffold(
        containerColor = P.bg,
        bottomBar = {
            NavigationBar(containerColor = P.surface) {
                TabItem(model, Tab.MENU, "Home", Icons.Outlined.Home, 0) { if (model.selectedTab == Tab.MENU) homeNav.reset(Screen.Home) }
                TabItem(model, Tab.ORDERS, "Orders", Icons.AutoMirrored.Outlined.ReceiptLong, model.orders.count { it.needsCustomerAction }) { if (model.selectedTab == Tab.ORDERS) ordersNav.reset(Screen.Orders) }
                TabItem(model, Tab.MESSAGES, "Notifications", Icons.Outlined.Notifications, model.unread) {}
                TabItem(model, Tab.ACCOUNT, "Account", Icons.Outlined.AccountCircle, 0) {}
            }
        },
    ) { inner ->
        androidx.compose.foundation.layout.Box(Modifier.padding(bottom = inner.calculateBottomPadding())) {
            when (model.selectedTab) {
                Tab.MENU -> HomeTab(model, homeNav)
                Tab.ORDERS -> OrdersTab(model, ordersNav)
                Tab.MESSAGES -> InboxScreen(model)
                Tab.ACCOUNT -> AccountScreen(model)
            }
        }
    }

    // Signed in but never gave a name: ask once.
    if (model.profile?.needsName == true && !model.signInOpen) {
        EditNameSheet(model, required = true) {}
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(model: AppModel, tab: Tab, label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, badge: Int, onReselect: () -> Unit) {
    NavigationBarItem(
        selected = model.selectedTab == tab,
        onClick = { onReselect(); model.selectedTab = tab },
        icon = {
            BadgedBox(badge = { if (badge > 0) Badge(containerColor = P.red) { Text("$badge") } }) { Icon(icon, label) }
        },
        label = { Text(label, style = Type.body(11.0, androidx.compose.ui.text.font.FontWeight.Medium)) },
        colors = NavigationBarItemDefaults.colors(selectedIconColor = P.leaf, selectedTextColor = P.leaf, indicatorColor = P.leafSoft, unselectedIconColor = P.muted, unselectedTextColor = P.muted),
    )
}

@Composable
fun HomeTab(model: AppModel, nav: Nav) {
    when (val s = nav.top) {
        Screen.Home -> HomeScreen(model, nav)
        is Screen.Sections -> SectionsScreen(model, nav, s.group)
        is Screen.Category -> CategoryScreen(model, nav, s.id)
        Screen.Availability -> AvailabilityScreen(nav)
        else -> HomeScreen(model, nav)
    }
}

@Composable
fun OrdersTab(model: AppModel, nav: Nav) {
    when (val s = nav.top) {
        is Screen.OrderDetail -> OrderDetailScreen(model, nav, s.id)
        else -> OrdersScreen(model, nav)
    }
}

@Composable
fun UpdateRequired() {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        FtrLogo(32)
        Spacer(Modifier.height(16.dp))
        Text("Time for an update", style = Type.display(28), color = P.ink)
        Spacer(Modifier.height(10.dp))
        Text("This version of the app can't place orders any more. Please update FTR-DOSE from Google Play.", style = Type.body(16.0), color = P.muted, textAlign = TextAlign.Center)
    }
}

@Composable
fun Loading() {
    Column(Modifier.fillMaxSize().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(color = P.leaf) }
}
